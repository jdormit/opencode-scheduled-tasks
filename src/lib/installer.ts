import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Platform = "macos-launchd" | "linux-systemd" | "unsupported";

const LAUNCHD_LABEL = "ai.opencode.scheduled-tasks";
const SYSTEMD_SERVICE = "opencode-scheduler.service";
const SYSTEMD_TIMER = "opencode-scheduler.timer";

/**
 * Detect the platform and init system
 */
export function detectPlatform(): Platform {
  if (process.platform === "darwin") return "macos-launchd";
  if (process.platform === "linux") {
    try {
      execFileSync("systemctl", ["--version"], { stdio: "ignore" });
      return "linux-systemd";
    } catch {
      // systemctl not found or not working
    }
  }
  return "unsupported";
}

/**
 * Resolve the absolute path to the CLI script.
 *
 * Since tsup bundles installer.ts into cli.js, import.meta.url
 * already points to the CLI script when running from the bundle.
 * When running from source (ts-node/tsx), we walk up to find dist/cli.js.
 * As a final fallback, we look for the `opencode-scheduler` bin on PATH.
 */
function resolveSchedulerPath(): string {
  const thisFile = fileURLToPath(import.meta.url);

  // Case 1: We ARE the CLI script (bundled by tsup)
  if (basename(thisFile) === "cli.js") {
    return resolve(thisFile);
  }

  // Case 2: Running from source (src/lib/installer.ts)
  // Walk up to find dist/cli.js
  const candidates = [
    join(dirname(dirname(thisFile)), "..", "dist", "cli.js"), // from src/lib/
    join(dirname(thisFile), "..", "dist", "cli.js"),          // from src/
    join(dirname(dirname(thisFile)), "cli.js"),               // from dist/lib/ (if unbundled)
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return resolve(candidate);
    }
  }

  // Case 3: Fallback to PATH lookup
  try {
    const result = execFileSync("which", ["opencode-scheduler"], {
      encoding: "utf-8",
    }).trim();
    if (result) return resolve(result);
  } catch {
    // not found
  }

  throw new Error(
    "Could not find the opencode-scheduler script. " +
      "Make sure the package is properly installed."
  );
}

function getHome(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? "";
}

function getLogDir(): string {
  const dir = join(getHome(), ".local", "share", "opencode");
  mkdirSync(dir, { recursive: true });
  return dir;
}

// --- macOS launchd ---

function getLaunchdPlistPath(): string {
  return join(
    getHome(),
    "Library",
    "LaunchAgents",
    `${LAUNCHD_LABEL}.plist`
  );
}

function generateLaunchdPlist(
  nodePath: string,
  schedulerPath: string
): string {
  const logDir = getLogDir();
  const currentPath = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin";

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${schedulerPath}</string>
    <string>--run-once</string>
  </array>
  <key>StartInterval</key>
  <integer>60</integer>
  <key>StandardOutPath</key>
  <string>${join(logDir, "scheduler.log")}</string>
  <key>StandardErrorPath</key>
  <string>${join(logDir, "scheduler.err")}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${currentPath}</string>
  </dict>
</dict>
</plist>`;
}

async function installLaunchd(): Promise<void> {
  const nodePath = process.execPath;
  const schedulerPath = resolveSchedulerPath();
  const plistPath = getLaunchdPlistPath();

  // Ensure LaunchAgents directory exists
  mkdirSync(dirname(plistPath), { recursive: true });

  // Unload if already loaded
  try {
    execFileSync("launchctl", ["unload", plistPath], { stdio: "ignore" });
  } catch {
    // Not loaded, that's fine
  }

  // Write plist
  const plist = generateLaunchdPlist(nodePath, schedulerPath);
  writeFileSync(plistPath, plist);

  // Load
  execFileSync("launchctl", ["load", plistPath]);

  console.log("Scheduler installed (macOS launchd)");
  console.log(`  Plist: ${plistPath}`);
  console.log(`  Node:  ${nodePath}`);
  console.log(`  Script: ${schedulerPath}`);
  console.log(`  Interval: every 60 seconds`);
  console.log(`  Logs: ${getLogDir()}/scheduler.{log,err}`);
}

async function uninstallLaunchd(): Promise<void> {
  const plistPath = getLaunchdPlistPath();

  if (!existsSync(plistPath)) {
    console.log("Scheduler is not installed (no launchd plist found)");
    return;
  }

  try {
    execFileSync("launchctl", ["unload", plistPath], { stdio: "ignore" });
  } catch {
    // Already unloaded
  }

  unlinkSync(plistPath);
  console.log("Scheduler uninstalled (macOS launchd)");
  console.log(`  Removed: ${plistPath}`);
}

function isLaunchdInstalled(): boolean {
  return existsSync(getLaunchdPlistPath());
}

// --- Linux systemd ---

function getSystemdDir(): string {
  return join(getHome(), ".config", "systemd", "user");
}

function generateSystemdService(
  nodePath: string,
  schedulerPath: string
): string {
  const currentPath = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin";

  return `[Unit]
Description=OpenCode Scheduled Tasks Runner

[Service]
Type=oneshot
ExecStart=${nodePath} ${schedulerPath} --run-once
Environment=PATH=${currentPath}
`;
}

function generateSystemdTimer(): string {
  return `[Unit]
Description=OpenCode Scheduled Tasks Timer

[Timer]
OnBootSec=60
OnUnitActiveSec=60
AccuracySec=1s

[Install]
WantedBy=timers.target
`;
}

async function installSystemd(): Promise<void> {
  const nodePath = process.execPath;
  const schedulerPath = resolveSchedulerPath();
  const systemdDir = getSystemdDir();

  mkdirSync(systemdDir, { recursive: true });

  const servicePath = join(systemdDir, SYSTEMD_SERVICE);
  const timerPath = join(systemdDir, SYSTEMD_TIMER);

  // Stop if already running
  try {
    execFileSync("systemctl", ["--user", "stop", SYSTEMD_TIMER], {
      stdio: "ignore",
    });
  } catch {
    // Not running
  }

  // Write unit files
  writeFileSync(servicePath, generateSystemdService(nodePath, schedulerPath));
  writeFileSync(timerPath, generateSystemdTimer());

  // Reload, enable, start
  execFileSync("systemctl", ["--user", "daemon-reload"]);
  execFileSync("systemctl", ["--user", "enable", SYSTEMD_TIMER]);
  execFileSync("systemctl", ["--user", "start", SYSTEMD_TIMER]);

  console.log("Scheduler installed (Linux systemd)");
  console.log(`  Service: ${servicePath}`);
  console.log(`  Timer:   ${timerPath}`);
  console.log(`  Node:    ${nodePath}`);
  console.log(`  Script:  ${schedulerPath}`);
  console.log(`  Interval: every 60 seconds`);
}

async function uninstallSystemd(): Promise<void> {
  const systemdDir = getSystemdDir();
  const servicePath = join(systemdDir, SYSTEMD_SERVICE);
  const timerPath = join(systemdDir, SYSTEMD_TIMER);

  if (!existsSync(timerPath) && !existsSync(servicePath)) {
    console.log("Scheduler is not installed (no systemd units found)");
    return;
  }

  try {
    execFileSync("systemctl", ["--user", "stop", SYSTEMD_TIMER], {
      stdio: "ignore",
    });
    execFileSync("systemctl", ["--user", "disable", SYSTEMD_TIMER], {
      stdio: "ignore",
    });
  } catch {
    // Already stopped/disabled
  }

  if (existsSync(servicePath)) unlinkSync(servicePath);
  if (existsSync(timerPath)) unlinkSync(timerPath);

  try {
    execFileSync("systemctl", ["--user", "daemon-reload"]);
  } catch {
    // Best effort
  }

  console.log("Scheduler uninstalled (Linux systemd)");
  console.log(`  Removed: ${servicePath}`);
  console.log(`  Removed: ${timerPath}`);
}

function isSystemdInstalled(): boolean {
  const systemdDir = getSystemdDir();
  return existsSync(join(systemdDir, SYSTEMD_TIMER));
}

// --- Public API ---

/**
 * Install the scheduler for the detected platform
 */
export async function install(): Promise<void> {
  const platform = detectPlatform();

  switch (platform) {
    case "macos-launchd":
      await installLaunchd();
      break;
    case "linux-systemd":
      await installSystemd();
      break;
    case "unsupported":
      console.error(
        "Unsupported platform. Supported: macOS (launchd), Linux (systemd)."
      );
      console.error("You can still run the scheduler manually:");
      console.error("  npx opencode-scheduler --run-once");
      process.exit(1);
  }
}

/**
 * Uninstall the scheduler for the detected platform
 */
export async function uninstall(): Promise<void> {
  const platform = detectPlatform();

  switch (platform) {
    case "macos-launchd":
      await uninstallLaunchd();
      break;
    case "linux-systemd":
      await uninstallSystemd();
      break;
    case "unsupported":
      console.error("No supported init system found.");
      process.exit(1);
  }
}

/**
 * Check if the scheduler is installed
 */
export function isInstalled(): boolean {
  const platform = detectPlatform();
  switch (platform) {
    case "macos-launchd":
      return isLaunchdInstalled();
    case "linux-systemd":
      return isSystemdInstalled();
    default:
      return false;
  }
}

/**
 * Get info about the current installation
 */
export function getInstallInfo(): {
  installed: boolean;
  platform: Platform;
  details?: string;
} {
  const platform = detectPlatform();
  const installed = isInstalled();

  let details: string | undefined;
  if (installed) {
    switch (platform) {
      case "macos-launchd":
        details = `Plist: ${getLaunchdPlistPath()}`;
        break;
      case "linux-systemd":
        details = `Timer: ${join(getSystemdDir(), SYSTEMD_TIMER)}`;
        break;
    }
  }

  return { installed, platform, details };
}
