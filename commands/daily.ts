import { ContainerBuilder, MessageFlags } from "discord.js";
import { Command } from "../types/Command.js";
import { logActivity } from "../leveling/activity.js";
import { checkIn } from "../leveling/members.js";
import { syncAttendanceRoles } from "../leveling/roles.js";
import { getSettings } from "../leveling/settings.js";
import { recordXpEarned } from "../leveling/stats.js";
import { dayStart } from "../leveling/time.js";
import { COLOR, fmt, sep, text } from "../leveling/ui.js";
import { boostAmount, changeXp } from "../leveling/xp.js";

// Daily check-in: XP plus attendance (total days and current streak), which
// feed the attendance leaderboards and attendance roles.
export default {
    name: "daily",
    description: "Check in for the day and collect your daily XP",
    options: [],
    async execute(interaction) {
        if (!interaction.inCachedGuild()) {
            await interaction.reply({ content: "This only works inside a server.", flags: MessageFlags.Ephemeral });
            return;
        }

        const member = interaction.member;
        const settings = getSettings(interaction.guildId);
        const s = settings.server;
        const flags = s.private_daily ? MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral : MessageFlags.IsComponentsV2;

        const outcome = checkIn(interaction.guildId, member.id, { name: member.displayName });
        if (!outcome.claimed) {
            const reset = Math.floor(dayStart(s.timezone, outcome.next_day) / 1000);
            await interaction.reply({
                components: [new ContainerBuilder().setAccentColor(COLOR.push).addTextDisplayComponents(text(
                    `### 📅 Already checked in\nYou've already collected today's reward. Come back <t:${reset}:R>!`
                ))],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
            return;
        }

        const boost = boostAmount(settings, member, interaction.channel, "daily");
        // Boosts can be negative (a penalty); the reward never drops below 0.
        const reward = Math.max(0, s.daily_xp + boost);
        const here = interaction.channel?.isSendable() ? interaction.channel : null;
        const result = reward > 0 ? await changeXp(member, reward, { channel: here }) : null;
        recordXpEarned(interaction.guildId, reward);

        logActivity({
            guild_id: interaction.guildId,
            type: "xp",
            user_id: member.id,
            user_name: member.displayName,
            text: `Daily check-in · +${fmt(reward)}`,
            amount: reward
        });

        await interaction.reply({
            components: [new ContainerBuilder()
                .setAccentColor(COLOR.win)
                .addTextDisplayComponents(text([
                    `### 📅 Daily check-in complete!`,
                    `<@${member.id}> collected **+${fmt(reward)} ${s.xp_name}**${boost ? ` *(includes +${fmt(boost)} boost)*` : ""}`
                ].join("\n")))
                .addSeparatorComponents(sep())
                .addTextDisplayComponents(text([
                    `🔥 Streak: **${outcome.streak}** day${outcome.streak === 1 ? "" : "s"}${!outcome.continued && outcome.total > 1 ? " *(streak restarted)*" : ""}`,
                    `📆 Total check-ins: **${outcome.total}**`,
                    result ? `👛 Balance: **${fmt(result.xp)} ${s.xp_name}**` : ""
                ].filter(Boolean).join("\n")))],
            flags,
            allowedMentions: { parse: [] }
        });

        await syncAttendanceRoles(member, outcome.total, outcome.streak, true).catch(err => console.error("Attendance role sync failed:", err));
    }
} satisfies Command;
