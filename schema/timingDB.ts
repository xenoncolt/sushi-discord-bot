import { open } from 'sqlite';
import sqlite3 from 'sqlite3';

async function timingDB() {
    return open({
        filename: './database/timing.db',
        driver: sqlite3.Database
    });
}

export async function createTimingTable() {
    const db = await timingDB();
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
    `)
    return db;
} 