import { Db } from './database.js';

let db: Db | null = null;

function openDB(): Db {
    const database = new Db('./database/leveling.db');

    // Every setting a server can change on the dashboard lives in one JSON blob
    // per guild. It is read once and cached (see leveling/settings.ts), so the
    // hot paths never touch this table.
    database.exec(`
        CREATE TABLE IF NOT EXISTS guild_settings (
            guild_id TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        )
    `);

    // Bookkeeping the dashboard never edits: posted leaderboard message ids,
    // the next season reset, and so on.
    database.exec(`
        CREATE TABLE IF NOT EXISTS guild_state (
            guild_id TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            PRIMARY KEY (guild_id, key)
        ) WITHOUT ROWID
    `);

    // month_xp only counts while month_key is the current month, and the
    // streak only counts while att_last is today or yesterday. Both are
    // checked when read, so nothing has to sweep the table at midnight.
    database.exec(`
        CREATE TABLE IF NOT EXISTS members (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            xp INTEGER NOT NULL DEFAULT 0,
            level INTEGER NOT NULL DEFAULT 0,
            month_key TEXT,
            month_xp INTEGER NOT NULL DEFAULT 0,
            att_total INTEGER NOT NULL DEFAULT 0,
            att_streak INTEGER NOT NULL DEFAULT 0,
            att_last TEXT,
            bonus_last TEXT,
            name TEXT,
            avatar TEXT,
            updated_at INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (guild_id, user_id)
        ) WITHOUT ROWID
    `);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_members_xp ON members (guild_id, xp DESC)`);

    database.exec(`
        CREATE TABLE IF NOT EXISTS activity (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            type TEXT NOT NULL,
            user_id TEXT,
            user_name TEXT,
            text TEXT NOT NULL,
            amount INTEGER,
            actor_id TEXT,
            actor_name TEXT,
            created_at INTEGER NOT NULL
        )
    `);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_activity_guild ON activity (guild_id, id DESC)`);

    database.exec(`
        CREATE TABLE IF NOT EXISTS gamble_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            game TEXT NOT NULL,
            bet INTEGER NOT NULL,
            payout INTEGER NOT NULL,
            net INTEGER NOT NULL,
            detail TEXT,
            created_at INTEGER NOT NULL
        )
    `);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_gamble_user ON gamble_log (guild_id, user_id, id DESC)`);

    database.exec(`
        CREATE TABLE IF NOT EXISTS stats_daily (
            guild_id TEXT NOT NULL,
            day TEXT NOT NULL,
            messages INTEGER NOT NULL DEFAULT 0,
            voice_minutes INTEGER NOT NULL DEFAULT 0,
            xp INTEGER NOT NULL DEFAULT 0,
            active_users INTEGER NOT NULL DEFAULT 0,
            joins INTEGER NOT NULL DEFAULT 0,
            leaves INTEGER NOT NULL DEFAULT 0,
            member_count INTEGER,
            PRIMARY KEY (guild_id, day)
        ) WITHOUT ROWID
    `);
    const daily_cols = database.all<{ name: string }[]>(`PRAGMA table_info(stats_daily)`).map(c => c.name);
    for (const [col, def] of [["joins", "INTEGER NOT NULL DEFAULT 0"], ["leaves", "INTEGER NOT NULL DEFAULT 0"], ["member_count", "INTEGER"]]) {
        if (!daily_cols.includes(col)) database.exec(`ALTER TABLE stats_daily ADD COLUMN ${col} ${def}`);
    }

    // Finer-grained counts: per hour for the "Today" view (kept a few days),
    // per channel for the busiest-channels chart.
    database.exec(`
        CREATE TABLE IF NOT EXISTS stats_hourly (
            guild_id TEXT NOT NULL,
            hour TEXT NOT NULL,
            messages INTEGER NOT NULL DEFAULT 0,
            voice_minutes INTEGER NOT NULL DEFAULT 0,
            xp INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (guild_id, hour)
        ) WITHOUT ROWID
    `);
    database.exec(`
        CREATE TABLE IF NOT EXISTS stats_channel (
            guild_id TEXT NOT NULL,
            day TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            messages INTEGER NOT NULL DEFAULT 0,
            xp INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (guild_id, day, channel_id)
        ) WITHOUT ROWID
    `);
    database.exec(`
        CREATE TABLE IF NOT EXISTS stats_active (
            guild_id TEXT NOT NULL,
            day TEXT NOT NULL,
            user_id TEXT NOT NULL,
            PRIMARY KEY (guild_id, day, user_id)
        ) WITHOUT ROWID
    `);

    database.exec(`
        CREATE TABLE IF NOT EXISTS shop_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            emoji TEXT NOT NULL DEFAULT '',
            price INTEGER NOT NULL,
            type TEXT NOT NULL,
            role_id TEXT,
            duration_hours INTEGER NOT NULL DEFAULT 0,
            stock INTEGER NOT NULL DEFAULT -1,
            per_user_limit INTEGER NOT NULL DEFAULT 0,
            enabled INTEGER NOT NULL DEFAULT 1,
            sort INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        )
    `);
    database.exec(`
        CREATE TABLE IF NOT EXISTS shop_purchases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            item_id INTEGER NOT NULL,
            item_name TEXT NOT NULL,
            price INTEGER NOT NULL,
            type TEXT NOT NULL,
            role_id TEXT,
            status TEXT NOT NULL,
            expires_at INTEGER,
            created_at INTEGER NOT NULL,
            used_at INTEGER,
            handled_by TEXT
        )
    `);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_purchases_user ON shop_purchases (guild_id, user_id)`);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_purchases_expiry ON shop_purchases (status, expires_at)`);

    // Past seasons keep the whole ranking as JSON so the "View full rankings"
    // page still works after everybody's numbers were zeroed.
    database.exec(`
        CREATE TABLE IF NOT EXISTS seasons (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            target TEXT NOT NULL,
            ended_at INTEGER NOT NULL,
            xp_rank TEXT,
            total_rank TEXT,
            streak_rank TEXT
        )
    `);

    // Stakes of games still being played. Games live in memory, so this is
    // how a bet survives the bot stopping mid-game: whatever is left here at
    // start-up is handed back (see recoverStakes in games/common.ts).
    database.exec(`
        CREATE TABLE IF NOT EXISTS game_escrow (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            amount INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (guild_id, user_id)
        ) WITHOUT ROWID
    `);

    // /loan. The whole life of a loan is one row: pending (offered) → active
    // (accepted, XP moved) → repaid, or declined/cancelled/expired before it
    // started. A loan the borrower asked for first starts one step earlier, at
    // requested, and becomes pending once the lender fills in the terms.
    // `interest` is fixed when offered, so what the borrower owes
    // (amount + interest) never changes. See leveling/loans.ts.
    database.exec(`
        CREATE TABLE IF NOT EXISTS loans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            lender_id TEXT NOT NULL,
            borrower_id TEXT NOT NULL,
            amount INTEGER NOT NULL,
            interest INTEGER NOT NULL,
            interest_pct REAL,
            duration_ms INTEGER NOT NULL,
            status TEXT NOT NULL,
            channel_id TEXT,
            message_id TEXT,
            created_at INTEGER NOT NULL,
            accepted_at INTEGER,
            due_at INTEGER,
            overdue_notified INTEGER NOT NULL DEFAULT 0,
            closed_at INTEGER,
            requested_amount INTEGER,
            closed_by TEXT
        )
    `);
    // requested_amount: what the borrower asked for with /loan ask, NULL when
    // the lender offered first. closed_by: who declined or withdrew it.
    const loan_cols = database.all<{ name: string }[]>(`PRAGMA table_info(loans)`).map(c => c.name);
    for (const [col, def] of [["requested_amount", "INTEGER"], ["closed_by", "TEXT"]]) {
        if (!loan_cols.includes(col)) database.exec(`ALTER TABLE loans ADD COLUMN ${col} ${def}`);
    }
    database.exec(`CREATE INDEX IF NOT EXISTS idx_loans_status ON loans (status, due_at)`);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_loans_borrower ON loans (guild_id, borrower_id, status)`);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_loans_lender ON loans (guild_id, lender_id, status)`);

    // Stretches of time the bot was offline (process down or Discord
    // unreachable), so /daily streaks don't break over a day nobody could
    // check in. See leveling/uptime.ts.
    database.exec(`
        CREATE TABLE IF NOT EXISTS downtime (
            started_at INTEGER NOT NULL,
            ended_at INTEGER NOT NULL
        )
    `);

    // Process-wide bookkeeping: the uptime heartbeat and what a clean
    // shutdown saves for the next start (voice minutes, chat cooldowns).
    database.exec(`
        CREATE TABLE IF NOT EXISTS bot_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        ) WITHOUT ROWID
    `);

    // One row per member per server. `year` is optional: without it the
    // announcement simply leaves the age out. The sticky panel that collects
    // these, and the announcement itself, are configured on the dashboard.
    database.exec(`
        CREATE TABLE IF NOT EXISTS birthdays (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            month INTEGER NOT NULL,
            day INTEGER NOT NULL,
            year INTEGER,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (guild_id, user_id)
        ) WITHOUT ROWID
    `);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_birthdays_day ON birthdays (guild_id, month, day)`);

    // Messages built on the dashboard's Message Builder. `data` is the whole
    // document (see messages/schema.ts); channel_id and message_id remember
    // where it was last posted so the same draft can be edited in place, and
    // role buttons and menus inside it are looked up by this row's id when
    // somebody presses them.
    database.exec(`
        CREATE TABLE IF NOT EXISTS custom_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            name TEXT NOT NULL,
            data TEXT NOT NULL,
            channel_id TEXT,
            message_id TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
    `);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_custom_messages_guild ON custom_messages (guild_id, id DESC)`);

    database.exec(`
        CREATE TABLE IF NOT EXISTS dashboard_sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            username TEXT NOT NULL,
            global_name TEXT,
            avatar TEXT,
            guilds TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
        )
    `);

    return database;
}

export function createLevelingTable(): Db {
    if (!db) {
        db = openDB();
    }
    return db;
}
