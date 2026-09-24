import { ApplicationCommandOptionType, ContainerBuilder, MessageFlags } from "discord.js";
import { Command } from "../types/Command.js";
import { logActivity } from "../leveling/activity.js";
import { overdueDebt } from "../leveling/loans.js";
import { getMember } from "../leveling/members.js";
import { getSettings } from "../leveling/settings.js";
import { COLOR, fmt, text } from "../leveling/ui.js";
import { changeXp } from "../leveling/xp.js";

export default {
    name: "gift",
    description: "Give some of your XP to another member",
    options: [
        {
            name: "user",
            description: "Who gets the gift",
            type: ApplicationCommandOptionType.User,
            required: true
        },
        {
            name: "amount",
            description: "How much to give",
            type: ApplicationCommandOptionType.Integer,
            required: true,
            min_value: 1
        }
    ],
    cooldown: 5,
    async execute(interaction) {
        if (!interaction.inCachedGuild()) {
            await interaction.reply({ content: "This only works inside a server.", flags: MessageFlags.Ephemeral });
            return;
        }

        const s = getSettings(interaction.guildId).server;
        if (!s.gift_enabled) {
            await interaction.reply({ content: "Gifting is turned off on this server.", flags: MessageFlags.Ephemeral });
            return;
        }

        const target = interaction.options.getUser("user", true);
        const amount = interaction.options.getInteger("amount", true);
        if (target.bot || target.id === interaction.user.id) {
            await interaction.reply({ content: target.bot ? "Bots can't hold XP." : "You can't gift yourself.", flags: MessageFlags.Ephemeral });
            return;
        }

        const receiver = await interaction.guild.members.fetch(target.id).catch(() => null);
        if (!receiver) {
            await interaction.reply({ content: "That person isn't in this server.", flags: MessageFlags.Ephemeral });
            return;
        }

        // XP owed on a due loan belongs to the lender; gifting it away would dodge the debt.
        const debt = overdueDebt(interaction.guildId, interaction.user.id);
        if (debt > 0) {
            await interaction.reply({ content: `You have an overdue loan to pay back first (**${fmt(debt)} ${s.xp_name}**). You can gift again once it's paid.`, flags: MessageFlags.Ephemeral });
            return;
        }

        const balance = getMember(interaction.guildId, interaction.user.id).xp;
        if (amount > balance) {
            await interaction.reply({ content: `You only have **${fmt(balance)} ${s.xp_name}**.`, flags: MessageFlags.Ephemeral });
            return;
        }

        const here = interaction.channel?.isSendable() ? interaction.channel : null;
        const from = await changeXp(interaction.member, -amount);
        const to = await changeXp(receiver, amount, { channel: here });

        logActivity({
            guild_id: interaction.guildId,
            type: "xp",
            user_id: receiver.id,
            user_name: receiver.displayName,
            text: `${fmt(amount)} ${s.xp_name} Gift`,
            amount,
            actor_id: interaction.user.id,
            actor_name: interaction.member.displayName
        });

        await interaction.reply({
            components: [new ContainerBuilder().setAccentColor(COLOR.brand).addTextDisplayComponents(text([
                `### 🎁 Gift sent!`,
                `<@${interaction.user.id}> gave <@${receiver.id}> **${fmt(amount)} ${s.xp_name}**.`,
                `-# ${interaction.member.displayName}: ${fmt(from.xp)} · ${receiver.displayName}: ${fmt(to.xp)}`
            ].join("\n")))],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { users: [receiver.id] }
        });
    }
} satisfies Command;
