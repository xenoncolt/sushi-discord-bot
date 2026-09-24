import { ApplicationCommandOptionType, ButtonInteraction, ButtonStyle, ContainerBuilder, Guild, MessageFlags } from "discord.js";
import { Command } from "../types/Command.js";
import { button, row } from "../games/common.js";
import { BOARD_TYPES, BoardType, boardPage, buildBoardContainer } from "../leveling/leaderboard.js";
import { getMember, liveMonthXp, liveStreak, monthRank, xpRank } from "../leveling/members.js";
import { getSettings } from "../leveling/settings.js";
import { fmt } from "../leveling/ui.js";

// Top 10 in Discord, with buttons to flip between the four boards; everything
// past 10 lives on the web leaderboard linked under the list.

const LABELS: Record<BoardType, string> = { xp: "Total XP", monthly: "Monthly", total: "Check-ins", streak: "Streak" };

function build(guild: Guild, type: BoardType, user_id: string): ContainerBuilder {
    const settings = getSettings(guild.id);
    const me = getMember(guild.id, user_id);
    const tz = settings.server.timezone;
    const mine = {
        xp: `You: #${xpRank(guild.id, user_id)} · Level ${me.level} · ${fmt(me.xp)} ${settings.server.xp_name}`,
        monthly: `You: #${monthRank(guild.id, user_id)} · ${fmt(liveMonthXp(me, tz))} ${settings.server.xp_name} this month`,
        streak: `Your streak: ${liveStreak(me, tz)} days`,
        total: `Your check-ins: ${me.att_total}`
    }[type];

    const total = boardPage(guild, guild.id, type, 1).total;
    const container = buildBoardContainer(guild, type, `${mine} · ${fmt(total)} ranked`);
    container.addActionRowComponents(row(...BOARD_TYPES.map(t =>
        button(`leaderboard:type:${t}`, LABELS[t], t === type ? ButtonStyle.Primary : ButtonStyle.Secondary, undefined, t === type)
    )));
    return container;
}

export default {
    name: "leaderboard",
    description: "Show the server's top 10",
    options: [
        {
            name: "type",
            description: "Which ranking",
            type: ApplicationCommandOptionType.String,
            required: false,
            choices: [
                { name: "Total XP", value: "xp" },
                { name: "Monthly XP", value: "monthly" },
                { name: "Total check-ins", value: "total" },
                { name: "Check-in streak", value: "streak" }
            ]
        }
    ],
    cooldown: 3,
    async execute(interaction) {
        if (!interaction.inCachedGuild()) {
            await interaction.reply({ content: "This only works inside a server.", flags: MessageFlags.Ephemeral });
            return;
        }
        const type = (interaction.options.getString("type") ?? "xp") as BoardType;
        await interaction.reply({ components: [build(interaction.guild, type, interaction.user.id)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
    },
    async buttonHandler(interaction: ButtonInteraction) {
        if (!interaction.inCachedGuild()) return;
        const type = interaction.customId.split(":")[2] as BoardType;
        if (!BOARD_TYPES.includes(type)) return;
        await interaction.update({ components: [build(interaction.guild, type, interaction.user.id)], allowedMentions: { parse: [] } });
    }
} satisfies Command;
