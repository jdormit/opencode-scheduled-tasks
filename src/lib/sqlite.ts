/**
 * Runtime-agnostic SQLite abstraction.
 *
 * Uses bun:sqlite when running in Bun (OpenCode plugin runtime),
 * falls back to better-sqlite3 when running in Node.js (scheduler CLI).
 */

import { createRequire } from "node:module";

export interface Statement {
  run(...params: any[]): { changes: number };
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

export interface Database {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  pragma(pragma: string): any;
  close(): void;
}

// Detect runtime
const isBun = typeof (globalThis as any).Bun !== "undefined";

// createRequire gives us a CJS-style require() that works in ESM context
const require = createRequire(import.meta.url);

/**
 * Open a SQLite database using the appropriate runtime driver.
 */
export function openDatabase(path: string): Database {
  if (isBun) {
    return openBunDatabase(path);
  }
  return openNodeDatabase(path);
}

function openBunDatabase(path: string): Database {
  // bun:sqlite is available in Bun's runtime
  const { Database: BunDatabase } = require("bun:sqlite");
  const db = new BunDatabase(path);

  return {
    exec(sql: string) {
      db.exec(sql);
    },
    prepare(sql: string): Statement {
      const stmt = db.prepare(sql);
      return {
        run(...params: any[]) {
          const result = stmt.run(...params);
          return { changes: result.changes ?? 0 };
        },
        get(...params: any[]) {
          return stmt.get(...params);
        },
        all(...params: any[]) {
          return stmt.all(...params);
        },
      };
    },
    pragma(pragma: string) {
      return db.exec(`PRAGMA ${pragma}`);
    },
    close() {
      db.close();
    },
  };
}

function openNodeDatabase(path: string): Database {
  const BetterSqlite3 = require("better-sqlite3");
  const db = new BetterSqlite3(path);

  return {
    exec(sql: string) {
      db.exec(sql);
    },
    prepare(sql: string): Statement {
      const stmt = db.prepare(sql);
      return {
        run(...params: any[]) {
          const result = stmt.run(...params);
          return { changes: result.changes ?? 0 };
        },
        get(...params: any[]) {
          return stmt.get(...params);
        },
        all(...params: any[]) {
          return stmt.all(...params);
        },
      };
    },
    pragma(pragma: string) {
      return db.pragma(pragma);
    },
    close() {
      db.close();
    },
  };
}
