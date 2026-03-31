/**
 * Permission configuration - mirrors the opencode.json permission schema.
 * Can be a simple action string or a per-tool object with glob patterns.
 */
export type PermissionAction = "allow" | "ask" | "deny";

export type PermissionRule =
  | PermissionAction
  | Record<string, PermissionAction>;

export type PermissionConfig = Record<string, PermissionRule>;

/**
 * Session mode for task execution.
 * - "new": Create a fresh session for each run
 * - "named": Reuse a session with a specific name (created if it doesn't exist)
 */
export type SessionMode = "new" | "named";

/**
 * A recurring task definition parsed from a markdown file in ~/.config/opencode/tasks/
 */
export interface RecurringTask {
  /** Unique task identifier (must match filename without .md) */
  name: string;
  /** Human-readable description */
  description: string;
  /** Cron expression (5-field standard cron) */
  schedule: string;
  /** Working directory for task execution. Supports ~ expansion. */
  cwd: string;
  /** Whether to reuse a named session or create a new one each run */
  sessionMode: SessionMode;
  /** Session name (required if sessionMode is "named") */
  sessionName?: string;
  /** Model in provider/model format */
  model?: string;
  /** Agent to use */
  agent?: string;
  /** Permission config (same schema as opencode.json permission key) */
  permission?: PermissionConfig;
  /** Whether the task is active */
  enabled: boolean;
  /** The prompt (markdown body of the task file) */
  prompt: string;
  /** Absolute path to the source .md file */
  filePath: string;
}

/**
 * Task frontmatter as parsed from YAML (before normalization)
 */
export interface TaskFrontmatter {
  name: string;
  description: string;
  schedule: string;
  cwd: string;
  session_mode?: string;
  session_name?: string;
  model?: string;
  agent?: string;
  permission?: PermissionConfig;
  enabled?: boolean;
}

/**
 * Status of a one-off task
 */
export type OneoffTaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * Status of a recurring task run
 */
export type TaskRunStatus = "running" | "completed" | "failed";

/**
 * A one-off task stored in SQLite
 */
export interface OneoffTask {
  id: string;
  description: string;
  prompt: string;
  cwd: string;
  scheduledAt: string;
  sessionMode: SessionMode;
  sessionName?: string;
  model?: string;
  agent?: string;
  permission?: PermissionConfig;
  status: OneoffTaskStatus;
  createdAt: string;
  executedAt?: string;
  sessionId?: string;
  error?: string;
  createdBySession?: string;
  /** PID of the worker process executing this task */
  pid?: number;
}

/**
 * A run record for a recurring task
 */
export interface TaskRun {
  id: string;
  taskName: string;
  startedAt: string;
  completedAt?: string;
  status: TaskRunStatus;
  sessionId?: string;
  error?: string;
  /** PID of the worker process executing this task */
  pid?: number;
}

/**
 * Session name to session ID mapping
 */
export interface SessionMapping {
  sessionName: string;
  sessionId: string;
  taskName?: string;
  updatedAt: string;
}

/**
 * Unified task config passed to the runner (works for both recurring and one-off)
 */
export interface TaskExecConfig {
  name: string;
  prompt: string;
  cwd: string;
  sessionMode: SessionMode;
  sessionName?: string;
  model?: string;
  agent?: string;
  permission?: PermissionConfig;
}

/**
 * Result of a task execution
 */
export interface RunResult {
  success: boolean;
  sessionId?: string;
  error?: string;
}
