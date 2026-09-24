import { createLevelingTable } from "../schema/levelingDB.js";
import { bool, color, id, ids, num, obj, oneOf, str } from "./sanitize.js";
import { isValidTimeZone } from "./time.js";


const db = createLevelingTable();

export const GAME_KEYS = [
    "oddeven", "dice", "baskin", "roulette", "indianpoker", "tictactoe",
    "scratch", "slot", "wheel", "minesweeper", "highlow", "blackjack", "tower", "horserace", "bomb"
] as const;
export type GameKey = typeof GAME_KEYS[number];

export const PVP_GAMES: GameKey[] = ["oddeven", "dice", "baskin", "roulette", "indianpoker", "tictactoe"];

export interface MessageTemplate {
    title: string;
    body: string;
    color: string;
    thumbnail: boolean;
    image: string;
    footer: string;
}

export interface WheelSegment {
    emoji: string;
    multiplier: number;
    weight: number;
}

export interface GameSettings {
    enabled: boolean;
    cooldown: number;
    min_bet: number;
    max_bet: number;
    fee: number;          // PvP: % of the winnings (the loser's stake) the house keeps
    multiplier: number;   // scratch, slot, blackjack, horserace
    mines: number;
    per_step: number;     // minesweeper per reveal, tower per floor
    house_edge: number;   // highlow: % the house keeps; every guess pays fair odds minus this
    max_rounds: number;   // highlow
    floors: number;
    traps: number;
    horses: number;
    attempts: number;     // bomb
    first_try: number;    // bomb: payout × for defusing on the first try
    try_drop: number;     // bomb: the payout × drops by this with every extra try
    segments: WheelSegment[];
}

export interface Boost {
    id: string;
    type: "all" | "role" | "channel" | "category" | "daily";
    target_id: string | null;
    amount: number;
    expires_at: number | null;
}

export interface Ignore {
    type: "channel" | "category" | "role";
    id: string;
}

export interface LevelRole {
    level: number;
    role_id: string;
}

export interface AttendanceRole {
    type: "total" | "streak";
    threshold: number;
    role_id: string;
}

export interface BirthdaySettings {
    enabled: boolean;
    // Where the announcement goes. The panel may sit in the same channel, which
    // is what the sticky repost is for.
    announce_channel: string | null;
    // "HH:MM" on the server's own clock (Server page timezone).
    announce_time: string;
    mention_user: boolean;
    ping_role: string | null;
    // Worn for the day and taken off again the next.
    birthday_role: string | null;
    // Added to the announcement only when that member shared a year.
    age_line: string;
    panel_channel: string | null;
    panel_sticky: boolean;
    set_label: string;
    remove_label: string;
    list_label: string;
    templates: {
        panel: MessageTemplate;
        announce: MessageTemplate;
    };
}

export interface WelcomeButton {
    // Stable key so the dashboard can reorder and delete rows safely.
    id: string;
    label: string;
    emoji: string;
    // "channel" jumps to a channel in this server, "url" goes anywhere.
    // Discord only allows link-styled buttons to carry a URL, so there is no
    // style to pick: both kinds render grey with an outbound arrow.
    kind: "channel" | "url";
    channel_id: string | null;
    url: string;
}

// The welcome message is built out of these, in order. Where a button sits is
// simply which block it is in, so there are no position markers to keep in
// step with the text.
export interface WelcomeBlock {
    id: string;
    // "text"      a paragraph, optionally with something down its right side
    // "buttons"   a row of up to five buttons
    // "image"     wherever the drawn welcome card goes
    // "separator" a dividing line
    type: "text" | "buttons" | "image" | "separator";

    // type "text"
    text: string;
    // What sits to the right of a text block. Discord's section takes exactly
    // one accessory, so it is the member's avatar or a single button, never
    // both. "button" uses the first entry of `buttons` below.
    accessory: "none" | "avatar" | "button";

    // type "buttons": the whole row. type "text" with accessory "button":
    // just the first one.
    buttons: WelcomeButton[];

    // type "separator": a visible line, or just breathing room.
    divider: boolean;
}

export interface WelcomeCard {
    enabled: boolean;
    // Drawn behind everything; empty means the flat colour on its own.
    background: string;
    background_color: string;
    // How hard to darken the background, 0-100, so light photos stay readable.
    overlay: number;
    accent: string;
    text_color: string;
    sub_color: string;
    title: string;
    subtitle: string;
    footer: string;
    avatar_shape: "circle" | "rounded" | "square";
    avatar_ring: boolean;
    // "center" stacks the text under the avatar, "left" sets it beside.
    layout: "center" | "left";
}

export interface WelcomeSettings {
    enabled: boolean;
    channel: string | null;
    mention_user: boolean;
    ping_role: string | null;
    // The container's accent stripe.
    color: string;
    // Always last, under a divider, in Discord's small grey text. Empty for
    // no footer at all.
    footer: string;
    blocks: WelcomeBlock[];
    card: WelcomeCard;
}

export interface GuildSettings {
    server: {
        xp_name: string;
        chat_xp: number;
        voice_xp: number;
        daily_xp: number;
        chat_cooldown: number;
        formula: { multiplier: number; offset: number; divider: number };
        voice_mute_mode: "disabled" | "block" | "reduce";
        voice_mute_reduction: number;
        voice_require_company: boolean;
        gift_enabled: boolean;
        loan_enabled: boolean;
        reset_left_users: boolean;
        private_daily: boolean;
        bonus_enabled: boolean;
        bonus_xp: number;
        timezone: string;
    };
    roles: {
        admin_roles: string[];
        role_channel: string | null;
        level_roles: LevelRole[];
        level_highest_only: boolean;
        attendance_roles: AttendanceRole[];
        attendance_highest_only: boolean;
    };
    boosts: Boost[];
    ignores: Ignore[];
    notifications: {
        levelup_enabled: boolean;
        levelup_channel: string | null;
        shop_log_channel: string | null;
        shop_admin_channel: string | null;
        templates: {
            levelup: MessageTemplate;
            role: MessageTemplate;
            total: MessageTemplate;
            streak: MessageTemplate;
        };
    };
    gamble: {
        enabled: boolean;
        channels: string[];
        games: Record<GameKey, GameSettings>;
    };
    level: {
        // Nickname prefix, e.g. "[LV.{level}]". Empty = off.
        prefix: string;
    };
    leaderboard: {
        xp_channel: string | null;
        monthly_channel: string | null;
        total_channel: string | null;
        streak_channel: string | null;
        color: string;
        titles: { xp: string; monthly: string; total: string; streak: string };
    };
    season: {
        enabled: boolean;
        period: "monthly" | "quarterly" | "half" | "yearly" | "date";
        date: string;
        time: string;
        target: "exp" | "attendance" | "both";
        announce_channel: string | null;
        custom_announce: boolean;
        announce_title: string;
        announce_body: string;
        log_channel: string | null;
    };
    birthday: BirthdaySettings;
    welcome: WelcomeSettings;
}

export type SettingsSection = keyof GuildSettings;
export const SECTIONS: SettingsSection[] = ["server", "level", "roles", "boosts", "ignores", "notifications", "gamble", "leaderboard", "season", "birthday", "welcome"];


function game(overrides: Partial<GameSettings>): GameSettings {
    return {
        enabled: true,
        cooldown: 0,
        min_bet: 0,
        max_bet: 0,
        fee: 3,
        multiplier: 2,
        mines: 4,
        per_step: 0.2,
        house_edge: 3,
        max_rounds: 15,
        floors: 8,
        traps: 1,
        horses: 5,
        attempts: 6,
        first_try: 3,
        try_drop: 0.5,
        segments: [],
        ...overrides
    };
}

export const DEFAULT_WHEEL: WheelSegment[] = [
    { emoji: "💀", multiplier: 0, weight: 35 },
    { emoji: "🔸", multiplier: 0.5, weight: 25 },
    { emoji: "⚡", multiplier: 1, weight: 18 },
    { emoji: "⭐", multiplier: 2, weight: 12 },
    { emoji: "💎", multiplier: 3, weight: 6 },
    { emoji: "🔥", multiplier: 5, weight: 4 }
];

export function defaultSettings(): GuildSettings {
    return {
        server: {
            xp_name: "EXP",
            chat_xp: 1,
            voice_xp: 25,
            daily_xp: 10,
            chat_cooldown: 0,
            formula: { multiplier: 2, offset: 5, divider: 10 },
            voice_mute_mode: "disabled",
            voice_mute_reduction: 50,
            voice_require_company: true,
            gift_enabled: true,
            loan_enabled: true,
            reset_left_users: false,
            private_daily: false,
            bonus_enabled: true,
            bonus_xp: 30,
            timezone: "UTC"
        },
        roles: {
            admin_roles: [],
            role_channel: null,
            level_roles: [],
            level_highest_only: false,
            attendance_roles: [],
            attendance_highest_only: false
        },
        boosts: [],
        ignores: [],
        notifications: {
            levelup_enabled: true,
            levelup_channel: null,
            shop_log_channel: null,
            shop_admin_channel: null,
            templates: {
                levelup: {
                    title: "🎉 Level Up!",
                    body: "{mention} has reached **level {level}**!\nKeep chatting to climb even higher.",
                    color: "#d6336c",
                    thumbnail: true,
                    image: "",
                    footer: "{xp} {xp_name} total"
                },
                role: {
                    title: "🏅 New Role Unlocked",
                    body: "{mention} reached **level {level}** and earned {roleMention}!",
                    color: "#f59f00",
                    thumbnail: true,
                    image: "",
                    footer: ""
                },
                total: {
                    title: "📅 Attendance Reward",
                    body: "{mention} checked in **{count}** times and earned {roleMention}!",
                    color: "#4dabf7",
                    thumbnail: true,
                    image: "",
                    footer: ""
                },
                streak: {
                    title: "🔥 Streak Reward",
                    body: "{mention} kept a **{count}-day** streak and earned {roleMention}!",
                    color: "#ff6b6b",
                    thumbnail: true,
                    image: "",
                    footer: ""
                }
            }
        },
        gamble: {
            enabled: true,
            channels: [],
            games: {
                oddeven: game({}),
                dice: game({}),
                baskin: game({}),
                roulette: game({}),
                indianpoker: game({}),
                tictactoe: game({}),
                scratch: game({ multiplier: 2, cooldown: 5 }),
                slot: game({ multiplier: 2, cooldown: 5 }),
                wheel: game({ cooldown: 5, segments: DEFAULT_WHEEL.map(s => ({ ...s })) }),
                minesweeper: game({ mines: 4, per_step: 0.2 }),
                highlow: game({ house_edge: 3, max_rounds: 15, cooldown: 3 }),
                blackjack: game({ multiplier: 2 }),
                tower: game({ floors: 8, traps: 1, per_step: 0.43 }),
                horserace: game({ horses: 5, multiplier: 4 }),
                bomb: game({ attempts: 6 })
            }
        },
        level: {
            prefix: ""
        },
        leaderboard: {
            xp_channel: null,
            monthly_channel: null,
            total_channel: null,
            streak_channel: null,
            color: "#d6336c",
            titles: { xp: "", monthly: "", total: "", streak: "" }
        },
        season: {
            enabled: false,
            period: "monthly",
            date: "",
            time: "00:00",
            target: "exp",
            announce_channel: null,
            custom_announce: false,
            announce_title: "",
            announce_body: "",
            log_channel: null
        },
        birthday: {
            enabled: false,
            announce_channel: null,
            announce_time: "09:00",
            mention_user: true,
            ping_role: null,
            birthday_role: null,
            age_line: "They're turning **{age}** today! 🎉",
            panel_channel: null,
            panel_sticky: true,
            set_label: "🎂 Set my birthday",
            remove_label: "Remove mine",
            list_label: "📅 Upcoming",
            templates: {
                panel: {
                    title: "🎂 Birthdays",
                    body: "Tell me when your birthday is and I'll throw you a party in here on the day.\nPress the button below — the year is optional, and only the day and month are ever shown.",
                    color: "#f06595",
                    thumbnail: true,
                    image: "",
                    footer: "{count} birthdays saved · your date can be changed or removed any time"
                },
                announce: {
                    title: "🎉 Happy Birthday!",
                    body: "It's {mention}'s birthday today!\nEveryone wish **{name}** a wonderful day. 🥳🎂",
                    color: "#f06595",
                    thumbnail: true,
                    image: "",
                    footer: "{date}"
                }
            }
        },
        welcome: {
            enabled: false,
            channel: null,
            mention_user: true,
            ping_role: null,
            color: "#f06595",
            footer: "You're our {ordinal} member · joined {date}",
            blocks: [
                {
                    id: "intro",
                    type: "text",
                    text: "### Welcome to {server}!\nHey {mention}, glad you found us! 🎉\nHave a look around, say hello, and make yourself at home.",
                    accessory: "none",
                    buttons: [],
                    divider: true
                },
                { id: "card", type: "image", text: "", accessory: "none", buttons: [], divider: true }
            ],
            card: {
                enabled: true,
                background: "",
                background_color: "#1e1f22",
                overlay: 40,
                accent: "#f06595",
                text_color: "#ffffff",
                sub_color: "#d9dbe0",
                title: "WELCOME",
                subtitle: "{name}",
                footer: "{ordinal} member of {server}",
                avatar_shape: "circle",
                avatar_ring: true,
                layout: "center"
            }
        }
    };
}


// ---- sanitising -----------------------------------------------------------
// Everything the dashboard sends goes through these, so a hand-crafted request
// can never store a value the bot would choke on later.
// The checkers themselves live in ./sanitize.ts, shared with the custom
// message builder.

function template(v: unknown, d: MessageTemplate): MessageTemplate {
    const o = obj(v);
    const image = str(o.image, d.image, 500).trim();
    return {
        title: str(o.title, d.title, 200),
        body: str(o.body, d.body, 1500),
        color: color(o.color, d.color),
        thumbnail: bool(o.thumbnail, d.thumbnail),
        image: image === "" || /^https:\/\/\S+$/.test(image) ? image : d.image,
        footer: str(o.footer, d.footer, 200)
    };
}

// Exported because the dashboard renders a preview of an unsaved card, and
// a draft deserves exactly as much suspicion as anything else sent in.
export function welcomeCard(v: unknown, d: WelcomeCard): WelcomeCard {
    const o = obj(v);
    const background = str(o.background, d.background, 500).trim();
    return {
        enabled: bool(o.enabled, d.enabled),
        background: background === "" || /^https:\/\/\S+$/.test(background) ? background : d.background,
        background_color: color(o.background_color, d.background_color),
        overlay: num(o.overlay, d.overlay, 0, 100),
        accent: color(o.accent, d.accent),
        text_color: color(o.text_color, d.text_color),
        sub_color: color(o.sub_color, d.sub_color),
        title: str(o.title, d.title, 80),
        subtitle: str(o.subtitle, d.subtitle, 80),
        footer: str(o.footer, d.footer, 80),
        avatar_shape: oneOf(o.avatar_shape, ["circle", "rounded", "square"] as const, d.avatar_shape),
        avatar_ring: bool(o.avatar_ring, d.avatar_ring),
        layout: oneOf(o.layout, ["center", "left"] as const, d.layout)
    };
}

const WELCOME_BLOCK_MAX = 12;
const ROW_BUTTON_MAX = 5;

function welcomeButton(v: unknown, i: number): WelcomeButton {
    const o = obj(v);
    const url = str(o.url, "", 500).trim();
    return {
        id: str(o.id, "", 40).trim() || `b${i}`,
        // Half-filled buttons are kept rather than dropped: the dashboard
        // autosaves while somebody is still typing, and one vanishing under
        // the cursor is worse than an unfinished one sitting in the settings.
        // The message builder leaves out anything still incomplete.
        label: str(o.label, "", 80).trim(),
        emoji: str(o.emoji, "", 64).trim(),
        kind: oneOf(o.kind, ["channel", "url"] as const, "channel"),
        channel_id: id(o.channel_id, null),
        url: /^https?:\/\/\S+$/.test(url) ? url : ""
    };
}

function welcomeBlocks(v: unknown, fallback: WelcomeBlock[]): WelcomeBlock[] {
    if (!Array.isArray(v)) return fallback;

    let images = 0;
    const out: WelcomeBlock[] = [];

    for (const [i, raw] of v.slice(0, WELCOME_BLOCK_MAX).entries()) {
        const o = obj(raw);
        const type = oneOf(o.type, ["text", "buttons", "image", "separator"] as const, "text");

        // There is only one drawn card, so a second image block would render
        // the same picture twice.
        if (type === "image" && images++ > 0) continue;

        const buttons = Array.isArray(o.buttons) ? o.buttons.map(welcomeButton) : [];
        out.push({
            id: str(o.id, "", 40).trim() || `k${i}`,
            type,
            text: str(o.text, "", 2000),
            accessory: oneOf(o.accessory, ["none", "avatar", "button"] as const, "none"),
            // A text block's accessory is a single button; a row takes five.
            buttons: buttons.slice(0, type === "text" ? 1 : ROW_BUTTON_MAX),
            divider: bool(o.divider, true)
        });
    }

    return out;
}

// Settings saved before the message became a list of blocks: one body string
// with {buttons1}..{buttons5} markers in it and a flat list of buttons that
// named a marker. Converted rather than dropped so nobody loses the message
// they had already written.
const LEGACY_MARKER = /\{buttons([1-5])\}/;

function blocksFromTemplate(v: Record<string, unknown>): WelcomeBlock[] | null {
    const tpl = obj(v.template);
    if (v.blocks !== undefined || v.template === undefined) return null;

    const legacy = (Array.isArray(v.buttons) ? v.buttons : []).map((b, i) => ({
        ...welcomeButton(b, i),
        slot: num(obj(b).slot, 0, 0, 5)
    }));

    const title = str(tpl.title, "", 200).trim();
    const body = str(tpl.body, "", 1500);
    const blocks: WelcomeBlock[] = [];
    let n = 0;

    const addText = (text: string, first: boolean) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        blocks.push({
            id: `m${n++}`,
            type: "text",
            text: trimmed,
            accessory: first && bool(tpl.thumbnail, false) ? "avatar" : "none",
            buttons: [],
            divider: true
        });
    };
    const addRow = (slot: number) => {
        const row = legacy.filter(b => b.slot === slot).map(({ slot: _slot, ...b }) => b);
        for (let i = 0; i < row.length; i += ROW_BUTTON_MAX) {
            blocks.push({ id: `m${n++}`, type: "buttons", text: "", accessory: "none", buttons: row.slice(i, i + ROW_BUTTON_MAX), divider: true });
        }
    };

    let rest = [title ? `### ${title}` : "", body].filter(Boolean).join("\n");
    let found = LEGACY_MARKER.exec(rest);
    let first = true;

    while (found) {
        addText(rest.slice(0, found.index), first);
        first = false;
        addRow(Number(found[1]));
        rest = rest.slice(found.index + found[0].length);
        found = LEGACY_MARKER.exec(rest);
    }
    addText(rest, first);

    blocks.push({ id: `m${n++}`, type: "image", text: "", accessory: "none", buttons: [], divider: true });
    // Whatever was left under "under the card" now simply goes last.
    addRow(0);

    return blocks.slice(0, WELCOME_BLOCK_MAX);
}

function sanitizeGame(key: GameKey, v: unknown, d: GameSettings): GameSettings {
    const o = obj(v);
    const out: GameSettings = {
        enabled: bool(o.enabled, d.enabled),
        cooldown: num(o.cooldown, d.cooldown, 0, 86_400),
        min_bet: num(o.min_bet, d.min_bet, 0, 1_000_000_000),
        max_bet: num(o.max_bet, d.max_bet, 0, 1_000_000_000),
        fee: num(o.fee, d.fee, 0, 50, false),
        multiplier: num(o.multiplier, d.multiplier, 1, 100, false),
        mines: num(o.mines, d.mines, 1, 19),
        per_step: num(o.per_step, d.per_step, 0.01, 10, false),
        house_edge: num(o.house_edge, d.house_edge, 0, 30, false),
        max_rounds: num(o.max_rounds, d.max_rounds, 1, 50),
        floors: num(o.floors, d.floors, 1, 12),
        traps: num(o.traps, d.traps, 1, 2),
        horses: num(o.horses, d.horses, 2, 8),
        attempts: num(o.attempts, d.attempts, 1, 15),
        first_try: num(o.first_try, d.first_try, 0.01, 100, false),
        try_drop: num(o.try_drop, d.try_drop, 0, 100, false),
        segments: d.segments
    };

    if (key === "wheel" && Array.isArray(o.segments)) {
        const segments = o.segments.slice(0, 12).map(s => {
            const seg = obj(s);
            return {
                emoji: str(seg.emoji, "❔", 32).trim() || "❔",
                multiplier: num(seg.multiplier, 0, 0, 100, false),
                weight: num(seg.weight, 1, 0, 10_000)
            };
        });
        if (segments.length >= 2 && segments.some(s => s.weight > 0)) out.segments = segments;
    }

    return out;
}

function sanitizeSection(section: SettingsSection, v: unknown, cur: GuildSettings): unknown {
    switch (section) {
        case "server": {
            const o = obj(v);
            const d = cur.server;
            const f = obj(o.formula);
            const tz = str(o.timezone, d.timezone, 64);
            return {
                xp_name: str(o.xp_name, d.xp_name, 20).trim() || "EXP",
                chat_xp: num(o.chat_xp, d.chat_xp, 0, 100_000),
                voice_xp: num(o.voice_xp, d.voice_xp, 0, 100_000),
                daily_xp: num(o.daily_xp, d.daily_xp, 0, 1_000_000),
                chat_cooldown: num(o.chat_cooldown, d.chat_cooldown, 0, 3600),
                formula: {
                    multiplier: num(f.multiplier, d.formula.multiplier, 0.01, 1000, false),
                    offset: num(f.offset, d.formula.offset, -1_000_000, 1_000_000, false),
                    divider: num(f.divider, d.formula.divider, 0.01, 1000, false)
                },
                voice_mute_mode: oneOf(o.voice_mute_mode, ["disabled", "block", "reduce"] as const, d.voice_mute_mode),
                voice_mute_reduction: num(o.voice_mute_reduction, d.voice_mute_reduction, 0, 100),
                voice_require_company: bool(o.voice_require_company, d.voice_require_company),
                gift_enabled: bool(o.gift_enabled, d.gift_enabled),
                loan_enabled: bool(o.loan_enabled, d.loan_enabled),
                reset_left_users: bool(o.reset_left_users, d.reset_left_users),
                private_daily: bool(o.private_daily, d.private_daily),
                bonus_enabled: bool(o.bonus_enabled, d.bonus_enabled),
                bonus_xp: num(o.bonus_xp, d.bonus_xp, 0, 1_000_000),
                timezone: isValidTimeZone(tz) ? tz : d.timezone
            } satisfies GuildSettings["server"];
        }
        case "roles": {
            const o = obj(v);
            const d = cur.roles;
            const level_roles = Array.isArray(o.level_roles)
                ? o.level_roles.map(obj)
                    .map(r => ({ level: num(r.level, 1, 1, 10_000), role_id: id(r.role_id, null) }))
                    .filter((r): r is LevelRole => r.role_id !== null)
                    .slice(0, 100)
                : d.level_roles;
            const attendance_roles = Array.isArray(o.attendance_roles)
                ? o.attendance_roles.map(obj)
                    .map(r => ({
                        type: oneOf(r.type, ["total", "streak"] as const, "total"),
                        threshold: num(r.threshold, 1, 1, 100_000),
                        role_id: id(r.role_id, null)
                    }))
                    .filter((r): r is AttendanceRole => r.role_id !== null)
                    .slice(0, 100)
                : d.attendance_roles;
            return {
                admin_roles: ids(o.admin_roles, d.admin_roles, 25),
                role_channel: id(o.role_channel, d.role_channel),
                level_roles: level_roles.sort((a, b) => a.level - b.level),
                level_highest_only: bool(o.level_highest_only, d.level_highest_only),
                attendance_roles: attendance_roles.sort((a, b) => a.threshold - b.threshold),
                attendance_highest_only: bool(o.attendance_highest_only, d.attendance_highest_only)
            } satisfies GuildSettings["roles"];
        }
        case "boosts": {
            if (!Array.isArray(v)) return cur.boosts;
            return v.map(obj).slice(0, 100).map((b, i) => {
                const type = oneOf(b.type, ["all", "role", "channel", "category", "daily"] as const, "all");
                const expires = b.expires_at === null || b.expires_at === undefined ? null : num(b.expires_at, 0, 0, 8_640_000_000_000);
                return {
                    id: typeof b.id === "string" && /^[\w-]{1,24}$/.test(b.id) ? b.id : `${Date.now().toString(36)}${i}`,
                    type,
                    // Daily boosts may target a role; without one they apply to everyone.
                    target_id: type === "all" ? null : id(b.target_id, null),
                    // Negative amounts are allowed: a penalty, never below 0 XP in total.
                    amount: num(b.amount, 0, -100_000, 100_000),
                    expires_at: expires || null
                };
            }).filter(b => b.amount !== 0 && (b.type === "all" || b.type === "daily" || b.target_id !== null)) satisfies Boost[];
        }
        case "ignores": {
            if (!Array.isArray(v)) return cur.ignores;
            const seen = new Set<string>();
            return v.map(obj)
                .map(i => ({ type: oneOf(i.type, ["channel", "category", "role"] as const, "channel"), id: id(i.id, null) }))
                .filter((i): i is Ignore => {
                    if (!i.id || seen.has(i.id)) return false;
                    seen.add(i.id);
                    return true;
                })
                .slice(0, 200);
        }
        case "notifications": {
            const o = obj(v);
            const d = cur.notifications;
            const t = obj(o.templates);
            return {
                levelup_enabled: bool(o.levelup_enabled, d.levelup_enabled),
                levelup_channel: id(o.levelup_channel, d.levelup_channel),
                shop_log_channel: id(o.shop_log_channel, d.shop_log_channel),
                shop_admin_channel: id(o.shop_admin_channel, d.shop_admin_channel),
                templates: {
                    levelup: template(t.levelup, d.templates.levelup),
                    role: template(t.role, d.templates.role),
                    total: template(t.total, d.templates.total),
                    streak: template(t.streak, d.templates.streak)
                }
            } satisfies GuildSettings["notifications"];
        }
        case "gamble": {
            const o = obj(v);
            const d = cur.gamble;
            const g = obj(o.games);
            const games = {} as Record<GameKey, GameSettings>;
            for (const key of GAME_KEYS) games[key] = sanitizeGame(key, g[key], d.games[key]);
            return {
                enabled: bool(o.enabled, d.enabled),
                channels: ids(o.channels, d.channels, 50),
                games
            } satisfies GuildSettings["gamble"];
        }
        case "level": {
            const o = obj(v);
            return {
                prefix: str(o.prefix, cur.level.prefix, 20)
            } satisfies GuildSettings["level"];
        }
        case "leaderboard": {
            const o = obj(v);
            const d = cur.leaderboard;
            const t = obj(o.titles);
            return {
                xp_channel: id(o.xp_channel, d.xp_channel),
                monthly_channel: id(o.monthly_channel, d.monthly_channel),
                total_channel: id(o.total_channel, d.total_channel),
                streak_channel: id(o.streak_channel, d.streak_channel),
                color: color(o.color, d.color),
                titles: {
                    xp: str(t.xp, d.titles.xp, 100),
                    monthly: str(t.monthly, d.titles.monthly, 100),
                    total: str(t.total, d.titles.total, 100),
                    streak: str(t.streak, d.titles.streak, 100)
                }
            } satisfies GuildSettings["leaderboard"];
        }
        case "season": {
            const o = obj(v);
            const d = cur.season;
            const date = str(o.date, d.date, 10);
            const time = str(o.time, d.time, 5);
            return {
                enabled: bool(o.enabled, d.enabled),
                period: oneOf(o.period, ["monthly", "quarterly", "half", "yearly", "date"] as const, d.period),
                date: /^\d{4}-\d{2}-\d{2}$/.test(date) || date === "" ? date : d.date,
                time: /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : d.time,
                target: oneOf(o.target, ["exp", "attendance", "both"] as const, d.target),
                announce_channel: id(o.announce_channel, d.announce_channel),
                custom_announce: bool(o.custom_announce, d.custom_announce),
                announce_title: str(o.announce_title, d.announce_title, 200),
                announce_body: str(o.announce_body, d.announce_body, 1500),
                log_channel: id(o.log_channel, d.log_channel)
            } satisfies GuildSettings["season"];
        }
        case "birthday": {
            const o = obj(v);
            const d = cur.birthday;
            const t = obj(o.templates);
            const time = str(o.announce_time, d.announce_time, 5);
            return {
                enabled: bool(o.enabled, d.enabled),
                announce_channel: id(o.announce_channel, d.announce_channel),
                announce_time: /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : d.announce_time,
                mention_user: bool(o.mention_user, d.mention_user),
                ping_role: id(o.ping_role, d.ping_role),
                birthday_role: id(o.birthday_role, d.birthday_role),
                age_line: str(o.age_line, d.age_line, 500),
                panel_channel: id(o.panel_channel, d.panel_channel),
                panel_sticky: bool(o.panel_sticky, d.panel_sticky),
                // Discord refuses a button with an empty label, so each one
                // falls back to its default rather than to "".
                set_label: str(o.set_label, d.set_label, 80).trim() || "🎂 Set my birthday",
                remove_label: str(o.remove_label, d.remove_label, 80).trim() || "Remove mine",
                list_label: str(o.list_label, d.list_label, 80).trim() || "📅 Upcoming",
                templates: {
                    panel: template(t.panel, d.templates.panel),
                    announce: template(t.announce, d.templates.announce)
                }
            } satisfies GuildSettings["birthday"];
        }
        case "welcome": {
            const o = obj(v);
            const d = cur.welcome;
            return {
                enabled: bool(o.enabled, d.enabled),
                channel: id(o.channel, d.channel),
                mention_user: bool(o.mention_user, d.mention_user),
                ping_role: id(o.ping_role, d.ping_role),
                color: color(o.color, d.color),
                footer: str(o.footer, d.footer, 200),
                blocks: welcomeBlocks(o.blocks ?? blocksFromTemplate(o), d.blocks),
                card: welcomeCard(o.card, d.card)
            } satisfies GuildSettings["welcome"];
        }
    }
}

// Runs a stored blob through the sanitisers against fresh defaults, which also
// fills in any field added after that server last saved.
function normalize(raw: unknown): GuildSettings {
    const base = defaultSettings();
    const o = obj(raw);
    for (const section of SECTIONS) {
        if (o[section] !== undefined) {
            (base as unknown as Record<string, unknown>)[section] = sanitizeSection(section, o[section], base);
        }
    }
    return base;
}


// ---- cache ------------------------------------------------------------------

const cache = new Map<string, GuildSettings>();

export function getSettings(guild_id: string): GuildSettings {
    let settings = cache.get(guild_id);
    if (settings) return settings;

    const row = db.get<{ data: string }>(`SELECT data FROM guild_settings WHERE guild_id = ?`, guild_id);
    let parsed: unknown = undefined;
    if (row) {
        try {
            parsed = JSON.parse(row.data);
        } catch (err) {
            console.error(`Settings for guild ${guild_id} are unreadable, falling back to defaults:`, err);
        }
    }

    settings = normalize(parsed);
    cache.set(guild_id, settings);
    return settings;
}

function persist(guild_id: string, settings: GuildSettings): void {
    db.run(
        `INSERT INTO guild_settings (guild_id, data, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
        guild_id,
        JSON.stringify(settings),
        Date.now()
    );
    cache.set(guild_id, settings);
}

export function updateSection<S extends SettingsSection>(guild_id: string, section: S, data: unknown): GuildSettings {
    const current = getSettings(guild_id);
    const next: GuildSettings = { ...current, [section]: sanitizeSection(section, data, current) };
    persist(guild_id, next);
    return next;
}

export function resetSettings(guild_id: string): GuildSettings {
    const fresh = defaultSettings();
    persist(guild_id, fresh);
    return fresh;
}

// Boosts with an expiry in the past simply stop applying; this drops them from
// the stored list now and then so the dashboard doesn't show stale rows forever.
export function pruneExpiredBoosts(guild_id: string): void {
    const settings = getSettings(guild_id);
    const now = Date.now();
    const live = settings.boosts.filter(b => !b.expires_at || b.expires_at > now);
    if (live.length !== settings.boosts.length) {
        persist(guild_id, { ...settings, boosts: live });
    }
}

// Internal key/value store for things the dashboard never edits directly.
export function getState(guild_id: string, key: string): string | null {
    return db.get<{ value: string }>(`SELECT value FROM guild_state WHERE guild_id = ? AND key = ?`, guild_id, key)?.value ?? null;
}

export function setState(guild_id: string, key: string, value: string | null): void {
    if (value === null) {
        db.run(`DELETE FROM guild_state WHERE guild_id = ? AND key = ?`, guild_id, key);
        return;
    }
    db.run(
        `INSERT INTO guild_state (guild_id, key, value) VALUES (?, ?, ?)
         ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value`,
        guild_id, key, value
    );
}
