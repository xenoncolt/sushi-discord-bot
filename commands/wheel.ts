import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChatInputCommandInteraction, ContainerBuilder, MessageFlags } from "discord.js";
import { Command } from "../types/Command.js";
import { BET_OPTION, Ready, Settled, V2, button, gameHeader, lockBet, outcomeColor, preflight, resultLines, rng, row, settle, startCooldown, wait } from "../games/common.js";
import { WheelSegment } from "../leveling/settings.js";
import { COLOR, sep, text } from "../leveling/ui.js";

// Segments, multipliers and weights all come from the dashboard. A segment's
// chance is weight ÷ total weight, and the expected return shown there is
// Σ(weight × multiplier) ÷ Σweight.

export function expectedReturn(segments: WheelSegment[]): number {
    const total = segments.reduce((s, x) => s + x.weight, 0);
    return total > 0 ? segments.reduce((s, x) => s + x.weight * x.multiplier, 0) / total : 0;
}

function pick(segments: WheelSegment[]): number {
    const total = segments.reduce((s, x) => s + x.weight, 0);
    let roll = rng(Math.max(1, total));
    for (let i = 0; i < segments.length; i++) {
        if (roll < segments[i].weight) return i;
        roll -= segments[i].weight;
    }
    return segments.length - 1;
}

function segmentRows(segments: WheelSegment[], lit: number, final: boolean): ActionRowBuilder<ButtonBuilder>[] {
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    for (let i = 0; i < segments.length; i += 5) {
        rows.push(row(...segments.slice(i, i + 5).map((s, j) => {
            const idx = i + j;
            const style = idx !== lit
                ? ButtonStyle.Secondary
                : !final ? ButtonStyle.Primary : s.multiplier >= 1 ? ButtonStyle.Success : ButtonStyle.Danger;
            return button(`wheel:seg:${idx}`, `×${s.multiplier}`, style, s.emoji, true);
        })));
    }
    return rows;
}

// The light walks one segment per frame towards the hit and slows down as it
// goes: [segments before the hit, ms before the next frame].
const SPIN: [number, number][] = [[4, 800], [3, 900], [2, 1100], [1, 1500]];

async function play(interaction: ChatInputCommandInteraction | ButtonInteraction, ready: Ready): Promise<void> {
    const { member, gs, bet, xp_name, channel } = ready;
    const segments = gs.segments;
    startCooldown(member.guild.id, member.id, "wheel", gs.cooldown);

    const level_before = lockBet(member, bet);
    const hit = pick(segments);
    const seg = segments[hit];
    const payout = Math.floor(bet * seg.multiplier);

    const frame = (lit: number) => {
        const c = gameHeader(new ContainerBuilder().setAccentColor(COLOR.gold), "🎡 Spin Wheel — Spinning...", member.id);
        for (const r of segmentRows(segments, lit, false)) c.addActionRowComponents(r);
        return c;
    };

    // Settled after the last frame so a level-up message can't spoil the spin
    // (see slot.ts).
    let result: Settled;
    try {
        for (const [i, [back, ms]] of SPIN.entries()) {
            const lit = ((hit - back) % segments.length + segments.length) % segments.length;
            if (i === 0) await interaction.reply({ components: [frame(lit)], flags: V2, allowedMentions: { parse: [] } });
            else await interaction.editReply({ components: [frame(lit)] }).catch(() => {});
            await wait(ms);
        }
    } finally {
        result = settle(member, "wheel", bet, payout, level_before, channel, `${seg.emoji} ×${seg.multiplier}`);
    }

    const done = gameHeader(new ContainerBuilder().setAccentColor(outcomeColor(result.net)), `🎡 Spin Wheel — ${seg.emoji} ×${seg.multiplier}`, member.id);
    for (const r of segmentRows(segments, hit, true)) done.addActionRowComponents(r);
    done.addSeparatorComponents(sep())
        .addTextDisplayComponents(text(resultLines(result.net, result.balance, xp_name,
            seg.multiplier === 0 ? `💀 **Bust!**` : `🎯 Landed on **${seg.emoji} ×${seg.multiplier}**`)))
        .addActionRowComponents(row(button(`wheel:again:${member.id}:${bet}`, "Spin again", ButtonStyle.Primary, "🔁")));
    await interaction.editReply({ components: [done] }).catch(() => {});
}

export default {
    name: "wheel",
    description: "Spin the wheel and win whatever multiplier it lands on",
    options: [BET_OPTION],
    async execute(interaction) {
        const ready = await preflight(interaction, "wheel", interaction.options.getString("bet", true));
        if (ready) await play(interaction, ready);
    },
    async buttonHandler(interaction) {
        const [, action, owner, bet] = interaction.customId.split(":");
        if (action !== "again") return;
        if (interaction.user.id !== owner) {
            await interaction.reply({ content: "Use `/wheel` to spin your own wheel!", flags: MessageFlags.Ephemeral });
            return;
        }
        const ready = await preflight(interaction, "wheel", bet);
        if (ready) await play(interaction, ready);
    }
} satisfies Command;
