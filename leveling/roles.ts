import { GuildMember, PermissionFlagsBits, Role } from "discord.js";
import { logActivity } from "./activity.js";
import { buildTemplate, memberVars, resolveChannel, sendContainer } from "./notify.js";
import { getSettings } from "./settings.js";


// Discord only lets a bot hand out roles below its own highest role, and never
// integration-managed ones. Anything else is skipped rather than erroring.
export function manageable(member: GuildMember, role_id: string): Role | null {
    const guild = member.guild;
    const role = guild.roles.cache.get(role_id);
    const me = guild.members.me;
    if (!role || role.managed || role.id === guild.id || !me) return null;
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) return null;
    if (role.position >= me.roles.highest.position) return null;
    return role;
}

async function applyRoleDiff(member: GuildMember, desired: Set<string>, managed_ids: Set<string>, reason: string): Promise<{ added: Role[]; removed: Role[] }> {
    const added: Role[] = [];
    const removed: Role[] = [];

    for (const id of managed_ids) {
        const has = member.roles.cache.has(id);
        const want = desired.has(id);
        if (has === want) continue;
        const role = manageable(member, id);
        if (!role) continue;
        (want ? added : removed).push(role);
    }

    try {
        if (added.length) await member.roles.add(added, reason);
        if (removed.length) await member.roles.remove(removed, reason);
    } catch (err) {
        console.error(`Failed to update ${reason.toLowerCase()} for ${member.id} in ${member.guild.id}:`, err);
        return { added: [], removed: [] };
    }

    for (const role of added) {
        logActivity({ guild_id: member.guild.id, type: "roles", user_id: member.id, user_name: member.displayName, text: `Received role @${role.name}` });
    }
    for (const role of removed) {
        logActivity({ guild_id: member.guild.id, type: "roles", user_id: member.id, user_name: member.displayName, text: `Lost role @${role.name}` });
    }

    return { added, removed };
}

export async function syncLevelRoles(member: GuildMember, level: number, announce: boolean): Promise<void> {
    const settings = getSettings(member.guild.id);
    const level_roles = settings.roles.level_roles;
    if (!level_roles.length) return;

    const reached = level_roles.filter(r => r.level <= level);
    let desired: typeof reached;
    if (settings.roles.level_highest_only && reached.length) {
        const top = Math.max(...reached.map(r => r.level));
        desired = reached.filter(r => r.level === top);
    } else {
        desired = reached;
    }

    const { added } = await applyRoleDiff(
        member,
        new Set(desired.map(r => r.role_id)),
        new Set(level_roles.map(r => r.role_id)),
        "Level role"
    );

    if (!announce || !added.length) return;
    const channel = await resolveChannel(member.client, settings.roles.role_channel);
    if (!channel) return;

    for (const role of added) {
        const vars = {
            ...memberVars(member, settings.server.xp_name),
            level,
            role: role.name,
            roleMention: `<@&${role.id}>`,
            role_name: role.name
        };
        await sendContainer(channel, buildTemplate(settings.notifications.templates.role, vars, member.displayAvatarURL({ extension: "png", size: 256 })), [member.id]);
    }
}

// Run on every check-in, which is also when roles fall away again if a streak
// broke or a season reset dropped the count below the threshold.
export async function syncAttendanceRoles(member: GuildMember, total: number, streak: number, announce: boolean): Promise<void> {
    const settings = getSettings(member.guild.id);
    const roles = settings.roles.attendance_roles;
    if (!roles.length) return;

    const desired = new Set<string>();
    for (const type of ["total", "streak"] as const) {
        const value = type === "total" ? total : streak;
        const reached = roles.filter(r => r.type === type && r.threshold <= value);
        if (!reached.length) continue;
        if (settings.roles.attendance_highest_only) {
            const top = Math.max(...reached.map(r => r.threshold));
            reached.filter(r => r.threshold === top).forEach(r => desired.add(r.role_id));
        } else {
            reached.forEach(r => desired.add(r.role_id));
        }
    }

    const { added } = await applyRoleDiff(member, desired, new Set(roles.map(r => r.role_id)), "Attendance role");

    if (!announce || !added.length) return;
    const channel = await resolveChannel(member.client, settings.roles.role_channel);
    if (!channel) return;

    for (const role of added) {
        const rule = roles.find(r => r.role_id === role.id);
        const type = rule?.type ?? "total";
        const vars = {
            ...memberVars(member, settings.server.xp_name),
            count: type === "total" ? total : streak,
            role: role.name,
            roleMention: `<@&${role.id}>`,
            role_name: role.name
        };
        await sendContainer(channel, buildTemplate(settings.notifications.templates[type], vars, member.displayAvatarURL({ extension: "png", size: 256 })), [member.id]);
    }
}
