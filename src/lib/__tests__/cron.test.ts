import { describe, it, expect } from "bun:test";
import {
  isValidCron,
  getNextRunTime,
  getPreviousRunTime,
  isDue,
} from "../cron.js";

describe("cron", () => {
  describe("isValidCron", () => {
    it("accepts valid cron expressions", () => {
      expect(isValidCron("0 9 * * *")).toBe(true);
      expect(isValidCron("*/5 * * * *")).toBe(true);
      expect(isValidCron("0 0 1 * *")).toBe(true);
      expect(isValidCron("0 9 * * 1-5")).toBe(true);
    });

    it("rejects invalid cron expressions", () => {
      expect(isValidCron("not a cron")).toBe(false);
      expect(isValidCron("60 * * * *")).toBe(false);
    });
  });

  describe("getNextRunTime", () => {
    it("returns a time in the future", () => {
      const after = new Date("2026-03-30T10:00:00Z");
      const next = getNextRunTime("* * * * *", after);
      const nextDate = new Date(next);
      expect(nextDate > after).toBe(true);
    });

    it("returns a valid ISO string", () => {
      const next = getNextRunTime("0 9 * * *");
      expect(new Date(next).toISOString()).toBe(next);
    });
  });

  describe("getPreviousRunTime", () => {
    it("returns a time in the past", () => {
      const before = new Date("2026-03-30T10:00:00Z");
      const prev = getPreviousRunTime("* * * * *", before);
      const prevDate = new Date(prev);
      expect(prevDate < before).toBe(true);
    });

    it("returns a valid ISO string", () => {
      const prev = getPreviousRunTime("0 9 * * *");
      expect(new Date(prev).toISOString()).toBe(prev);
    });
  });

  describe("isDue", () => {
    it("returns true when task has never run and cron trigger is recent", () => {
      // Every minute - definitely has a recent trigger
      expect(isDue("* * * * *")).toBe(true);
    });

    it("returns true when last run was before the most recent trigger", () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      // "every minute" always has a trigger between yesterday and now
      expect(isDue("* * * * *", yesterday.toISOString())).toBe(true);
    });

    it("returns false when last run was after the most recent trigger", () => {
      // If we just ran 1 second ago, and the cron is daily at a future hour
      const justNow = new Date(Date.now() - 1000).toISOString();
      // Use an hour in the future
      const futureHour = (new Date().getHours() + 2) % 24;
      expect(isDue(`0 ${futureHour} * * *`, justNow)).toBe(false);
    });

    it("handles never-run tasks without crashing", () => {
      // Monthly on the 1st
      const result = isDue("0 0 1 1 *");
      expect(typeof result).toBe("boolean");
    });
  });
});
