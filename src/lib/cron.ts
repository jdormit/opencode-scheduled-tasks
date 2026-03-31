import cronParser from "cron-parser";

// Handle CJS/ESM interop: in Node ESM, the default import is the module
// namespace object; the actual class is at .CronExpressionParser or .default
const CronExpressionParser =
  (cronParser as any).CronExpressionParser ?? cronParser;

/**
 * Check if a cron expression is valid
 */
export function isValidCron(expression: string): boolean {
  try {
    CronExpressionParser.parse(expression);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the next run time for a cron expression after the given date.
 * Returns an ISO 8601 string.
 */
export function getNextRunTime(expression: string, after?: Date): string {
  const expr = CronExpressionParser.parse(expression, {
    currentDate: after ?? new Date(),
  });
  const next = expr.next().toISOString();
  if (!next) throw new Error(`No next run time for expression "${expression}"`);
  return next;
}

/**
 * Get the previous run time for a cron expression before the given date.
 * Returns an ISO 8601 string.
 */
export function getPreviousRunTime(
  expression: string,
  before?: Date
): string {
  const expr = CronExpressionParser.parse(expression, {
    currentDate: before ?? new Date(),
  });
  const prev = expr.prev().toISOString();
  if (!prev) throw new Error(`No previous run time for expression "${expression}"`);
  return prev;
}

/**
 * Determine if a recurring task is due for execution.
 *
 * A task is due if:
 * - It has never run before, OR
 * - The last run was before the most recent cron trigger time
 *
 * For tasks that have never run, we only consider them due if the previous
 * trigger is within the last 24 hours (to avoid running very old tasks on
 * first install).
 *
 * @param expression - Cron expression
 * @param lastRunTime - ISO 8601 timestamp of last successful run, or undefined if never run
 * @returns true if the task should be executed now
 */
export function isDue(expression: string, lastRunTime?: string): boolean {
  if (!lastRunTime) {
    // Never run before - check if the cron has a trigger time in the past
    // within the last 24 hours
    const prevTrigger = new Date(getPreviousRunTime(expression));
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return prevTrigger >= twentyFourHoursAgo;
  }

  // Find the most recent cron trigger time
  const prevTrigger = new Date(getPreviousRunTime(expression));
  const lastRun = new Date(lastRunTime);

  // Task is due if the most recent trigger is after the last run
  return prevTrigger > lastRun;
}
