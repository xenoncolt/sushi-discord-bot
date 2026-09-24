import { GuildMember, PermissionFlagsBits } from "discord.js";
import { getSettings } from "./settings.js";


// Full control: role settings, data resets and the shop stay with these.
export function isServerAdmin(member: GuildMember | null | undefined): boolean {
    if (!member) return false;
    return member.guild.ownerId === member.id
        || member.permissions.has(PermissionFlagsBits.Administrator)
        || member.permissions.has(PermissionFlagsBits.ManageGuild);
}

// Server admins, plus anyone holding one of the dashboard's Admin Roles. They
// get the dashboard and the XP management tools.
export function isManager(member: GuildMember | null | undefined): boolean {
    if (!member) return false;
    if (isServerAdmin(member)) return true;
    const admin_roles = getSettings(member.guild.id).roles.admin_roles;
    return admin_roles.some(id => member.roles.cache.has(id));
}
