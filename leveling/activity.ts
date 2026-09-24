import { createLevelingTable } from "../schema/levelingDB.js";


const db = createLevelingTable();

export type ActivityType = "settings" | "xp" | "level" | "roles" | "games" | "shop" | "reset";

export interface ActivityEntry {
    guild_id: string;
    type: ActivityType;
    user_id?: string | null;
    user_name?: string | null;
    text: string;
    amount?: number | null;
    actor_id?: string | null;
    actor_name?: string | null;
}

export interface ActivityRow extends Required<ActivityEntry> {
    id: number;
    created_at: number;
}

// The dashboard's Activity page. Kept for 90 days, which is plenty to answer
// "who changed that" or "where did my XP go".
const KEEP_MS = 90 * 24 * 60 * 60 * 1000;

export function logActivity(entry: ActivityEntry): void {
    try {
        db.run(
            `INSERT INTO activity (guild_id, type, user_id, user_name, text, amount, actor_id, actor_name, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            entry.guild_id,
            entry.type,
            entry.user_id ?? null,
            entry.user_name ?? null,
            entry.text,
            entry.amount ?? null,
            entry.actor_id ?? null,
            entry.actor_name ?? null,
            Date.now()
        );
    } catch (err) {
        // A failed log line must never break the thing being logged.
        console.error("Failed to write activity log:", err);
    }
}

export function listActivity(guild_id: string, opts: { type?: string; search?: string; before?: number; limit?: number }): ActivityRow[] {
    const where = [`guild_id = ?`];
    const params: unknown[] = [guild_id];

    if (opts.type) {
        where.push(`type = ?`);
        params.push(opts.type);
    }
    if (opts.before) {
        where.push(`id < ?`);
        params.push(opts.before);
    }
    if (opts.search) {
        const like = `%${opts.search.replace(/[\\%_]/g, c => `\\${c}`)}%`;
        where.push(`(user_name LIKE ? ESCAPE '\\' OR text LIKE ? ESCAPE '\\' OR actor_name LIKE ? ESCAPE '\\' OR user_id = ?)`);
        params.push(like, like, like, opts.search);
    }

    params.push(Math.min(100, opts.limit ?? 50));
    return db.all<ActivityRow[]>(
        `SELECT * FROM activity WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ?`,
        ...params
    );
}

export function pruneActivity(): void {
    const cutoff = Date.now() - KEEP_MS;
    db.run(`DELETE FROM activity WHERE created_at < ?`, cutoff);
    db.run(`DELETE FROM gamble_log WHERE created_at < ?`, cutoff);
}
