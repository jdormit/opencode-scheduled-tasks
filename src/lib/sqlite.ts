/**
 * SQLite abstraction using bun:sqlite.
 *
 * Both the OpenCode plugin runtime and the CLI run in Bun,
 * so we use bun:sqlite directly everywhere.
 */

import { Database as BunDatabase } from "bun:sqlite";

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

/**
 * Open a SQLite database using bun:sqlite.
 */
export function openDatabase(path: string): Database {
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
