import { Events, GuildMember, PartialGuildMember } from "discord.js";
import { logActivity } from "../../leveling/activity.js";
import { deleteMember, getMember } from "../../leveling/members.js";
import { getSettings } from "../../leveling/settings.js";
import { recordLeave } from "../../leveling/stats.js";

// "Reset XP of left users" on the Server page. Needs the Server Members intent,
// without which Discord never tells the bot that anyone left.
export default {
    name: Events.GuildMemberRemove,
    once: false,
    async execute(member: GuildMember | PartialGuildMember) {
        if (member.user?.bot) return;
        recordLeave(member.guild.id);
        if (!getSettings(member.guild.id).server.reset_left_users) return;

        const row = getMember(member.guild.id, member.id);
        if (row.updated_at === 0) return;

        deleteMember(member.guild.id, member.id);
        logActivity({
            guild_id: member.guild.id,
            type: "reset",
            user_id: member.id,
            user_name: row.name ?? member.user?.username ?? member.id,
            text: `Left the server, ${row.xp.toLocaleString("en-US")} XP cleared`,
            amount: -row.xp
        });
    }
};
