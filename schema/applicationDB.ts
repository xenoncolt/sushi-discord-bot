import { Db } from './database.js';

let db: Db | null = null;

function openDB(): Db {
    const database = new Db('./database/application.db');

    database.exec(`
        CREATE TABLE IF NOT EXISTS application_config (
            guild_id TEXT PRIMARY KEY,
            panel_channel_id TEXT NOT NULL,
            panel_msg_id TEXT,
            review_channel_id TEXT NOT NULL,
            reviewer_role_id TEXT,
            accepted_role_id TEXT,
            panel_title TEXT,
            panel_body TEXT,
            panel_button TEXT,
            panel_note TEXT
        )
    `);

    database.exec(`
        CREATE TABLE IF NOT EXISTS applications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            username TEXT NOT NULL,
            ign TEXT NOT NULL,
            player_type TEXT NOT NULL,
            content_type TEXT NOT NULL,
            path_build TEXT,
            weapons TEXT,
            activity_ok TEXT NOT NULL,
            about TEXT NOT NULL,
            previous_guild TEXT,
            pve_rank TEXT,
            screenshots TEXT NOT NULL,
            verify_passed INTEGER NOT NULL DEFAULT 0,
            verify_log TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'pending',
            submitted_at INTEGER NOT NULL,
            shots_inline INTEGER NOT NULL DEFAULT 0,
            review_msg_id TEXT,
            handled_by TEXT
        )
    `);

    // Questions are rows so they can be edited from the dashboard instead of
    // living in the code. A guild with no rows gets the built in set seeded on
    // first use, so an existing server sees exactly the form it had before.
    database.exec(`
        CREATE TABLE IF NOT EXISTS application_questions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            stage INTEGER NOT NULL DEFAULT 1,
            position INTEGER NOT NULL DEFAULT 0,
            field_id TEXT NOT NULL,
            type TEXT NOT NULL,
            label TEXT NOT NULL,
            description TEXT,
            placeholder TEXT,
            required INTEGER NOT NULL DEFAULT 1,
            paragraph INTEGER NOT NULL DEFAULT 0,
            min_values INTEGER,
            max_values INTEGER,
            min_length INTEGER,
            max_length INTEGER,
            options TEXT,
            shown_when TEXT NOT NULL DEFAULT 'always',
            role TEXT,
            enabled INTEGER NOT NULL DEFAULT 1
        )
    `);

    database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_questions_field ON application_questions (guild_id, field_id)`);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_questions_order ON application_questions (guild_id, stage, position)`);

    // Added after the first release, so databases created before it need the
    // column bolted on rather than recreated.
    // Panel wording is editable from the dashboard, so it lives with the rest
    // of the config rather than in the code.
    const config_columns = database.all<{ name: string }[]>(`PRAGMA table_info(application_config)`).map(column => column.name);

    for (const [name, type] of [["panel_title", "TEXT"], ["panel_body", "TEXT"], ["panel_button", "TEXT"], ["panel_note", "TEXT"]] as const) {
        if (!config_columns.includes(name)) database.exec(`ALTER TABLE application_config ADD COLUMN ${name} ${type}`);
    }

    const columns = database.all<{ name: string }[]>(`PRAGMA table_info(applications)`).map(column => column.name);

    if (!columns.includes("shots_inline")) {
        database.exec(`ALTER TABLE applications ADD COLUMN shots_inline INTEGER NOT NULL DEFAULT 0`);
    }

    if (!columns.includes("previous_guild")) {
        database.exec(`ALTER TABLE applications ADD COLUMN previous_guild TEXT`);
    }

    // Every answer, including ones to questions the guild added itself. The
    // older typed columns stay put so applications taken before this still
    // render.
    if (!columns.includes("answers")) {
        database.exec(`ALTER TABLE applications ADD COLUMN answers TEXT`);
    }

    // Review posts are looked up by guild + applicant on every button press.
    database.exec(`CREATE INDEX IF NOT EXISTS idx_applications_user ON applications (guild_id, user_id)`);

    return database;
}

export function createApplicationTable(): Db {
    if (!db) {
        db = openDB();
    }
    return db;
}
