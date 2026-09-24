import { ButtonInteraction, ButtonStyle, ContainerBuilder, GuildMember, MessageFlags, SendableChannels } from "discord.js";
import { Command } from "../types/Command.js";
import { BET_OPTION, GameStore, LiveGame, Settled, V2, button, editGame, gameHeader, gameOver, lockBet, newId, notYours, outcomeColor, preflight, resultLines, rng, routeId, row, settle, startCooldown, wait } from "../games/common.js";
import { getMember } from "../leveling/members.js";
import { getSettings } from "../leveling/settings.js";
import { COLOR, fmt, sep, text } from "../leveling/ui.js";

// Pick one of N horses with the buttons, then watch the race. The winner is
// drawn fairly up front (1 in N); the frames are only animation that makes
// sure that horse crosses first. Winning pays the multiplier (×4 by default).
const TRACK = 14;
const FRAME_MS = 1500;
const NUMBERS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣"];

interface Pending extends LiveGame {
    member: GuildMember;
    bet: number;
    horses: number;
    multiplier: number;
    channel: SendableChannels | null;
}

function frames(horses: number, winner: number): number[][] {
    const steps = 4;
    const out: number[][] = [];
    let pos = new Array(horses).fill(0);
    for (let s = 1; s <= steps; s++) {
        pos = pos.map((p, i) => {
            if (s === steps) return i === winner ? TRACK : Math.min(TRACK - 1 - rng(3), p + 2 + rng(4));
            const stride = 2 + rng(4) + (i === winner ? 1 : 0);
            return Math.min(TRACK - 2, p + stride);
        });
        out.push([...pos]);
    }
    return out;
}

function track(pos: number[], pick: number | null, winner: number | null): string {
    return pos.map((p, i) => {
        const lane = "·".repeat(TRACK - p) + "🏇" + "·".repeat(p);
        return `${NUMBERS[i]} \`🏁${lane}\`${winner === i ? " 🏆" : ""}${i === pick ? " ⬅️" : ""}`;
    }).join("\n");
}

function pickView(p: Pending, note?: string): ContainerBuilder {
    const xp_name = getSettings(p.member.guild.id).server.xp_name;
    const container = gameHeader(new ContainerBuilder().setAccentColor(note ? COLOR.push : COLOR.gold), "🏇 Horse Race", p.member.id, `Bet ${fmt(p.bet)} ${xp_name}`)
        .addTextDisplayComponents(text(track(new Array(p.horses).fill(0), null, null)));
    if (note) {
        container.addTextDisplayComponents(text(note));
        return container;
    }
    container.addTextDisplayComponents(text(`Pick the horse you think will win — it pays **×${p.multiplier}**.`));
    for (let i = 0; i < p.horses; i += 4) {
        container.addActionRowComponents(row(...Array.from({ length: Math.min(4, p.horses - i) }, (_, j) =>
            button(`horserace:${p.id}:pick:${i + j}`, `Horse ${i + j + 1}`, ButtonStyle.Secondary, NUMBERS[i + j])
        )));
    }
    return container;
}

const pending = new GameStore<Pending>(60_000, async p => {
    await editGame(p, { components: [pickView(p, "⌛ No horse was picked in time. No bet was taken.")] });
});

export default {
    name: "horserace",
    description: "Bet on a horse and watch the race",
    options: [BET_OPTION],
    async execute(interaction) {
        const ready = await preflight(interaction, "horserace", interaction.options.getString("bet", true));
        if (!ready) return;
        const p: Pending = {
            id: newId(),
            last: interaction,
            member: ready.member,
            bet: ready.bet,
            horses: ready.gs.horses,
            multiplier: ready.gs.multiplier,
            channel: ready.channel
        };
        pending.add(p);
        await interaction.reply({ components: [pickView(p)], flags: V2, allowedMentions: { parse: [] } });
    },
    async buttonHandler(interaction: ButtonInteraction) {
        const { id, arg } = routeId(interaction.customId);
        const p = pending.get(id);
        if (!p) return gameOver(interaction);
        if (interaction.user.id !== p.member.id) return notYours(interaction, "race");

        const xp_name = getSettings(p.member.guild.id).server.xp_name;
        if (getMember(p.member.guild.id, p.member.id).xp < p.bet) {
            await interaction.reply({ content: `You no longer have **${fmt(p.bet)} ${xp_name}** to bet.`, flags: MessageFlags.Ephemeral });
            return;
        }
        pending.end(p.id);

        const pick = Math.min(p.horses - 1, Math.max(0, Number(arg)));
        startCooldown(p.member.guild.id, p.member.id, "horserace", getSettings(p.member.guild.id).gamble.games.horserace.cooldown);
        const level_before = lockBet(p.member, p.bet);
        const winner = rng(p.horses);
        const won = winner === pick;

        const race = frames(p.horses, winner);
        const header = `🏇 Horse Race — you backed ${NUMBERS[pick]}`;
        const view = (pos: number[]) => gameHeader(new ContainerBuilder().setAccentColor(COLOR.gold), header, p.member.id)
            .addTextDisplayComponents(text(track(pos, pick, null)));

        // Settled at the finish line so a level-up message can't spoil the race
        // (see slot.ts).
        let result: Settled;
        try {
            await interaction.update({ components: [view(new Array(p.horses).fill(0))] });
            for (const pos of race.slice(0, -1)) {
                await wait(FRAME_MS);
                await interaction.editReply({ components: [view(pos)] }).catch(() => {});
            }
            await wait(FRAME_MS);
        } finally {
            result = settle(p.member, "horserace", p.bet, won ? Math.floor(p.bet * p.multiplier) : 0, level_before, p.channel, `picked ${pick + 1}, won ${winner + 1}`);
        }

        const done = gameHeader(new ContainerBuilder().setAccentColor(outcomeColor(result.net)), header, p.member.id)
            .addTextDisplayComponents(text(track(race[race.length - 1], pick, winner)))
            .addSeparatorComponents(sep())
            .addTextDisplayComponents(text(resultLines(result.net, result.balance, xp_name,
                won ? `🏆 **Horse ${winner + 1} wins — ×${p.multiplier}!**` : `😢 **Horse ${winner + 1} won the race.**`)));
        await interaction.editReply({ components: [done] }).catch(() => {});
    }
} satisfies Command;
