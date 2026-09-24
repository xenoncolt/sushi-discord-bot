import { ButtonInteraction, ButtonStyle, ContainerBuilder, GuildMember, MessageFlags, SendableChannels } from "discord.js";
import { Command } from "../types/Command.js";
import { BET_OPTION, GameStore, LiveGame, OPPONENT_OPTION, button, editGame, gameOver, potAfterFee, preflight, rng, routeId, row, settle } from "../games/common.js";
import { challengeButton, createChallenge } from "../games/pvp.js";
import { getSettings } from "../leveling/settings.js";
import { COLOR, fmt, sep, signed, text } from "../leveling/ui.js";

// Baskin Robbins 31, one on one: players take turns saying the next 1, 2 or 3
// numbers. Whoever is forced to say 31 loses, and their bet goes to the other
// player (minus the fee). Sitting on your turn for 45 seconds counts as a loss.

const TARGET = 31;
const TURN_MS = 45_000;

interface Seat {
    member: GuildMember;
    level: number;
}

interface Round extends LiveGame {
    seats: [Seat, Seat];
    stake: number;
    channel: SendableChannels | null;
    count: number;
    turn: 0 | 1;
    said: string[];
    loser: 0 | 1 | null;
}

function view(r: Round, footer?: string): ContainerBuilder {
    const done = r.loser !== null;
    const current = r.seats[r.turn];
    const container = new ContainerBuilder()
        .setAccentColor(done ? COLOR.lose : COLOR.gold)
        .addTextDisplayComponents(text([
            `### 🍦 Baskin Robbins 31`,
            r.seats.map((s, i) => `${i === r.loser ? "💀" : i === r.turn && !done ? "▶️" : "•"} <@${s.member.id}>`).join("  vs  "),
            `# ${r.count} / ${TARGET}`,
            ...r.said.slice(-4).map(s => `-# ${s}`),
            done ? `💀 <@${r.seats[r.loser!].member.id}> had to say **31**!` : `▶️ <@${current.member.id}>, say the next 1-3 numbers · <t:${Math.floor((Date.now() + TURN_MS) / 1000)}:R>`
        ].join("\n")));

    if (!done) {
        container.addActionRowComponents(row(...[1, 2, 3].map(n => {
            const nums = Array.from({ length: n }, (_, i) => r.count + i + 1).filter(x => x <= TARGET);
            return button(`baskin:${r.id}:say:${n}`, nums.join(", ") || "—", n === 1 ? ButtonStyle.Success : ButtonStyle.Primary, undefined, r.count + n > TARGET);
        })));
    }
    if (footer) {
        container.addSeparatorComponents(sep());
        container.addTextDisplayComponents(text(footer));
    }
    return container;
}

function finish(r: Round, loser: 0 | 1): string {
    r.loser = loser;
    const settings = getSettings(r.seats[0].member.guild.id);
    const xp_name = settings.server.xp_name;
    const { payout, fee } = potAfterFee(r.stake * 2, r.stake, settings.gamble.games.baskin.fee);
    const win = r.seats[loser === 0 ? 1 : 0];
    const lose = r.seats[loser];
    const w = settle(win.member, "baskin", r.stake, payout, win.level, r.channel, `count ${r.count}`);
    const l = settle(lose.member, "baskin", r.stake, 0, lose.level, r.channel, `count ${r.count}`);
    return [
        `🏆 <@${win.member.id}> wins **${signed(w.net)} ${xp_name}** (balance ${fmt(w.balance)})`,
        `💸 <@${lose.member.id}> loses **${fmt(r.stake)} ${xp_name}** (balance ${fmt(l.balance)})`,
        fee ? `-# Fee: ${fmt(fee)} ${xp_name}` : ""
    ].filter(Boolean).join("\n");
}

const rounds = new GameStore<Round>(TURN_MS, async r => {
    r.said.push(`${r.seats[r.turn].member.displayName} ran out of time`);
    const footer = finish(r, r.turn);
    await editGame(r, { components: [view(r, footer)] });
});

export default {
    name: "baskin",
    description: "Baskin Robbins 31 against another member — whoever says 31 loses",
    options: [BET_OPTION, OPPONENT_OPTION],
    async execute(interaction) {
        const ready = await preflight(interaction, "baskin", interaction.options.getString("bet", true));
        if (!ready) return;
        await createChallenge(interaction, ready, "baskin", "baskin", [
            "🍦 Take turns saying the next 1-3 numbers. Whoever has to say 31 loses."
        ]);
    },
    async buttonHandler(interaction: ButtonInteraction) {
        const { id, action, arg } = routeId(interaction.customId);

        if (action === "accept" || action === "decline") {
            const match = await challengeButton(interaction, id, action);
            if (!match) return;
            const { c, opponent, host_level, opp_level } = match;
            const r: Round = {
                id: c.id,
                last: interaction,
                seats: [{ member: c.host, level: host_level }, { member: opponent, level: opp_level }],
                stake: c.stake,
                channel: c.channel,
                count: 0,
                turn: rng(2) as 0 | 1,
                said: [],
                loser: null
            };
            rounds.add(r);
            await interaction.update({ components: [view(r)], allowedMentions: { users: [r.seats[r.turn].member.id] } });
            return;
        }

        const r = rounds.get(id);
        if (!r) return gameOver(interaction);
        if (r.seats[r.turn].member.id !== interaction.user.id) {
            const playing = r.seats.some(s => s.member.id === interaction.user.id);
            await interaction.reply({ content: playing ? "Wait for your turn!" : "You're not in this game.", flags: MessageFlags.Ephemeral });
            return;
        }

        const n = Math.min(3, Math.max(1, Number(arg)));
        if (r.count + n > TARGET) {
            await interaction.deferUpdate();
            return;
        }
        const nums = Array.from({ length: n }, (_, i) => r.count + i + 1);
        r.count += n;
        r.said.push(`${r.seats[r.turn].member.displayName}: ${nums.join(", ")}`);

        if (r.count >= TARGET) {
            rounds.end(r.id);
            const footer = finish(r, r.turn);
            await interaction.update({ components: [view(r, footer)] });
            return;
        }

        r.turn = r.turn === 0 ? 1 : 0;
        rounds.touch(r, interaction);
        await interaction.update({ components: [view(r)], allowedMentions: { users: [r.seats[r.turn].member.id] } });
    }
} satisfies Command;
