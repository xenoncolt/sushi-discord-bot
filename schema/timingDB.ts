import { open, Database } from 'sqlite';
import sqlite3 from 'sqlite3';

let db_promise: Promise<Database> | null = null;

async function openDB(): Promise<Database> {
    const db = await open({
        filename: './database/timing.db',
        driver: sqlite3.Database
    });

    await db.exec(`PRAGMA journal_mode = WAL;`);
    await db.exec(`PRAGMA busy_timeout = 5000;`);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS timing (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_name TEXT NOT NULL,
            event_time INTEGER NOT NULL,
            channel_id TEXT NOT NULL,
            guild_id TEXT NOT NULL,
            msg TEXT NOT NULL,
            type TEXT,
            board_channel_id TEXT,
            board_msg_id TEXT
        )
    `);

    return db;
}

export function createTimingTable(): Promise<Database> {
    if (!db_promise) {
        db_promise = openDB();
    }
    return db_promise;
}
