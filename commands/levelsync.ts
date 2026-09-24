import { MessageFlags } from "discord.js";
import { Command } from "../types/Command.js";
import { logActivity } from "../leveling/activity.js";
import { getMember, liveStreak, recomputeLevels } from "../leveling/members.js";
import { isManager } from "../leveling/perms.js";
import { syncNickname } from "../leveling/prefix.js";
import { syncAttendanceRoles, syncLevelRoles } from "../leveling/roles.js";
import { getSettings } from "../leveling/settings.js";
import { fmt, progressBar } from "../leveling/ui.js";

// Brings every member's level roles, attendance roles and nickname prefix in
// line with the current settings, e.g. after adding level roles or changing
// the prefix format. One member at a time, to stay inside Discord's limits.
export default {
    name: "levelsync",
    description: "Re-sync level roles and nickname prefixes for every member (admins)",
    options: [],
    async execute(interaction) {
        if (!interaction.inCachedGuild()) {
            await interaction.reply({ content: "This only works inside a server.", flags: MessageFlags.Ephemeral });
            return;
        }
        if (!isManager(interaction.member)) {
            await interaction.reply({ content: "Only users with Manage Server or an admin role can do that.", flags: MessageFlags.Ephemeral });
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const guild = interaction.guild;
        const settings = getSettings(guild.id);
        recomputeLevels(guild.id);
        await guild.members.fetch().catch(() => {});

        const members = [...guild.members.cache.values()].filter(m => !m.user.bot);
        let done = 0;
        let renamed = 0;
        let last_edit = Date.now();

        for (const member of members) {
            const row = getMember(guild.id, member.id);
            await syncLevelRoles(member, row.level, false).catch(() => {});
            await syncAttendanceRoles(member, row.att_total, liveStreak(row, settings.server.timezone), false).catch(() => {});
            if (settings.level.prefix.trim() || member.nickname) {
                if (await syncNickname(member, row.level).catch(() => "skipped") === "updated") renamed++;
            }
            done++;

            // Live progress, but no more than one edit every few seconds.
            if (Date.now() - last_edit > 3000) {
                last_edit = Date.now();
                await interaction.editReply({ content: `⏳ Syncing… ${progressBar(done, members.length, 14)} ${done}/${members.length}` }).catch(() => {});
            }
        }

        logActivity({ guild_id: guild.id, type: "roles", text: `Level sync for ${fmt(done)} members`, actor_id: interaction.user.id, actor_name: interaction.member.displayName });
        await interaction.editReply({
            content: [
                `✅ Synced **${fmt(done)}** members.`,
                settings.level.prefix.trim() ? `🏷️ Updated **${fmt(renamed)}** nickname prefix(es).` : "",
                `-# Roles above my own, and members I outrank less than (like the owner), are skipped.`
            ].filter(Boolean).join("\n")
        });
    }
} satisfies Command;
