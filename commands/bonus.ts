import { ContainerBuilder, MessageFlags } from "discord.js";
import { Command } from "../types/Command.js";
import { logActivity } from "../leveling/activity.js";
import { claimBonus } from "../leveling/members.js";
import { getSettings } from "../leveling/settings.js";
import { recordXpEarned } from "../leveling/stats.js";
import { dayKey, dayStart, shiftDay } from "../leveling/time.js";
import { COLOR, fmt, linkRow, text } from "../leveling/ui.js";
import { changeXp } from "../leveling/xp.js";

// Extra XP for voting for the bot, once a day. The vote is checked on
// whichever bot lists have a token in .env (TOPGG_TOKEN, KOREANBOTS_TOKEN).
// With neither set there is nothing to vote on, so the bonus is simply daily.

interface VoteSite {
    name: string;
    vote_url: string;
    voted: () => Promise<boolean>;
}

function voteSites(bot_id: string, user_id: string): VoteSite[] {
    const sites: VoteSite[] = [];

    const topgg = process.env.TOPGG_TOKEN?.trim();
    if (topgg) {
        sites.push({
            name: "top.gg",
            vote_url: `https://top.gg/bot/${bot_id}/vote`,
            voted: async () => {
                const r = await fetch(`https://top.gg/api/bots/${bot_id}/check?userId=${user_id}`, {
                    headers: { Authorization: topgg },
                    signal: AbortSignal.timeout(6000)
                });
                if (!r.ok) throw new Error(`top.gg answered ${r.status}`);
                return ((await r.json()) as { voted?: number }).voted === 1;
            }
        });
    }

    const koreanbots = process.env.KOREANBOTS_TOKEN?.trim();
    if (koreanbots) {
        sites.push({
            name: "Koreanbots",
            vote_url: `https://koreanbots.dev/bots/${bot_id}/vote`,
            voted: async () => {
                const r = await fetch(`https://koreanbots.dev/api/v2/bots/${bot_id}/vote?userID=${user_id}`, {
                    headers: { Authorization: koreanbots },
                    signal: AbortSignal.timeout(6000)
                });
                if (!r.ok) throw new Error(`Koreanbots answered ${r.status}`);
                return ((await r.json()) as { data?: { voted?: boolean } }).data?.voted === true;
            }
        });
    }

    return sites;
}

export default {
    name: "bonus",
    description: "Claim extra XP for voting for the bot (once a day)",
    options: [],
    async execute(interaction, client) {
        if (!interaction.inCachedGuild()) {
            await interaction.reply({ content: "This only works inside a server.", flags: MessageFlags.Ephemeral });
            return;
        }

        const s = getSettings(interaction.guildId).server;
        if (!s.bonus_enabled || s.bonus_xp <= 0) {
            await interaction.reply({ content: "The bonus is turned off on this server.", flags: MessageFlags.Ephemeral });
            return;
        }

        const next_reset = Math.floor(dayStart(s.timezone, shiftDay(dayKey(s.timezone), 1)) / 1000);
        const sites = voteSites(client.user!.id, interaction.user.id);

        if (sites.length) {
            await interaction.deferReply({ flags: s.private_daily ? MessageFlags.Ephemeral : undefined });
            let voted = false;
            for (const site of sites) {
                try {
                    if (await site.voted()) {
                        voted = true;
                        break;
                    }
                } catch (err) {
                    console.error(`Vote check on ${site.name} failed:`, (err as Error).message);
                }
            }
            if (!voted) {
                await interaction.editReply({
                    components: [new ContainerBuilder()
                        .setAccentColor(COLOR.pending)
                        .addTextDisplayComponents(text(`### 🗳️ Vote first!\nVote for me, then run \`/bonus\` again to collect **${fmt(s.bonus_xp)} ${s.xp_name}**.`))
                        .addActionRowComponents(linkRow(...sites.map(site => ({ label: `Vote on ${site.name}`, url: site.vote_url, emoji: "🗳️" }))))],
                    flags: MessageFlags.IsComponentsV2
                });
                return;
            }
        }

        if (!claimBonus(interaction.guildId, interaction.user.id)) {
            const content = `🎁 You already collected today's bonus. The next one unlocks <t:${next_reset}:R>.`;
            if (interaction.deferred) await interaction.editReply({ content });
            else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
            return;
        }

        const here = interaction.channel?.isSendable() ? interaction.channel : null;
        const result = await changeXp(interaction.member, s.bonus_xp, { channel: here });
        recordXpEarned(interaction.guildId, s.bonus_xp, interaction.channelId);
        logActivity({ guild_id: interaction.guildId, type: "xp", user_id: interaction.user.id, user_name: interaction.member.displayName, text: `Bonus · +${fmt(s.bonus_xp)}`, amount: s.bonus_xp });

        const payload = {
            components: [new ContainerBuilder().setAccentColor(COLOR.gold).addTextDisplayComponents(text([
                `### 🎁 Bonus collected!`,
                `${sites.length ? "Thanks for voting! " : ""}<@${interaction.user.id}> received **+${fmt(s.bonus_xp)} ${s.xp_name}**.`,
                `-# Balance ${fmt(result.xp)} ${s.xp_name} · next bonus <t:${next_reset}:R>`
            ].join("\n")))],
            allowedMentions: { parse: [] as [] }
        };

        if (interaction.deferred) {
            await interaction.editReply({ ...payload, flags: MessageFlags.IsComponentsV2 });
        } else {
            await interaction.reply({ ...payload, flags: s.private_daily ? MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral : MessageFlags.IsComponentsV2 });
        }
    }
} satisfies Command;
