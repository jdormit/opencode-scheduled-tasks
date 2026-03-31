# OpenCode Scheduled Tasks Plugin - Implementation Plan

## Overview

An OpenCode plugin (published as `opencode-scheduled-tasks` on npm) that enables one-off and recurring task scheduling. Recurring tasks are defined as markdown files with frontmatter in `~/.config/opencode/tasks/`. One-off tasks are created via agent tool calls and stored in SQLite. A standalone scheduler CLI (Node.js, runnable via `npx`) handles reliable background execution via launchd (macOS) or systemd (Linux), with auto-detection of the init system.

## Decisions

- **Distribution**: Published npm package (`opencode-scheduled-tasks`)
- **Runtime**: Scheduler CLI targets Node.js (`#!/usr/bin/env node`), runnable via `npx opencode-scheduler`. Plugin runs in OpenCode's Bun-based plugin runtime.
- **SQLite**: `better-sqlite3` for both plugin and scheduler (works in both Bun and Node; avoids runtime-conditional imports)
- **Concurrency**: Tasks are prevented from running concurrently (checked via `running` status in DB)
- **Session ID capture**: Parse `opencode run --format json` output
- **Timezone**: System local timezone always; no timezone frontmatter field
- **Permissions**: Use OpenCode's default permissions; task frontmatter can override via same schema as `opencode.json`
- **Installer**: `npx opencode-scheduler --install` auto-detects OS and installs appropriate launchd plist or systemd timer
- **Build**: `tsup` (esbuild-based) for fast builds with dual entry points; outputs ESM

## Architecture

### Components

1. **Plugin** (npm: `opencode-scheduled-tasks`, entry: `src/plugin.ts`) - The OpenCode plugin that:
   - Exposes custom tools for agents to schedule/manage tasks
   - Reads/writes the SQLite DB and task markdown files
   - Opportunistically checks for overdue tasks on `session.created` events

2. **Task markdown files** (`~/.config/opencode/tasks/*.md`) - User/agent-editable recurring task definitions

3. **SQLite database** (`~/.config/opencode/.tasks.db`) - Tracks one-off tasks, run history, session ID mapping

4. **Scheduler CLI** (`src/scheduler.ts`, exposed as `opencode-scheduler` bin) - Standalone Node.js script that:
   - Reads task files + SQLite DB to determine what's due
   - Invokes `opencode run` to execute tasks
   - Provides `--install` / `--uninstall` / `--run-once` / `--status` subcommands
   - Runnable via `npx opencode-scheduler` or directly after global install

### Dual-runtime strategy

The plugin runs in OpenCode's embedded Bun runtime. The scheduler CLI runs in Node.js. They share:
- The same SQLite database (`~/.config/opencode/.tasks.db`)
- The same library code (`src/lib/`) for DB access, task parsing, and cron evaluation

To keep the shared code runtime-agnostic, we use `better-sqlite3` (which works in both Bun and Node) rather than `bun:sqlite`. All shared library code avoids runtime-specific APIs.

### Execution flow

```
launchd/systemd timer (every 60s)
  -> node /path/to/opencode-scheduler --run-once
    -> reads ~/.config/opencode/tasks/*.md + .tasks.db
    -> for each due task (recurring or one-off):
      -> check not already running (concurrency guard)
      -> resolve or create session (via session_map table)
      -> execute:
         OPENCODE_PERMISSION='<json>' opencode run \
           --session <id> \          # if resuming named session
           --model <model> \         # if specified
           --agent <agent> \         # if specified
           --title "<name>" \        # if new session
           --format json \           # to capture session ID
           "<prompt from md body>"
         (cwd set to task's working directory)
      -> parse session ID from json output
      -> record run in .tasks.db
```

## npm Package Structure

```
opencode-scheduled-tasks/
  package.json
  tsconfig.json
  tsup.config.ts
  src/
    plugin.ts              # OpenCode plugin entry point (default export)
    scheduler.ts           # CLI entry point (#!/usr/bin/env node)
    lib/
      db.ts                # SQLite database module (schema, migrations, CRUD)
      tasks.ts             # Task file parser (read .md, parse frontmatter, validate)
      cron.ts              # Cron evaluation (is task due? next run time?)
      runner.ts            # Task execution (session resolution, opencode run invocation)
      installer.ts         # System scheduler installer (launchd/systemd detection + install)
      types.ts             # Shared TypeScript types
  examples/
    daily-cleanup.md       # Example recurring task
    weekly-report.md       # Example recurring task
  dist/                    # Build output (tsup)
```

### package.json

```json
{
  "name": "opencode-scheduled-tasks",
  "version": "0.1.0",
  "description": "Scheduled task runner plugin for OpenCode - cron-based recurring and one-off task scheduling",
  "type": "module",
  "main": "./dist/plugin.js",
  "module": "./dist/plugin.js",
  "types": "./dist/plugin.d.ts",
  "exports": {
    ".": {
      "import": "./dist/plugin.js",
      "types": "./dist/plugin.d.ts"
    }
  },
  "bin": {
    "opencode-scheduler": "./dist/scheduler.js"
  },
  "files": [
    "dist",
    "examples"
  ],
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "prepublishOnly": "npm run build",
    "test": "vitest"
  },
  "keywords": [
    "opencode",
    "scheduler",
    "cron",
    "tasks",
    "automation",
    "plugin"
  ],
  "license": "MIT",
  "engines": {
    "node": ">=18.0.0"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "cron-parser": "^5.0.0",
    "gray-matter": "^4.0.3"
  },
  "peerDependencies": {
    "@opencode-ai/plugin": ">=0.15.0"
  },
  "peerDependenciesMeta": {
    "@opencode-ai/plugin": {
      "optional": true
    }
  },
  "devDependencies": {
    "@opencode-ai/plugin": "^0.15.0",
    "@opencode-ai/sdk": "^0.15.0",
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^22.0.0",
    "tsup": "^8.0.0",
    "typescript": "^5.9.0",
    "vitest": "^3.0.0"
  }
}
```

Note: `@opencode-ai/plugin` is an optional peer dependency -- the scheduler CLI doesn't need it, only the plugin entry point does. This means `npx opencode-scheduler --install` works without having OpenCode's plugin package installed.

### tsup.config.ts

```typescript
import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { plugin: "src/plugin.ts" },
    format: ["esm"],
    dts: true,
    external: ["@opencode-ai/plugin", "@opencode-ai/sdk"],
  },
  {
    entry: { scheduler: "src/scheduler.ts" },
    format: ["esm"],
    banner: { js: "#!/usr/bin/env node" },
  },
]);
```

### User installation

**1. Add the plugin to OpenCode config:**
```json
{
  "plugin": ["opencode-scheduled-tasks"]
}
```

**2. Install the background scheduler:**
```bash
npx opencode-scheduler --install
```

This auto-detects macOS/Linux and installs the appropriate launchd plist or systemd timer.

**3. Create task files in `~/.config/opencode/tasks/`** or use the agent tools.

## Task Markdown Format

### Example: `~/.config/opencode/tasks/daily-cleanup.md`

```yaml
---
name: daily-cleanup
description: Clean up merged git branches
schedule: "0 9 * * *"
cwd: ~/projects/my-app
session_mode: named
session_name: daily-cleanup
model: anthropic/claude-sonnet-4-20250514
agent: build
permission:
  bash:
    "*": "allow"
    "rm -rf *": "deny"
  edit: "allow"
enabled: true
---

Check for local branches that have been merged into main and delete them.
List any branches that look stale but haven't been merged yet.
```

### Frontmatter fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | yes | - | Unique task identifier (must match filename without .md) |
| `description` | string | yes | - | Human-readable description |
| `schedule` | string | yes | - | Cron expression (5-field standard cron) |
| `cwd` | string | yes | - | Working directory for task execution. Supports `~` expansion. |
| `session_mode` | `"named"` \| `"new"` | no | `"new"` | `"named"` reuses a session, `"new"` creates fresh each run |
| `session_name` | string | conditional | - | Session name. Required if `session_mode` is `"named"`. |
| `model` | string | no | user default | Model in `provider/model` format |
| `agent` | string | no | user default | Agent to use |
| `permission` | object | no | opencode default | Permission config (same schema as opencode.json `permission` key) |
| `enabled` | boolean | no | `true` | Whether the task is active |

## SQLite Schema

File: `~/.config/opencode/.tasks.db`

```sql
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);

-- One-off tasks (created by agent tool calls, executed once then marked done)
CREATE TABLE IF NOT EXISTS oneoff_tasks (
  id TEXT PRIMARY KEY,                    -- crypto.randomUUID()
  description TEXT NOT NULL,
  prompt TEXT NOT NULL,
  cwd TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,             -- ISO 8601 timestamp
  session_mode TEXT NOT NULL DEFAULT 'new',
  session_name TEXT,
  model TEXT,
  agent TEXT,
  permission TEXT,                        -- JSON string
  status TEXT NOT NULL DEFAULT 'pending', -- pending | running | completed | failed | cancelled
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  executed_at TEXT,
  session_id TEXT,                        -- opencode session ID from the run
  error TEXT,
  created_by_session TEXT                 -- session that created this task (for context)
);

-- Run history for recurring tasks (from .md files)
CREATE TABLE IF NOT EXISTS task_runs (
  id TEXT PRIMARY KEY,
  task_name TEXT NOT NULL,                -- matches .md filename
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'running', -- running | completed | failed
  session_id TEXT,
  error TEXT
);

-- Session name -> session ID mapping
-- Bridges the gap between human-readable session names and opencode session IDs
CREATE TABLE IF NOT EXISTS session_map (
  session_name TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  task_name TEXT,                         -- null for one-offs
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## Plugin Implementation (`src/plugin.ts`)

### Tools exposed to the agent

#### 1. `schedule_task`

Schedule a one-off task to run at a specific time.

```typescript
tool({
  description: "Schedule a one-off task to run at a specific time. The task will execute an opencode prompt in the specified working directory. Requires the opencode-scheduler daemon to be installed for reliable execution.",
  args: {
    prompt: tool.schema.string("The prompt to send to opencode when the task runs"),
    description: tool.schema.string("Human-readable description of what this task does"),
    cwd: tool.schema.string("Working directory for the task (absolute path or ~ for home)"),
    scheduled_at: tool.schema.string("ISO 8601 timestamp for when to run (e.g. '2026-03-31T09:00:00')"),
    session_mode: tool.schema.enum(["new", "named"]).optional(),
    session_name: tool.schema.string().optional(),
    model: tool.schema.string().optional(),
    agent: tool.schema.string().optional(),
  },
  async execute(args, context) {
    // Validate args (cwd exists, scheduled_at is in future, etc.)
    // Insert into oneoff_tasks table
    // Return task ID + confirmation + note about scheduler daemon
  },
})
```

#### 2. `list_tasks`

List all scheduled tasks (both recurring and one-off).

```typescript
tool({
  description: "List all scheduled tasks. Shows recurring tasks from markdown files and pending one-off tasks. Includes next run time for recurring tasks and scheduled time for one-offs.",
  args: {
    status: tool.schema.enum(["all", "pending", "completed", "failed"]).optional(),
    type: tool.schema.enum(["all", "recurring", "oneoff"]).optional(),
  },
  async execute(args) {
    // Read task .md files from ~/.config/opencode/tasks/
    // Read oneoff_tasks from SQLite
    // Compute next run times for recurring tasks
    // Return formatted list
  },
})
```

#### 3. `cancel_task`

Cancel a pending one-off task or disable a recurring task.

```typescript
tool({
  description: "Cancel a pending one-off task by ID, or disable a recurring task by name.",
  args: {
    id: tool.schema.string("Task ID (for one-off) or task name (for recurring)"),
  },
  async execute(args) {
    // If it looks like a UUID, cancel in oneoff_tasks
    // If it's a task name, set enabled: false in the .md frontmatter
  },
})
```

#### 4. `task_history`

Get run history for a task.

```typescript
tool({
  description: "Get the execution history for a scheduled task. Shows recent runs with status, timing, and any errors.",
  args: {
    task_name: tool.schema.string("Task name (for recurring) or task ID (for one-off)"),
    limit: tool.schema.number().optional(),
  },
  async execute(args) {
    // Query task_runs table (recurring) or oneoff_tasks (one-off)
    // Return formatted history
  },
})
```

#### 5. `get_task_instructions`

Return instructions for creating/editing recurring task files.

```typescript
tool({
  description: "Get instructions and the frontmatter format for creating or editing recurring scheduled task markdown files. Use this when the user wants to set up a new recurring task or modify an existing one. After getting instructions, use file tools to create/edit the task file.",
  args: {},
  async execute() {
    // Return:
    // - Path to tasks directory (~/.config/opencode/tasks/)
    // - Full frontmatter schema documentation
    // - Example task file
    // - Note about needing scheduler daemon installed
  },
})
```

### Event handling

```typescript
event: async ({ event }) => {
  if (event.type === "session.created") {
    // Check for overdue one-off tasks and past-due recurring tasks
    // Log warnings if scheduler daemon doesn't appear to be running
    // (check by looking at last run times in DB)
  }
}
```

## Scheduler CLI (`src/scheduler.ts`)

Entry point exposed as `opencode-scheduler` bin. Shebang: `#!/usr/bin/env node`

### Subcommands

```
opencode-scheduler                # default: run one scheduler tick (check + execute due tasks)
opencode-scheduler --install      # detect OS, install launchd plist or systemd timer
opencode-scheduler --uninstall    # remove installed scheduler
opencode-scheduler --status       # show scheduler status, next task due times, recent runs
opencode-scheduler --run-once     # explicit alias for the default behavior
opencode-scheduler --list         # list all tasks with next run times
```

### Scheduler tick logic (default / --run-once)

```
1. Open SQLite DB (~/.config/opencode/.tasks.db), ensure schema exists
2. Read all .md files from ~/.config/opencode/tasks/
3. Parse and validate each task file
4. For each enabled recurring task:
   a. Get last successful run time from task_runs table
   b. Evaluate cron expression against last run time
   c. If due AND no currently running instance (concurrency guard):
      - Insert task_runs record with status='running'
      - Execute task via runner
      - Update task_runs record with result
5. For each pending one-off task where scheduled_at <= now:
   a. If status != 'running' (concurrency guard):
      - Update status to 'running'
      - Execute task via runner  
      - Update status to 'completed' or 'failed'
6. Clean up stale 'running' records (>2 hours old) -> mark as 'failed'
```

### Task runner logic (`src/lib/runner.ts`)

```typescript
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function executeTask(task: TaskConfig): Promise<RunResult> {
  // 1. Resolve session
  let sessionArgs: string[] = [];
  if (task.session_mode === "named") {
    const mapping = db.getSessionMapping(task.session_name);
    if (mapping) {
      sessionArgs = ["--session", mapping.session_id];
    } else {
      sessionArgs = ["--title", task.session_name];
    }
  } else {
    sessionArgs = ["--title", `${task.name} - ${new Date().toISOString()}`];
  }

  // 2. Build command args
  const args = [
    "run",
    ...sessionArgs,
    "--format", "json",
  ];
  if (task.model) args.push("--model", task.model);
  if (task.agent) args.push("--agent", task.agent);
  args.push(task.prompt);

  // 3. Build environment
  const env = { ...process.env };
  if (task.permission) {
    env.OPENCODE_PERMISSION = JSON.stringify(task.permission);
  }

  // 4. Execute via child_process
  try {
    const { stdout, stderr } = await execFileAsync("opencode", args, {
      cwd: expandPath(task.cwd),
      env,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    // 5. Parse JSON output for session ID
    const sessionId = parseSessionIdFromJsonOutput(stdout);

    // 6. Update session map if needed
    if (task.session_mode === "named" && sessionId) {
      db.upsertSessionMapping(task.session_name, sessionId, task.name);
    }

    return { success: true, sessionId };
  } catch (error: any) {
    return {
      success: false,
      error: error.stderr || error.message,
    };
  }
}
```

### Installer logic (`src/lib/installer.ts`)

Auto-detects the init system and installs the appropriate scheduler unit.

```typescript
import { execFileSync } from "node:child_process";

function detectPlatform(): "macos-launchd" | "linux-systemd" | "unsupported" {
  if (process.platform === "darwin") return "macos-launchd";
  if (process.platform === "linux") {
    try {
      execFileSync("systemctl", ["--version"], { stdio: "ignore" });
      return "linux-systemd";
    } catch {}
  }
  return "unsupported";
}

async function install(): Promise<void> {
  const platform = detectPlatform();

  // Resolve the path to `opencode-scheduler` binary
  // This is the `bin` entry from package.json -- we need its absolute path
  // for the launchd/systemd unit to reference
  const schedulerPath = resolveSchedulerPath();
  const nodePath = process.execPath; // path to node binary

  switch (platform) {
    case "macos-launchd":
      await installLaunchd(nodePath, schedulerPath);
      break;
    case "linux-systemd":
      await installSystemd(nodePath, schedulerPath);
      break;
    case "unsupported":
      console.error("Unsupported platform. Supported: macOS (launchd), Linux (systemd).");
      console.error("You can still run the scheduler manually:");
      console.error("  npx opencode-scheduler --run-once");
      process.exit(1);
  }
}
```

#### macOS launchd installation

Writes `~/Library/LaunchAgents/ai.opencode.scheduled-tasks.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ai.opencode.scheduled-tasks</string>
  <key>ProgramArguments</key>
  <array>
    <string>{process.execPath}</string>
    <string>{resolved path to dist/scheduler.js}</string>
    <string>--run-once</string>
  </array>
  <key>StartInterval</key>
  <integer>60</integer>
  <key>StandardOutPath</key>
  <string>{home}/.local/share/opencode/scheduler.log</string>
  <key>StandardErrorPath</key>
  <string>{home}/.local/share/opencode/scheduler.err</string>
  <key>RunAtLoad</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>{current PATH so opencode binary is findable}</string>
  </dict>
</dict>
</plist>
```

Then runs: `launchctl load ~/Library/LaunchAgents/ai.opencode.scheduled-tasks.plist`

**Key detail**: The plist references `{process.execPath}` (the Node binary) and the absolute path to `dist/scheduler.js`. This way launchd uses the same Node installation that ran `--install`, avoiding PATH resolution issues.

#### Linux systemd installation

Writes two files:

`~/.config/systemd/user/opencode-scheduler.service`:
```ini
[Unit]
Description=OpenCode Scheduled Tasks Runner

[Service]
Type=oneshot
ExecStart={process.execPath} {resolved path to dist/scheduler.js} --run-once
Environment=PATH={current PATH}
```

`~/.config/systemd/user/opencode-scheduler.timer`:
```ini
[Unit]
Description=OpenCode Scheduled Tasks Timer

[Timer]
OnBootSec=60
OnUnitActiveSec=60
AccuracySec=1s

[Install]
WantedBy=timers.target
```

Then runs:
```bash
systemctl --user daemon-reload
systemctl --user enable opencode-scheduler.timer
systemctl --user start opencode-scheduler.timer
```

#### Uninstall

Reverses the installation:
- macOS: `launchctl unload` + remove plist file
- Linux: `systemctl --user stop` + `disable` + remove service/timer files + `daemon-reload`

#### Status

```
$ npx opencode-scheduler --status

Scheduler: installed (macOS launchd)
  Last tick: 2026-03-30T14:23:00 (2 minutes ago)

Recurring tasks: 3 (2 enabled, 1 disabled)
  daily-cleanup     next: 2026-03-31T09:00:00  last: completed 2026-03-30T09:00:12
  weekly-report     next: 2026-04-06T08:00:00  last: completed 2026-03-30T08:00:45
  code-review       disabled

One-off tasks: 1 pending
  abc123...  "Run migration check"  scheduled: 2026-03-30T15:00:00
```

## Implementation Order

### Phase 1: Project setup + core infrastructure
- [ ] Initialize npm package (package.json, tsconfig.json, tsup.config.ts, .gitignore)
- [ ] Implement types (`src/lib/types.ts`)
- [ ] Implement SQLite database module (`src/lib/db.ts`) - schema creation, migrations, all CRUD ops
- [ ] Implement task file parser (`src/lib/tasks.ts`) - read .md, parse frontmatter with gray-matter, validate
- [ ] Implement cron evaluation (`src/lib/cron.ts`) - isDue(), nextRunTime() using cron-parser

### Phase 2: Plugin
- [ ] Plugin skeleton (`src/plugin.ts`) - exports, event handler, tool registration
- [ ] Implement `schedule_task` tool
- [ ] Implement `list_tasks` tool
- [ ] Implement `cancel_task` tool
- [ ] Implement `task_history` tool
- [ ] Implement `get_task_instructions` tool
- [ ] Implement `session.created` event handler (overdue task warnings)

### Phase 3: Scheduler CLI
- [ ] Implement task runner (`src/lib/runner.ts`) - session resolution, opencode run invocation, JSON output parsing
- [ ] Implement scheduler main loop (`src/scheduler.ts`) - arg parsing, tick logic
- [ ] Implement `--list` subcommand
- [ ] Implement `--status` subcommand

### Phase 4: Installer
- [ ] Implement platform detection (`src/lib/installer.ts`)
- [ ] Implement launchd installation (macOS)
- [ ] Implement systemd installation (Linux)
- [ ] Implement `--install` subcommand
- [ ] Implement `--uninstall` subcommand
- [ ] Resolve scheduler path correctly (handle npx, global install, local install cases)

### Phase 5: Polish + testing
- [ ] Error handling: graceful failures, timeouts, stale run cleanup
- [ ] Logging: structured log output to ~/.local/share/opencode/scheduler.log
- [ ] Path resolution: handle ~, $HOME, relative paths consistently
- [ ] Concurrency guard: prevent duplicate runs, clean up stale 'running' records
- [ ] Example task files in examples/ directory
- [ ] Unit tests for cron evaluation, task parsing, DB operations
- [ ] Integration test: end-to-end scheduler tick with mock opencode
- [ ] README with installation instructions, usage guide, task format docs
