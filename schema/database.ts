import { DatabaseSync, SQLInputValue } from "node:sqlite";

export interface RunResult {
    lastID: number;
    changes: number;
}

// node:sqlite ships inside Node itself, so there is no compiled binding that
// can go stale when the server's glibc is older than whatever built the
// prebuilt one. It is synchronous, and these helpers keep the same shapes the
// queries in this project were already written against.
export class Db {
    private readonly db: DatabaseSync;

    constructor(filename: string) {
        this.db = new DatabaseSync(filename);

        // Set through pragmas rather than constructor options so this works on
        // every Node version that has node:sqlite at all.
        this.db.exec(`PRAGMA journal_mode = WAL;`);
        this.db.exec(`PRAGMA busy_timeout = 5000;`);
    }

    exec(sql: string): void {
        this.db.exec(sql);
    }

    private depth = 0;

    // Runs `fn` as one transaction: every write in it lands, or none do, even
    // if the process dies halfway through. `fn` must be synchronous. A nested
    // call simply joins the transaction already open.
    transaction<T>(fn: () => T): T {
        if (this.depth > 0) return fn();

        this.db.exec(`BEGIN IMMEDIATE`);
        this.depth++;
        try {
            const result = fn();
            this.db.exec(`COMMIT`);
            return result;
        } catch (err) {
            this.db.exec(`ROLLBACK`);
            throw err;
        } finally {
            this.depth--;
        }
    }

    get<T>(sql: string, ...params: unknown[]): T | undefined {
        return this.db.prepare(sql).get(...bind(params)) as T | undefined;
    }

    all<T>(sql: string, ...params: unknown[]): T {
        return this.db.prepare(sql).all(...bind(params)) as T;
    }

    run(sql: string, ...params: unknown[]): RunResult {
        const changed = this.db.prepare(sql).run(...bind(params));

        // Both come back as a number or a bigint depending on how large they
        // grow, and every caller here treats them as plain numbers.
        return {
            lastID: Number(changed.lastInsertRowid),
            changes: Number(changed.changes)
        };
    }
}

// The old driver quietly turned undefined into NULL and booleans into 0 or 1.
// node:sqlite throws on both, and several call sites pass an optional id.
function bind(params: unknown[]): SQLInputValue[] {
    return params.map(value => {
        if (value === undefined) return null;
        if (typeof value === "boolean") return value ? 1 : 0;

        return value as SQLInputValue;
    });
}
