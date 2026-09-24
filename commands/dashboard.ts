import { ContainerBuilder, MessageFlags } from "discord.js";
import { Command } from "../types/Command.js";
import { COLOR, dashboardUrl, linkRow, text } from "../leveling/ui.js";

export default {
    name: "dashboard",
    description: "Get the link to this server's leveling dashboard",
    options: [],
    async execute(interaction) {
        const url = dashboardUrl();
        if (!url || !interaction.guildId) {
            await interaction.reply({ content: "The dashboard isn't set up yet. The bot owner needs to set `DASHBOARD_URL`.", flags: MessageFlags.Ephemeral });
            return;
        }

        await interaction.reply({
            components: [new ContainerBuilder()
                .setAccentColor(COLOR.brand)
                .addTextDisplayComponents(text(`### ⚙️ Dashboard\nChange XP rates, level roles, boosts, games and more. You'll log in with Discord; only admins (and the dashboard's Admin Roles) can change settings.`))
                .addActionRowComponents(linkRow(
                    { label: "Open dashboard", url: `${url}/dashboard/${interaction.guildId}/server`, emoji: "⚙️" },
                    { label: "Leaderboard", url: `${url}/leaderboard/${interaction.guildId}`, emoji: "🏆" },
                    { label: "XP Shop", url: `${url}/shop/${interaction.guildId}`, emoji: "🛒" },
                    { label: "Statistics", url: `${url}/dashboard/${interaction.guildId}/statistics`, emoji: "📊" }
                ))],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    }
} satisfies Command;
