import { ApplicationCommandOptionType, ButtonInteraction, ButtonStyle, ContainerBuilder, MessageFlags } from "discord.js";
import { Command } from "../types/Command.js";
import { GAME_NAMES, button, gambleHistory, row } from "../games/common.js";
import { PVP_GAMES, getSettings } from "../leveling/settings.js";
import { COLOR, fmt, sep, signed, text } from "../leveling/ui.js";

function build(guild_id: string, user_id: string): ContainerBuilder {
    const xp_name = getSettings(guild_id).server.xp_name;
    const { recent, totals } = gambleHistory(guild_id, user_id, 10);
    const rate = totals.games ? Math.round((totals.wins / totals.games) * 100) : 0;

    return new ContainerBuilder()
        .setAccentColor(totals.net >= 0 ? COLOR.win : COLOR.lose)
        .addTextDisplayComponents(text([
            `### 🎲 Game record`,
            `<@${user_id}>`,
            `**${fmt(totals.games)}** games · **${fmt(totals.wins)}** W / **${fmt(totals.losses)}** L · **${rate}%** win rate`,
            `Wagered **${fmt(totals.wagered)}** · Net **${signed(totals.net)} ${xp_name}**`
        ].join("\n")))
        .addSeparatorComponents(sep())
        .addTextDisplayComponents(text(recent.length
            ? recent.map(r => `${r.net > 0 ? "🟢" : r.net < 0 ? "🔴" : "⚪"} **${GAME_NAMES[r.game] ?? r.game}**${PVP_GAMES.includes(r.game) ? " `PvP`" : ""} · bet ${fmt(r.bet)} · **${signed(r.net)}** · <t:${Math.floor(r.created_at / 1000)}:R>`).join("\n")
            : "*No games played yet.*"));
}

export default {
    name: "gamblehistory",
    description: "See your PvP and PvBot game record",
    options: [
        {
            name: "user",
            description: "Whose record to show",
            type: ApplicationCommandOptionType.User,
            required: false
        }
    ],
    async execute(interaction) {
        if (!interaction.guildId) {
            await interaction.reply({ content: "This only works inside a server.", flags: MessageFlags.Ephemeral });
            return;
        }
        const user = interaction.options.getUser("user") ?? interaction.user;
        const container = build(interaction.guildId, user.id);
        container.addActionRowComponents(row(button(`gamblehistory:share:${user.id}`, "Share in chat", ButtonStyle.Primary, "📣")));
        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    },
    async buttonHandler(interaction: ButtonInteraction) {
        if (!interaction.guildId) return;
        const user_id = interaction.customId.split(":")[2];
        await interaction.reply({ components: [build(interaction.guildId, user_id)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
    }
} satisfies Command;
