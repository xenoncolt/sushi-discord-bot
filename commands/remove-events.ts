import { ApplicationCommandOptionData, ApplicationCommandOptionType, GuildChannel, GuildChannelType, GuildMember, MessageFlags, PermissionFlagsBits } from "discord.js";
import { Command } from "../types/Command.js";
import { createTimingTable } from "../schema/timingDB.js";
import { TimingRow } from "../types/TimingRow.js";
import { clearEventTimer } from "../utils/eventScheduler.js";


const db = await createTimingTable(); 


export default {
    name: 'remove-events',
    description: 'Remove all events and the event board message in the server',
    options: [
        {
            name: 'event',
            description: 'Select a event which you want to remove',
            type: ApplicationCommandOptionType.Number,
            required: true,
            autocomplete: true
        }
    ] satisfies ApplicationCommandOptionData[],
    async execute(interaction, client) {
        const event_id = interaction.options.getNumber('event', true); 

        const event = await db.get<TimingRow>(`SELECT * FROM timing WHERE id = ? AND guild_id = ?`, event_id, interaction.guildId);

        if (!event) {
            await interaction.reply({ content: `Event not found`, flags: MessageFlags.Ephemeral });
            return;
        }

        if (event.board_channel_id && event.board_msg_id) {
            try {
                const board_channel = client.channels.cache.get(event.board_channel_id) as GuildChannel;

                if (board_channel?.isTextBased() && board_channel.isSendable()) {
                    const board_msg = await board_channel.messages.fetch(event.board_msg_id).catch(() => null);
                    if (board_channel.permissionsFor(interaction.member as GuildMember).has([PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageChannels])) {
                        if (board_msg?.deletable) await board_msg.delete();
                    }
                } else {
                    await interaction.reply({ content: `You are not allowed to use this command.`, flags: MessageFlags.Ephemeral });
                }
            } catch {
                console.log("Something wrong with remove cmd");
            }
        }

        const channel = client.channels.cache.get(event.channel_id) as GuildChannel;
        if (!channel.permissionsFor(interaction.member as GuildMember).has([PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageChannels])) {
            await interaction.reply({ content: `You are not allowed to use this command.`, flags: MessageFlags.Ephemeral });
            return;
        }

        await db.run(`DELETE FROM timing WHERE id = ?`, event.id);
        clearEventTimer(event.id);

        await interaction.reply({ content: `Event **${event.event_name}** has been remove successfully`, flags: MessageFlags.Ephemeral });
    }, 
    async autocomplete(interaction) {
        const focused = interaction.options.getFocused().toLowerCase();

        const events = await db.all<TimingRow[]>(`SELECT * FROM timing WHERE guild_id = ?`, interaction.guildId);

        const choices = events.filter(e => e.event_name.toLowerCase().includes(focused)).slice(0, 25).map(e => ({
            name: e.event_name,
            value: e.id
        }));

        await interaction.respond(choices);
    }
} satisfies Command;