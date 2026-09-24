import { ApplicationCommandOptionType, MessageFlags, PermissionFlagsBits } from "discord.js";
import { Command } from "../types/Command.js";
import { isManager } from "../leveling/perms.js";

// Bulk-delete recent messages in the current channel. Discord refuses to
// bulk-delete anything older than 14 days, so those are skipped.
export default {
    name: "purge",
    description: "Bulk-delete messages in this channel (admins)",
    options: [
        {
            name: "count",
            description: "How many messages to delete (1-100)",
            type: ApplicationCommandOptionType.Integer,
            required: true,
            min_value: 1,
            max_value: 100
        }
    ],
    async execute(interaction) {
        if (!interaction.inCachedGuild()) {
            await interaction.reply({ content: "This only works inside a server.", flags: MessageFlags.Ephemeral });
            return;
        }
        if (!isManager(interaction.member)) {
            await interaction.reply({ content: "Only users with Manage Server or an admin role can purge messages.", flags: MessageFlags.Ephemeral });
            return;
        }

        const channel = interaction.channel;
        if (!channel || !("bulkDelete" in channel)) {
            await interaction.reply({ content: "Messages can't be bulk-deleted in this channel.", flags: MessageFlags.Ephemeral });
            return;
        }
        const me = interaction.guild.members.me;
        if (!me || !channel.permissionsFor(me).has([PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory])) {
            await interaction.reply({ content: "I need **Manage Messages** and **Read Message History** in this channel.", flags: MessageFlags.Ephemeral });
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const count = interaction.options.getInteger("count", true);

        try {
            const deleted = await channel.bulkDelete(count, true);
            const skipped = count - deleted.size;
            await interaction.editReply({
                content: `🧹 Deleted **${deleted.size}** message(s).${skipped > 0 ? ` ${skipped} were older than 14 days (or didn't exist) and were skipped.` : ""}`
            });
        } catch (err) {
            console.error("Purge failed:", err);
            await interaction.editReply({ content: "I couldn't delete those messages." });
        }
    }
} satisfies Command;
