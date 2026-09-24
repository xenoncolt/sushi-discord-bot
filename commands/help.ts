import { ContainerBuilder, MessageFlags } from "discord.js";
import { Command } from "../types/Command.js";
import { COLOR, dashboardUrl, linkRow, sep, text } from "../leveling/ui.js";

const SECTIONS: [string, [string, string][]][] = [
    ["⚡ Basic", [
        ["rank", "Your rank card (or someone's)"],
        ["level", "Your level, or XP needed for a target level"],
        ["leaderboard", "Top 10 (full list on the web)"],
        ["daily", "Daily check-in & XP"],
        ["bonus", "Bonus XP for voting (daily)"],
        ["gift", "Give XP to someone"],
        ["loan", "Lend XP with interest, or ask someone for a loan"],
        ["shop", "Spend XP on roles & rewards"],
        ["gamblehistory", "Your recent bets"],
        ["dashboard", "Open the server dashboard"]
    ]],
    ["⚔️ PvP games", [
        ["gamble", "Odd-Even"],
        ["dice", "Dice"],
        ["baskin", "Baskin Robbins 31"],
        ["roulette", "Russian Roulette (2-6)"],
        ["indianpoker", "Indian Poker"],
        ["tictactoe", "Tic-Tac-Toe"]
    ]],
    ["🤖 vs Bot games", [
        ["scratch", "Scratch Lottery"],
        ["slot", "Slot Machine"],
        ["wheel", "Spin Wheel"],
        ["blackjack", "Blackjack"],
        ["horserace", "Horse Race"],
        ["minesweeper", "Minesweeper"],
        ["highlow", "High-Low"],
        ["tower", "Tower"],
        ["bomb", "Bomb Defusal"]
    ]],
    ["🔧 Admin", [
        ["lottery", "Give XP to a random member"],
        ["levelsync", "Re-sync level roles & prefixes"],
        ["purge", "Bulk-delete messages"]
    ]]
];

export default {
    name: "help",
    description: "List everything the leveling bot can do",
    options: [],
    async execute(interaction) {
        const container = new ContainerBuilder()
            .setAccentColor(COLOR.brand)
            .addTextDisplayComponents(text(`## 📖 Commands\nChat and hang out in voice to earn XP, level up for roles, and spend or gamble it.`));

        for (const [title, cmds] of SECTIONS) {
            container.addSeparatorComponents(sep());
            container.addTextDisplayComponents(text(`**${title}**\n${cmds.map(([n, d]) => `\`/${n}\` ${d}`).join(" · ")}`));
        }

        const url = dashboardUrl();
        if (url && interaction.guildId) {
            container.addActionRowComponents(linkRow(
                { label: "Leaderboard", url: `${url}/leaderboard/${interaction.guildId}`, emoji: "🏆" },
                { label: "XP Shop", url: `${url}/shop/${interaction.guildId}`, emoji: "🛒" },
                { label: "Dashboard", url: `${url}/dashboard/${interaction.guildId}`, emoji: "⚙️" }
            ));
        }

        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }
} satisfies Command;
