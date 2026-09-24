import { ApplicationCommandOptionType, ButtonInteraction, ButtonStyle, ContainerBuilder, GuildMember, MessageFlags } from "discord.js";
import { Command } from "../types/Command.js";
import { GameStore, LiveGame, V2, button, editGame, newId, rng, row } from "../games/common.js";
import { logActivity } from "../leveling/activity.js";
import { isManager } from "../leveling/perms.js";
import { getSettings } from "../leveling/settings.js";
import { COLOR, fmt, sep, text } from "../leveling/ui.js";
import { changeXp } from "../leveling/xp.js";

// Admin giveaway. Without a role: members press Join and the admin presses
// Start Draw; one participant wins the EXP. The event expires after 5 minutes.
// With a role: one member holding it is picked straight away.

const EXPIRES_MS = 5 * 60_000;

interface Draw extends LiveGame {
    guild_id: string;
    host: GuildMember;
    exp: number;
    ends_at: number;
    entrants: Map<string, GuildMember>;
}

function view(d: Draw, footer?: string): ContainerBuilder {
    const xp_name = getSettings(d.guild_id).server.xp_name;
    const container = new ContainerBuilder()
        .setAccentColor(footer ? COLOR.win : COLOR.gold)
        .addTextDisplayComponents(text([
            `## 🎟️ Lottery`,
            `🎁 Prize: **${fmt(d.exp)} ${xp_name}**`,
            `👥 Participants: **${d.entrants.size}**`,
            footer ? "" : `⏰ Closes <t:${Math.floor(d.ends_at / 1000)}:R> · hosted by <@${d.host.id}>`
        ].filter(Boolean).join("\n")));

    if (footer) {
        container.addSeparatorComponents(sep());
        container.addTextDisplayComponents(text(footer));
    } else {
        container.addActionRowComponents(row(
            button(`lottery:${d.id}:join`, "Join", ButtonStyle.Success, "🎟️"),
            button(`lottery:${d.id}:draw`, "Start Draw", ButtonStyle.Primary, "🎲"),
            button(`lottery:${d.id}:cancel`, "Cancel", ButtonStyle.Secondary)
        ));
    }
    return container;
}

const draws = new GameStore<Draw>(EXPIRES_MS, async d => {
    await editGame(d, { components: [view(d, "⌛ The lottery expired before the draw.")] });
});

async function award(winner: GuildMember, exp: number, host: GuildMember, how: string): Promise<number> {
    const r = await changeXp(winner, exp);
    logActivity({ guild_id: winner.guild.id, type: "xp", user_id: winner.id, user_name: winner.displayName, text: `Won the lottery${how} · +${fmt(exp)}`, amount: exp, actor_id: host.id, actor_name: host.displayName });
    return r.xp;
}

export default {
    name: "lottery",
    description: "Give EXP to a random member (admins)",
    options: [
        { name: "exp", description: "EXP the winner receives", type: ApplicationCommandOptionType.Integer, required: true, min_value: 1, max_value: 100_000_000 },
        { name: "role", description: "Draw instantly from everyone with this role (skips the join step)", type: ApplicationCommandOptionType.Role, required: false }
    ],
    async execute(interaction) {
        if (!interaction.inCachedGuild()) {
            await interaction.reply({ content: "This only works inside a server.", flags: MessageFlags.Ephemeral });
            return;
        }
        if (!isManager(interaction.member)) {
            await interaction.reply({ content: "Only users with Manage Server or an admin role can run a lottery.", flags: MessageFlags.Ephemeral });
            return;
        }

        const exp = interaction.options.getInteger("exp", true);
        const role = interaction.options.getRole("role");
        const xp_name = getSettings(interaction.guildId).server.xp_name;

        if (role) {
            await interaction.deferReply();
            await interaction.guild.members.fetch().catch(() => {});
            const pool = interaction.guild.members.cache.filter(m => !m.user.bot && m.roles.cache.has(role.id));
            if (!pool.size) {
                await interaction.editReply({ content: `Nobody has <@&${role.id}>, so there's no one to draw.`, allowedMentions: { parse: [] } });
                return;
            }
            const winner = [...pool.values()][rng(pool.size)];
            const balance = await award(winner, exp, interaction.member, ` (@${role.name})`);
            await interaction.editReply({
                components: [new ContainerBuilder().setAccentColor(COLOR.win).addTextDisplayComponents(text([
                    `## 🎲 Lottery draw`,
                    `Out of **${pool.size}** members with <@&${role.id}>…`,
                    `🏆 <@${winner.id}> wins **${fmt(exp)} ${xp_name}**! (balance ${fmt(balance)})`
                ].join("\n")))],
                flags: V2,
                allowedMentions: { users: [winner.id] }
            });
            return;
        }

        const d: Draw = {
            id: newId(),
            last: interaction,
            guild_id: interaction.guildId,
            host: interaction.member,
            exp,
            ends_at: Date.now() + EXPIRES_MS,
            entrants: new Map()
        };
        draws.add(d);
        await interaction.reply({ components: [view(d)], flags: V2, allowedMentions: { parse: [] } });
    },

    async buttonHandler(interaction: ButtonInteraction) {
        if (!interaction.inCachedGuild()) return;
        const [, id, action] = interaction.customId.split(":");
        const d = draws.get(id);
        if (!d) {
            await interaction.reply({ content: "This lottery has ended.", flags: MessageFlags.Ephemeral });
            return;
        }

        if (action === "join") {
            if (d.entrants.has(interaction.user.id)) {
                await interaction.reply({ content: "You're already in! Good luck 🍀", flags: MessageFlags.Ephemeral });
                return;
            }
            d.entrants.set(interaction.user.id, interaction.member);
            d.last = interaction;
            await interaction.update({ components: [view(d)] });
            return;
        }

        // Start Draw and Cancel are for the host or any admin.
        if (interaction.user.id !== d.host.id && !isManager(interaction.member)) {
            await interaction.reply({ content: "Only the host or an admin can do that.", flags: MessageFlags.Ephemeral });
            return;
        }

        if (action === "cancel") {
            draws.end(d.id);
            await interaction.update({ components: [view(d, `🚫 Cancelled by <@${interaction.user.id}>.`)] });
            return;
        }

        if (action === "draw") {
            if (!d.entrants.size) {
                await interaction.reply({ content: "Nobody has joined yet.", flags: MessageFlags.Ephemeral });
                return;
            }
            draws.end(d.id);
            const entrants = [...d.entrants.values()];
            const winner = entrants[rng(entrants.length)];
            const balance = await award(winner, d.exp, d.host, "");
            const xp_name = getSettings(d.guild_id).server.xp_name;
            await interaction.update({
                components: [view(d, `🏆 <@${winner.id}> wins **${fmt(d.exp)} ${xp_name}**! (balance ${fmt(balance)})`)],
                allowedMentions: { users: [winner.id] }
            });
        }
    }
} satisfies Command;
