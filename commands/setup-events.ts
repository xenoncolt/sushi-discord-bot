import { ApplicationCommandOptionData, ApplicationCommandOptionType, ChannelSelectMenuBuilder, ChannelType, CheckboxBuilder, LabelBuilder, ModalBuilder, RoleSelectMenuBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, TextChannel, TextInputBuilder, TextInputStyle } from "discord.js";
import { Command } from "../types/Command.js";
import { createTimingTable } from "../schema/timingDB.js";
import { scheduleEvent } from "../utils/eventScheduler.js";
import { TimingRow } from "../types/TimingRow.js";


let event_time: Date;
const event_db = await createTimingTable();

export default {
    name: 'setup-events',
    description: 'Set up a channel where it will show all event timings',
    options: [
        // {
        //     name: 'channel',
        //     description: 'The channel to send and update the timing message in',
        //     type: ApplicationCommandOptionType.Channel,
        //     required: true
        // },
        {
            name: 'timezone',
            description: "What your timezone? (Example: +2 / +8)",
            type: ApplicationCommandOptionType.Number,
            required: true,
            max_value: 14,
            min_value: -12,
        },
        {
            name: 'hour',
            description: "Event hour in 24h format (Example: 0, 13, 23)",
            type: ApplicationCommandOptionType.Integer,
            required: true,
            max_value: 23,
            min_value: 0,
        },
        {
            name: 'minute',
            description: "Event minute (Example: 0, 30)",
            type: ApplicationCommandOptionType.Integer,
            required: true,
            max_value: 59,
            min_value: 0,
        },
        {
            name: 'date',
            description: 'Date (optional, defaults to UTC today)',
            type: ApplicationCommandOptionType.Integer,
            required: true,
            min_value: 1,
            max_value: 31,
        },
        {
            name: 'month',
            description: 'Month (optional, defaults to UTC this month)',
            type: ApplicationCommandOptionType.Integer,
            required: true,
            min_value: 1,
            max_value: 12,
        },
        {
            name: 'year',
            description: 'Year (optional, defaults to UTC this year)',
            type: ApplicationCommandOptionType.Integer,
            required: true,
            min_value: 1900,
            max_value: 3000,
        },
        // {
        //     name: 'event-type',
        //     description: "What event do you want to set up the reminder for?",
        //     type: ApplicationCommandOptionType.String,
        //     required: true,
        //     choices: [
        //         { name: 'One-time Event', value: 'once' },
        //         { name: 'Daily Reminder', value: 'daily' },
        //         { name: 'Weekly Reminder', value: 'weekly' },
        //         { name: 'Monthly Reminder', value: 'monthly' },
        //     ]
        // }
        // {
        //     name: 'event-name',
        //     description: "Name of the event (Example: Guild War, Guild Showdown, etc.)",
        //     type: ApplicationCommandOptionType.String,
        //     required: true,
        //     max_length: 50,
        //     min_length: 1,
        // },
        // {
        //     name: 'announce-msg',
        //     description: "The message to announce when the event is about to start",
        //     type: ApplicationCommandOptionType.String,
        //     required: true,
        //     max_length: 1000,
        //     min_length: 1,
        // }
    ] satisfies ApplicationCommandOptionData[],
    async execute(interaction, client) {
        const timezone = interaction.options.getNumber('timezone', true);
        const hour = interaction.options.getInteger('hour', true);
        const minute = interaction.options.getInteger('minute', true);
        const date = interaction.options.getInteger('date', true);
        const month = interaction.options.getInteger('month', true);
        const year = interaction.options.getInteger('year', true);

        // const event_type = interaction.options.getString('event-type', true);

        event_time = new Date(
            Date.UTC(
                year,
                month - 1,
                date,
                hour - timezone,
                minute
            )
        )
        // console.log('Event time in UTC:', event_time.toISOString());
        
            const modal = new ModalBuilder()
            .setCustomId('setup-events')
            .setTitle('Event Setup')
            .addLabelComponents(
                new LabelBuilder()
                    .setLabel('Announcement Channel:')
                    .setChannelSelectMenuComponent(
                        new ChannelSelectMenuBuilder()
                            .setCustomId('setup-events_channel')
                            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                            .setPlaceholder('Select a channel for event announce')
                            .setRequired(true)
                            .setMaxValues(1)
                    ),
                new LabelBuilder()
                    .setLabel('Announcement Message:')
                    .setTextInputComponent(
                        new TextInputBuilder()
                            .setCustomId('setup-events_msg')
                            .setPlaceholder('Enter the announcement message (to mention role use this <@&role_id>)')
                            .setRequired(true)
                            .setStyle(TextInputStyle.Paragraph)
                            .setMaxLength(1000)
                            .setMinLength(10)
                    ),
                new LabelBuilder()
                    .setLabel("Event Name:")
                    .setTextInputComponent(
                        new TextInputBuilder()
                            .setCustomId('setup-events_name')
                            .setPlaceholder('Enter the event name (Example: Guild War, Guild Showdown, etc.)')
                            .setRequired(true)
                            .setStyle(TextInputStyle.Short)
                            .setMaxLength(100)
                            .setMinLength(1)
                    ),
                new LabelBuilder()
                    .setLabel("Event Type:")
                    .setStringSelectMenuComponent(
                        new StringSelectMenuBuilder()
                            .setCustomId('setup-events_type')
                            .setPlaceholder('Select the event type')
                            .setRequired(true)
                            .addOptions(
                                new StringSelectMenuOptionBuilder()
                                    .setLabel('One-time Event')
                                    .setValue('once'),
                                new StringSelectMenuOptionBuilder()
                                    .setLabel('Daily Reminder Message')
                                    .setValue('daily'),
                                new StringSelectMenuOptionBuilder()
                                    .setLabel('Weekly Reminder Message')
                                    .setValue('weekly'),
                                new StringSelectMenuOptionBuilder()
                                    .setLabel('Monthly Reminder Message')
                                    .setValue('monthly')
                            )
                    ),
                new LabelBuilder()
                    .setLabel('Event Notice Board channel: ')
                    .setDescription('Show this event on notice board (its only if u want to show it on notice board)')
                    .setChannelSelectMenuComponent(
                        new ChannelSelectMenuBuilder()
                            .setCustomId('setup-events_board')
                            .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                            .setRequired(false)
                            .setMaxValues(1)
                            .setPlaceholder('Select a channel')
                    )
            )

            await interaction.showModal(modal)
        
    },
    
    async modalSubmit(interaction, client) {
        const channel = interaction.fields.getSelectedChannels('setup-events_channel', true, [ChannelType.GuildText, ChannelType.GuildAnnouncement]).first();
        const msg = interaction.fields.getTextInputValue('setup-events_msg');
        const name = interaction.fields.getTextInputValue('setup-events_name');
        const type = interaction.fields.getStringSelectValues('setup-events_type')[0];
        const board_channel = interaction.fields.getSelectedChannels('setup-events_board')?.first();

        // console.log(channel?.id);
        // console.log(event_time);

        // TODO: save all to db
        const result = await event_db.run(
            `INSERT INTO timing (event_name, event_time, channel_id, guild_id, msg, type, board_channel_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            name,
            event_time.getTime(),
            channel?.id,
            interaction.guildId,
            msg,
            type,
            !board_channel ? null : board_channel.id
        );

        const new_event = await event_db.get<TimingRow>(`SELECT * FROM timing WHERE id = ?`, result.lastID).catch(console.error);
        if (new_event) scheduleEvent(client, new_event);

        await interaction.reply({ content: `Event "${name}" has been set up successfully for <t:${Math.floor(event_time.getTime() / 1000)}:F>`, ephemeral: true });
    },
} satisfies Command;