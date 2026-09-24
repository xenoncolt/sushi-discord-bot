import { ApplicationCommandOptionType, MessageFlags } from "discord.js";
import { Command } from "../types/Command.js";
import { replyWithCard } from "../leveling/card.js";

// Just the rank card: yours, or the mentioned member's.
export default {
    name: "rank",
    description: "Show your rank card (or someone else's)",
    options: [
        {
            name: "user",
            description: "Whose card to show",
            type: ApplicationCommandOptionType.User,
            required: false
        }
    ],
    cooldown: 3,
    async execute(interaction) {
        if (!interaction.inCachedGuild()) {
            await interaction.reply({ content: "This only works inside a server.", flags: MessageFlags.Ephemeral });
            return;
        }

        const user = interaction.options.getUser("user") ?? interaction.user;
        if (user.bot) {
            await interaction.reply({ content: "Bots don't collect XP.", flags: MessageFlags.Ephemeral });
            return;
        }

        await replyWithCard(interaction, user);
    }
} satisfies Command;
