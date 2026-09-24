import { ApplicationCommandOptionType, MessageFlags } from "discord.js";
import { Command } from "../types/Command.js";
import { replyWithCard } from "../leveling/card.js";
import { levelForXp, xpForLevel } from "../leveling/formula.js";
import { getMember } from "../leveling/members.js";
import { stripPrefix } from "../leveling/prefix.js";
import { getSettings } from "../leveling/settings.js";
import { fmt } from "../leveling/ui.js";

export default {
    name: "level",
    description: "Show your level and XP, or how much XP a target level needs",
    options: [
        {
            name: "target",
            description: "A level to see how much XP you need to reach it",
            type: ApplicationCommandOptionType.Integer,
            required: false,
            min_value: 1,
            max_value: 10_000
        },
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

        // "/level target:20" also answers how far away that level is.
        const target = interaction.options.getInteger("target");
        let content: string | undefined;
        if (target) {
            const settings = getSettings(interaction.guildId);
            const xp = getMember(interaction.guildId, user.id).xp;
            const need = xpForLevel(target, settings.server.formula);
            const member = interaction.guild.members.cache.get(user.id);
            const who = user.id === interaction.user.id ? "You" : member ? stripPrefix(interaction.guildId, member.displayName) : user.displayName;
            content = levelForXp(xp, settings.server.formula) >= target
                ? `🎯 ${who} already reached level ${target} (it takes ${fmt(need)} ${settings.server.xp_name}).`
                : `🎯 Level **${target}** needs **${fmt(need)} ${settings.server.xp_name}** in total — ${who === "You" ? "you need" : `${who} needs`} **${fmt(need - xp)}** more.`;
        }

        await replyWithCard(interaction, user, content);
    }
} satisfies Command;
