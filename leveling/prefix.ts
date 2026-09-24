import { GuildMember, PermissionFlagsBits } from "discord.js";
import { getSettings, getState, setState } from "./settings.js";

// Level prefix in front of server nicknames, e.g. "[LV.{level}]" → "[LV.5] Nickname".
// Nicknames follow the level whenever it changes; /levelsync applies it to
// everyone at once.

const NICK_MAX = 32;

function escape(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pattern(format: string): RegExp | null {
    if (!format.trim()) return null;
    const body = escape(format.trim()).replace(escape("{level}"), "\\d+");
    return new RegExp(`^${body}\\s*`);
}

// Every format this server has used recently, so switching the format (or
// turning it off) can still peel the old prefix off people's names.
function knownFormats(guild_id: string): string[] {
    const current = getSettings(guild_id).level.prefix;
    let old: string[] = [];
    try {
        old = JSON.parse(getState(guild_id, "prefix_formats") ?? "[]");
    } catch {
        old = [];
    }
    return [current, ...old].filter((f, i, a) => f.trim() && a.indexOf(f) === i);
}

// Called when the dashboard saves a new format.
export function rememberPrefix(guild_id: string, previous: string): void {
    if (!previous.trim()) return;
    const list = knownFormats(guild_id).filter(f => f !== getSettings(guild_id).level.prefix);
    setState(guild_id, "prefix_formats", JSON.stringify([previous, ...list.filter(f => f !== previous)].slice(0, 5)));
}

export function stripPrefix(guild_id: string, name: string): string {
    for (const format of knownFormats(guild_id)) {
        const re = pattern(format);
        if (re && re.test(name)) return name.replace(re, "").trim() || name;
    }
    return name;
}

export type PrefixResult = "updated" | "unchanged" | "skipped";

export async function syncNickname(member: GuildMember, level: number): Promise<PrefixResult> {
    const guild = member.guild;
    const format = getSettings(guild.id).level.prefix.trim();
    const me = guild.members.me;

    // Discord never lets a bot rename the owner or anyone ranked above it.
    if (member.id === guild.ownerId || !member.manageable) return "skipped";
    if (!me?.permissions.has(PermissionFlagsBits.ManageNicknames)) return "skipped";

    const plain = member.user.globalName ?? member.user.username;
    const base = stripPrefix(guild.id, member.displayName);
    let target: string | null;

    if (format) {
        target = `${format.replace("{level}", String(level))} ${base}`;
        if (target.length > NICK_MAX) return "skipped";
    } else {
        // Prefix switched off: drop it, and clear the nickname entirely if
        // all that is left is their normal name.
        if (!member.nickname || base === member.nickname) return "unchanged";
        target = base === plain ? null : base;
    }

    if ((target ?? plain) === member.displayName && (target !== null || member.nickname === null)) return "unchanged";

    try {
        await member.setNickname(target, "Level prefix");
        return "updated";
    } catch (err) {
        console.error(`Could not set level prefix for ${member.id}:`, (err as Error).message ?? err);
        return "skipped";
    }
}
