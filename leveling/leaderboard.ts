import { Client, ContainerBuilder, Guild, MessageFlags } from "discord.js";
import { createLevelingTable } from "../schema/levelingDB.js";
import { MemberRow } from "./members.js";
import { resolveChannel } from "./notify.js";
import { stripPrefix } from "./prefix.js";
import { getSettings, getState, setState } from "./settings.js";
import { monthKey } from "./time.js";
import { streakFloor } from "./uptime.js";
import { dashboardUrl, fmt, hexToInt, linkRow, sep, text } from "./ui.js";


const db = createLevelingTable();

export type BoardType = "xp" | "monthly" | "total" | "streak";
export const BOARD_TYPES: BoardType[] = ["xp", "monthly", "total", "streak"];

export interface BoardEntry {
    rank: number;
    user_id: string;
    name: string;
    avatar: string | null;
    level: number;
    xp: number;
    value: number;
}

export interface BoardPage {
    entries: BoardEntry[];
    total: number;
    page: number;
    pages: number;
}

function query(guild_id: string, type: BoardType): { where: string; order: string; value: string; params: unknown[] } {
    const tz = getSettings(guild_id).server.timezone;
    switch (type) {
        case "xp":
            return { where: `guild_id = ? AND xp > 0`, order: `xp DESC`, value: `xp`, params: [guild_id] };
        case "monthly":
            return { where: `guild_id = ? AND month_key = ? AND month_xp > 0`, order: `month_xp DESC`, value: `month_xp`, params: [guild_id, monthKey(tz)] };
        case "total":
            return { where: `guild_id = ? AND att_total > 0`, order: `att_total DESC`, value: `att_total`, params: [guild_id] };
        case "streak":
            // Anyone who missed yesterday has no live streak any more
            // (unless the bot itself was offline that day).
            return { where: `guild_id = ? AND att_streak > 0 AND att_last >= ?`, order: `att_streak DESC`, value: `att_streak`, params: [guild_id, streakFloor(tz)] };
    }
}

// Names always come from the live server nickname when the member is still
// around; the stored name is only a fallback for people who left.
export function displayOf(guild: Guild | null | undefined, row: Pick<MemberRow, "user_id" | "name" | "avatar">): { name: string; avatar: string | null } {
    const member = guild?.members.cache.get(row.user_id);
    if (member) {
        return { name: stripPrefix(member.guild.id, member.displayName), avatar: member.displayAvatarURL({ extension: "png", size: 128 }) };
    }
    return { name: row.name ?? "Unknown member", avatar: row.avatar };
}

export function boardPage(guild: Guild | null | undefined, guild_id: string, type: BoardType, page: number, per_page = 10): BoardPage {
    const q = query(guild_id, type);
    const total = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM members WHERE ${q.where}`, ...q.params)?.n ?? 0;
    const pages = Math.max(1, Math.ceil(total / per_page));
    const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);

    const rows = db.all<(MemberRow & { value: number })[]>(
        `SELECT *, ${q.value} AS value FROM members WHERE ${q.where} ORDER BY ${q.order}, user_id LIMIT ? OFFSET ?`,
        ...q.params, per_page, (p - 1) * per_page
    );

    return {
        entries: rows.map((r, i) => ({
            rank: (p - 1) * per_page + i + 1,
            user_id: r.user_id,
            ...displayOf(guild, r),
            level: r.level,
            xp: r.xp,
            value: r.value
        })),
        total,
        page: p,
        pages
    };
}

// Whole ranking, for season archives.
export function fullBoard(guild: Guild | null | undefined, guild_id: string, type: BoardType): BoardEntry[] {
    return boardPage(guild, guild_id, type, 1, 100_000).entries;
}

export function boardTitle(guild: Guild, type: BoardType): string {
    const custom = getSettings(guild.id).leaderboard.titles[type].trim();
    if (custom) return custom;
    switch (type) {
        case "xp": return `${guild.name} leaderboard`;
        case "monthly": return `${guild.name} monthly leaderboard`;
        case "total": return `${guild.name} Attendance Total Leaderboard`;
        case "streak": return `${guild.name} Attendance Streak Leaderboard`;
    }
}

export function boardLine(guild_id: string, type: BoardType, e: BoardEntry): string {
    const xp_name = getSettings(guild_id).server.xp_name;
    const medal = e.rank === 1 ? "🥇" : e.rank === 2 ? "🥈" : e.rank === 3 ? "🥉" : `**${e.rank}.**`;
    switch (type) {
        case "xp":
            return `${medal} <@${e.user_id}> · Level ${e.level} · ${fmt(e.value)} ${xp_name}`;
        case "monthly":
            return `${medal} <@${e.user_id}> · Level ${e.level} · ${fmt(e.value)} ${xp_name}`;
        case "total":
            return `${medal} <@${e.user_id}> · ${fmt(e.value)} times`;
        case "streak":
            return `${medal} <@${e.user_id}> · ${fmt(e.value)} days`;
    }
}

export function webBoardUrl(guild_id: string, type: BoardType = "xp"): string | null {
    const base = dashboardUrl();
    return base ? `${base}/leaderboard/${guild_id}${type === "xp" ? "" : `?tab=${type}`}` : null;
}

export function buildBoardContainer(guild: Guild, type: BoardType, footer: string): ContainerBuilder {
    const settings = getSettings(guild.id);
    const page = boardPage(guild, guild.id, type, 1, 10);

    const container = new ContainerBuilder().setAccentColor(hexToInt(settings.leaderboard.color));
    container.addTextDisplayComponents(text(`## ${boardTitle(guild, type)}`));
    container.addSeparatorComponents(sep());
    container.addTextDisplayComponents(text(
        page.entries.length
            ? page.entries.map(e => boardLine(guild.id, type, e)).join("\n")
            : "*Nobody is on this board yet.*"
    ));
    container.addSeparatorComponents(sep());
    container.addTextDisplayComponents(text(`-# ${footer}`));

    const url = webBoardUrl(guild.id, type);
    if (url) container.addActionRowComponents(linkRow({ label: "View full leaderboard", url, emoji: "🏆" }));

    return container;
}


// ---- hourly channel boards ---------------------------------------------------

const CHANNEL_KEYS: Record<BoardType, "xp_channel" | "monthly_channel" | "total_channel" | "streak_channel"> = {
    xp: "xp_channel",
    monthly: "monthly_channel",
    total: "total_channel",
    streak: "streak_channel"
};

async function updateGuildBoard(client: Client, guild: Guild, type: BoardType): Promise<void> {
    const settings = getSettings(guild.id);
    const channel_id = settings.leaderboard[CHANNEL_KEYS[type]];
    const state_key = `lb_msg_${type}`;
    const stored = getState(guild.id, state_key);
    const [stored_channel, stored_msg] = stored ? stored.split(":") : [null, null];

    // Channel was changed or cleared: take the old board down.
    if (stored_channel && stored_channel !== channel_id) {
        const old = await resolveChannel(client, stored_channel);
        if (old && "messages" in old && stored_msg) {
            await old.messages.delete(stored_msg).catch(() => {});
        }
        setState(guild.id, state_key, null);
    }
    if (!channel_id) return;

    const channel = await resolveChannel(client, channel_id);
    if (!channel || !("messages" in channel)) return;

    const container = buildBoardContainer(guild, type, `Updated <t:${Math.floor(Date.now() / 1000)}:R> · refreshes every hour`);
    const payload = { components: [container], flags: MessageFlags.IsComponentsV2 as const, allowedMentions: { parse: [] } };

    if (stored_channel === channel_id && stored_msg) {
        const edited = await channel.messages.edit(stored_msg, { components: [container], allowedMentions: { parse: [] } }).catch(() => null);
        if (edited) return;
    }

    const sent = await channel.send(payload).catch(err => {
        console.error(`Could not post ${type} leaderboard in ${channel_id}:`, err.message ?? err);
        return null;
    });
    if (sent) setState(guild.id, state_key, `${channel_id}:${sent.id}`);
}

export async function updateChannelBoards(client: Client, only_guild?: string): Promise<void> {
    for (const guild of client.guilds.cache.values()) {
        if (only_guild && guild.id !== only_guild) continue;
        for (const type of BOARD_TYPES) {
            await updateGuildBoard(client, guild, type).catch(err => console.error(`Leaderboard update failed for ${guild.id}/${type}:`, err));
        }
    }
}
