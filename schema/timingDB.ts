import { Db } from './database.js';

let db: Db | null = null;

function openDB(): Db {
    const database = new Db('./database/timing.db');

    database.exec(`
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

    return database;
}

export function createTimingTable(): Db {
    if (!db) {
        db = openDB();
    }
    return db;
}
