import { Client, Events, GuildMember } from "discord.js";
import { recordJoin } from "../../leveling/stats.js";
import { welcomeMember } from "../../welcome/send.js";

// Counts joins for the Statistics page's "Member Changes", and posts the
// welcome message configured on the dashboard.
export default {
    name: Events.GuildMemberAdd,
    once: false,
    async execute(member: GuildMember, client: Client) {
        if (member.user.bot) return;
        recordJoin(member.guild.id);

        await welcomeMember(client, member).catch(err =>
            console.error(`Welcome failed for ${member.id} in ${member.guild.id}:`, err)
        );
    }
};
