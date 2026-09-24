import { ChannelSelectMenuBuilder, ChannelType, LabelBuilder, MessageFlags, ModalBuilder, PermissionFlagsBits, RoleSelectMenuBuilder } from "discord.js";
import { Command } from "../types/Command.js";
import { createApplicationTable } from "../schema/applicationDB.js";
import { buildPanelContainer, getApplicationConfig, handleApplicationButton, handleApplicationModal } from "../utils/applicationFlow.js";


const db = createApplicationTable();


export default {
    name: 'setup-application',
    description: 'Set up the guild application form and pick where applications are reviewed',
    options: [],
    async execute(interaction) {
        if (!interaction.guildId) {
            await interaction.reply({ content: `This command only works inside a server.`, flags: MessageFlags.Ephemeral });
            return;
        }

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            await interaction.reply({ content: `You need the **Manage Server** permission to set applications up.`, flags: MessageFlags.Ephemeral });
            return;
        }

        const modal = new ModalBuilder()
            .setCustomId('setup-application')
            .setTitle('Application setup')
            .addLabelComponents(
                new LabelBuilder()
                    .setLabel('Application panel channel')
                    .setDescription('Where members press Start Application to open the form.')
                    .setChannelSelectMenuComponent(
                        new ChannelSelectMenuBuilder()
                            .setCustomId('setup-application_panel')
                            .addChannelTypes(ChannelType.GuildText)
                            .setPlaceholder('Pick the channel applicants can see')
                            .setRequired(true)
                            .setMaxValues(1)
                    ),
                new LabelBuilder()
                    .setLabel('Officer review channel')
                    .setDescription('Where I post finished applications. Keep this one officers only.')
                    .setChannelSelectMenuComponent(
                        new ChannelSelectMenuBuilder()
                            .setCustomId('setup-application_review')
                            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                            .setPlaceholder('Pick the private officer channel')
                            .setRequired(true)
                            .setMaxValues(1)
                    ),
                new LabelBuilder()
                    .setLabel('Officer role')
                    .setDescription('This role can accept, reject and message applicants. Admins always can.')
                    .setRoleSelectMenuComponent(
                        new RoleSelectMenuBuilder()
                            .setCustomId('setup-application_officer')
                            .setPlaceholder('Optional')
                            .setRequired(false)
                            .setMaxValues(1)
                    ),
                new LabelBuilder()
                    .setLabel('Role to give when accepted')
                    .setDescription('Optional. I hand this role to anyone an officer accepts.')
                    .setRoleSelectMenuComponent(
                        new RoleSelectMenuBuilder()
                            .setCustomId('setup-application_role')
                            .setPlaceholder('Optional')
                            .setRequired(false)
                            .setMaxValues(1)
                    )
            );

        await interaction.showModal(modal);
    },

    async modalSubmit(interaction, client) {
        // Every step of the application form itself also arrives here.
        if (interaction.customId.startsWith('app_')) {
            await handleApplicationModal(interaction, client);
            return;
        }

        if (!interaction.guildId) return;

        const panel_pick = interaction.fields.getSelectedChannels('setup-application_panel', true, [ChannelType.GuildText]).first();
        const review_pick = interaction.fields.getSelectedChannels('setup-application_review', true, [ChannelType.GuildText, ChannelType.GuildAnnouncement]).first();
        const officer_role = interaction.fields.getSelectedRoles('setup-application_officer')?.first();
        const accepted_role = interaction.fields.getSelectedRoles('setup-application_role')?.first();

        if (!panel_pick || !review_pick) {
            await interaction.reply({ content: `I could not read those channels. Please run the command again.`, flags: MessageFlags.Ephemeral });
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const panel_channel = await client.channels.fetch(panel_pick.id).catch(() => null);
        const review_channel = await client.channels.fetch(review_pick.id).catch(() => null);

        if (!panel_channel?.isTextBased() || !panel_channel.isSendable()) {
            await interaction.editReply({ content: `I cannot post in <#${panel_pick.id}>. Give me **View Channel** and **Send Messages** there and run this again.` });
            return;
        }

        if (!review_channel?.isTextBased() || !review_channel.isSendable()) {
            await interaction.editReply({ content: `I cannot post in <#${review_pick.id}>. Give me **View Channel** and **Send Messages** there and run this again.` });
            return;
        }

        // Clear the previous panel so re-running this does not leave a second
        // button sitting in an old channel. If that message or its channel has
        // already been deleted by hand there is nothing to take down, so the
        // stale settings row goes instead. Stored applications are never part
        // of this, they live in their own table and stay put.
        const existing = getApplicationConfig(interaction.guildId);
        if (existing) {
            const old_channel = existing.panel_msg_id
                ? await client.channels.fetch(existing.panel_channel_id).catch(() => null)
                : null;

            const old_panel = old_channel?.isTextBased() && existing.panel_msg_id
                ? await old_channel.messages.fetch(existing.panel_msg_id).catch(() => null)
                : null;

            if (old_panel?.deletable) {
                await old_panel.delete().catch(() => {});
            } else {
                db.run(`DELETE FROM application_config WHERE guild_id = ?`, interaction.guildId);
            }
        }

        // Re-running setup keeps any panel wording edited on the dashboard.
        const panel_msg = await panel_channel.send({ components: [buildPanelContainer(existing)], flags: MessageFlags.IsComponentsV2 });

        db.run(
            `INSERT INTO application_config (guild_id, panel_channel_id, panel_msg_id, review_channel_id, reviewer_role_id, accepted_role_id)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(guild_id) DO UPDATE SET
                panel_channel_id = excluded.panel_channel_id,
                panel_msg_id = excluded.panel_msg_id,
                review_channel_id = excluded.review_channel_id,
                reviewer_role_id = excluded.reviewer_role_id,
                accepted_role_id = excluded.accepted_role_id`,
            interaction.guildId,
            panel_channel.id,
            panel_msg.id,
            review_channel.id,
            officer_role?.id ?? null,
            accepted_role?.id ?? null
        );

        await interaction.editReply({
            content: [
                `### Applications are live ✅`,
                `**Panel** <#${panel_channel.id}>`,
                `**Reviews go to** <#${review_channel.id}>`,
                `**Officers** ${officer_role ? `<@&${officer_role.id}>` : 'anyone with Manage Server'}`,
                `**Role on accept** ${accepted_role ? `<@&${accepted_role.id}>` : 'none'}`,
                ``,
                `-# Each application comes with **Message them** (I send a DM for you) and **Open DM** (opens their profile so you can write yourself).`
            ].join("\n")
        });
    },

    async buttonHandler(interaction, client) {
        await handleApplicationButton(interaction, client);
    }
} satisfies Command;
