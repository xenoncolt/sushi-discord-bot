import { Channel, GuildMember, SendableChannels } from "discord.js";
import { logActivity } from "./activity.js";
import { applyXp, Profile, XpResult } from "./members.js";
import { buildTemplate, memberVars, resolveChannel, sendContainer } from "./notify.js";
import { stripPrefix, syncNickname } from "./prefix.js";
import { syncLevelRoles } from "./roles.js";
import { GuildSettings, getSettings } from "./settings.js";
import { recordXpEarned } from "./stats.js";
import { fmt } from "./ui.js";


export interface XpContext {
    // Where it happened; level-ups land here when no announcement channel is set.
    channel?: SendableChannels | null;
    // Treat the change as starting from this level (games lock the bet first
    // and settle later, and the level before the bet is what counts).
    from_level?: number;
    // Admin edits: roles still follow the new level, but there is no public
    // level-up card and no extra log line (the edit logs itself).
    quiet?: boolean;
}

export function profileOf(member: GuildMember): Profile {
    return {
        name: stripPrefix(member.guild.id, member.displayName),
        avatar: member.displayAvatarURL({ extension: "png", size: 128 })
    };
}

// The balance changes immediately; level-up messages and role changes run in
// the background so a command can answer inside Discord's 3 second window.
export async function changeXp(member: GuildMember, delta: number, ctx: XpContext = {}): Promise<XpResult> {
    const result = applyXp(member.guild.id, member.id, delta, profileOf(member));
    afterLevelChange(member, ctx.from_level ?? result.old_level, result.level, result.xp, ctx)
        .catch(err => console.error("Level change follow-up failed:", err));
    return result;
}

export async function afterLevelChange(member: GuildMember, from: number, to: number, xp: number, ctx: XpContext = {}): Promise<void> {
    if (from === to) return;
    const settings = getSettings(member.guild.id);

    if (ctx.quiet) {
        await syncLevelRoles(member, to, false).catch(err => console.error("Level role sync failed:", err));
        await syncNickname(member, to).catch(() => {});
        return;
    }

    if (to > from) {
        logActivity({ guild_id: member.guild.id, type: "level", user_id: member.id, user_name: member.displayName, text: `Reached level ${to}` });
        if (settings.notifications.levelup_enabled) {
            await announceLevelUp(member, from, to, xp, ctx.channel ?? null).catch(err => console.error("Level-up announcement failed:", err));
        }
    } else {
        logActivity({ guild_id: member.guild.id, type: "level", user_id: member.id, user_name: member.displayName, text: `Dropped to level ${to}` });
    }

    await syncLevelRoles(member, to, to > from).catch(err => console.error("Level role sync failed:", err));
    await syncNickname(member, to).catch(() => {});
}

async function announceLevelUp(member: GuildMember, from: number, to: number, xp: number, here: SendableChannels | null): Promise<void> {
    const settings = getSettings(member.guild.id);
    const channel = settings.notifications.levelup_channel
        ? await resolveChannel(member.client, settings.notifications.levelup_channel)
        : here;
    if (!channel) return;

    const vars = {
        ...memberVars(member, settings.server.xp_name),
        level: to,
        old_level: from,
        level_diff: to - from,
        xp: fmt(xp)
    };
    const container = buildTemplate(settings.notifications.templates.levelup, vars, member.displayAvatarURL({ extension: "png", size: 256 }));
    await sendContainer(channel, container, [member.id]);
}


// ---- ignores & boosts ---------------------------------------------------------

// The channel itself, its parent (for threads and forum posts) and category.
function channelChain(channel: Channel | null | undefined): string[] {
    if (!channel || channel.isDMBased()) return [];
    const chain = [channel.id];
    const parent = channel.parent;
    if (parent) {
        chain.push(parent.id);
        if (parent.parentId) chain.push(parent.parentId);
    }
    return chain;
}

export function isIgnored(settings: GuildSettings, member: GuildMember, channel: Channel | null | undefined): boolean {
    if (!settings.ignores.length) return false;
    const chain = channelChain(channel);
    return settings.ignores.some(i =>
        i.type === "role" ? member.roles.cache.has(i.id) : chain.includes(i.id)
    );
}

export function boostAmount(settings: GuildSettings, member: GuildMember, channel: Channel | null | undefined, kind: "chat" | "voice" | "daily"): number {
    if (!settings.boosts.length) return 0;
    const now = Date.now();
    const chain = channelChain(channel);
    let total = 0;

    for (const b of settings.boosts) {
        if (b.expires_at && b.expires_at <= now) continue;
        if (kind === "daily") {
            // Check-in boosts go to everyone, or only to holders of their role.
            if (b.type === "daily" && (!b.target_id || member.roles.cache.has(b.target_id))) total += b.amount;
            continue;
        }
        if (b.type === "all") total += b.amount;
        else if (b.type === "role" && b.target_id && member.roles.cache.has(b.target_id)) total += b.amount;
        else if ((b.type === "channel" || b.type === "category") && b.target_id && chain.includes(b.target_id)) total += b.amount;
    }
    return total;
}

// Chat and voice XP: base amount plus any boosts, unless the member or channel
// is on the ignore list. `factor` is the voice mute reduction; decimals are
// truncated, as the Server page says.
export async function grantActivityXp(member: GuildMember, base: number, kind: "chat" | "voice", channel: SendableChannels | null, channel_for_rules: Channel | null, factor = 1): Promise<number> {
    const settings = getSettings(member.guild.id);
    if (base <= 0 || isIgnored(settings, member, channel_for_rules)) return 0;

    const amount = Math.trunc((base + boostAmount(settings, member, channel_for_rules, kind)) * factor);
    if (amount <= 0) return 0;

    await changeXp(member, amount, { channel });
    recordXpEarned(member.guild.id, amount, channel_for_rules?.id);
    return amount;
}
