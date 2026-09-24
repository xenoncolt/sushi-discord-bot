import { ButtonInteraction, ButtonStyle, ContainerBuilder, GuildMember, MessageFlags, SendableChannels } from "discord.js";
import { Command } from "../types/Command.js";
import { BET_OPTION, GameStore, LiveGame, OPPONENT_OPTION, button, editGame, gameOver, outcomeColor, potAfterFee, preflight, rng, routeId, row, settle, shuffle } from "../games/common.js";
import { challengeButton, createChallenge } from "../games/pvp.js";
import { getSettings } from "../leveling/settings.js";
import { COLOR, fmt, sep, signed, text } from "../leveling/ui.js";

// Each player gets one card (1-10, two of each). You can see your
// opponent's card ("See opponent") but never your own. Both start at the bet;
// each player may raise once by one bet, so a pot tops out at 6× the bet,
// which is why joining needs 3× the bet. Higher card wins; if both cards are
// the same number, the cards are redrawn. Folding loses only what you staked.

interface Player {
    member: GuildMember;
    level: number;
    card: number;
    stake: number;
    raised: boolean;
}

interface Table extends LiveGame {
    players: [Player, Player];
    bet: number;
    escrow: number;       // 3× bet, taken from each player up front
    deck: number[];
    channel: SendableChannels | null;
    turn: 0 | 1;
    checked: boolean;     // the previous player checked
    log: string[];
    result: string | null;
}

const CARD = ["", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

function view(t: Table, footer?: string): ContainerBuilder {
    const xp_name = getSettings(t.players[0].member.guild.id).server.xp_name;
    const [a, b] = t.players;
    const pot = a.stake + b.stake;
    const done = t.result !== null;
    const me = t.players[t.turn];
    const other = t.players[t.turn === 0 ? 1 : 0];

    const container = new ContainerBuilder()
        .setAccentColor(done ? outcomeColor(1) : COLOR.gold)
        .addTextDisplayComponents(text([
            `### 🃏 Indian Poker`,
            `<@${a.member.id}> ${done ? CARD[a.card] : "🂠"} · stake **${fmt(a.stake)}**`,
            `<@${b.member.id}> ${done ? CARD[b.card] : "🂠"} · stake **${fmt(b.stake)}**`,
            `💰 Pot: **${fmt(pot)} ${xp_name}**`,
            ...t.log.slice(-4).map(l => `-# ${l}`),
            done ? t.result! : `▶️ <@${me.member.id}>'s move · <t:${Math.floor((Date.now() + 60_000) / 1000)}:R>`
        ].join("\n")));

    if (!done) {
        const behind = me.stake < other.stake;
        const can_raise = !me.raised && other.stake + t.bet <= t.escrow;
        container.addActionRowComponents(row(
            button(`indianpoker:${t.id}:peek`, "See opponent", ButtonStyle.Secondary, "👀"),
            button(`indianpoker:${t.id}:call`, behind ? `Call ${fmt(other.stake - me.stake)}` : "Check", ButtonStyle.Success, "✅"),
            button(`indianpoker:${t.id}:raise`, `Raise ${fmt(t.bet)}`, ButtonStyle.Primary, "⬆️", !can_raise),
            button(`indianpoker:${t.id}:fold`, "Fold", ButtonStyle.Danger, "🏳️")
        ));
    }
    if (footer) {
        container.addSeparatorComponents(sep());
        container.addTextDisplayComponents(text(footer));
    }
    return container;
}

// Everyone gets back what they didn't stake; the winner also takes the pot
// minus the fee, and on a tie both stakes come home.
function finish(t: Table, winner: 0 | 1 | null, why: string): string {
    const settings = getSettings(t.players[0].member.guild.id);
    const xp_name = settings.server.xp_name;
    const pot = t.players[0].stake + t.players[1].stake;
    const { payout, fee } = potAfterFee(pot, winner === null ? pot : t.players[winner].stake, settings.gamble.games.indianpoker.fee);

    const lines = t.players.map((p, i) => {
        const unused = t.escrow - p.stake;
        const won = winner === null ? p.stake : winner === i ? payout : 0;
        const r = settle(p.member, "indianpoker", t.escrow, unused + won, p.level, t.channel, `${p.card} vs ${t.players[i === 0 ? 1 : 0].card} ${why}`);
        return `${winner === i ? "🏆" : winner === null ? "🤝" : "💸"} <@${p.member.id}> **${signed(r.net)} ${xp_name}** (balance ${fmt(r.balance)})`;
    });

    t.result = winner === null
        ? `🤝 Both held **${t.players[0].card}** — the pot is split.`
        : `🏆 <@${t.players[winner].member.id}> wins${why === "fold" ? " — the other player folded" : why === "timeout" ? " — the other player ran out of time" : ` with a **${t.players[winner].card}**`}!`;
    if (fee && winner !== null) lines.push(`-# House fee: ${fmt(fee)} ${xp_name}`);
    return lines.join("\n");
}

const fresh_deck = () => shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

function showdown(t: Table): string {
    const [a, b] = t.players;
    while (a.card === b.card) {
        t.log.push(`Both held ${a.card} — cards redrawn`);
        if (t.deck.length < 2) t.deck = fresh_deck();
        a.card = t.deck.pop()!;
        b.card = t.deck.pop()!;
    }
    return finish(t, a.card > b.card ? 0 : 1, "showdown");
}

const tables = new GameStore<Table>(60_000, async t => {
    const footer = finish(t, t.turn === 0 ? 1 : 0, "timeout");
    await editGame(t, { components: [view(t, footer)] });
});

export default {
    name: "indianpoker",
    description: "Indian Poker: see your opponent's card, not your own — bluff, raise or fold",
    options: [BET_OPTION, OPPONENT_OPTION],
    async execute(interaction) {
        const ready = await preflight(interaction, "indianpoker", interaction.options.getString("bet", true), 3);
        if (!ready) return;
        await createChallenge(interaction, ready, "indianpoker", "indianpoker", [
            `🃏 You see their card, never yours. One raise each, the pot tops out at ${fmt(ready.bet * 6)}.`,
            `-# Both players need 3× the bet (${fmt(ready.bet * 3)}) to play; the unused part is returned.`
        ], 3);
    },
    async buttonHandler(interaction: ButtonInteraction) {
        const { id, action } = routeId(interaction.customId);

        if (action === "accept" || action === "decline") {
            const match = await challengeButton(interaction, id, action);
            if (!match) return;
            const { c, opponent, host_level, opp_level } = match;
            const deck = fresh_deck();
            const t: Table = {
                id: c.id,
                last: interaction,
                players: [
                    { member: c.host, level: host_level, card: deck.pop()!, stake: c.bet, raised: false },
                    { member: opponent, level: opp_level, card: deck.pop()!, stake: c.bet, raised: false }
                ],
                bet: c.bet,
                escrow: c.stake,
                deck,
                channel: c.channel,
                turn: rng(2) as 0 | 1,
                checked: false,
                log: [],
                result: null
            };
            tables.add(t);
            await interaction.update({ components: [view(t)], allowedMentions: { users: [t.players[t.turn].member.id] } });
            return;
        }

        const t = tables.get(id);
        if (!t) return gameOver(interaction);
        const seat = t.players.findIndex(p => p.member.id === interaction.user.id);
        if (seat < 0) {
            await interaction.reply({ content: "You're not at this table.", flags: MessageFlags.Ephemeral });
            return;
        }

        if (action === "peek") {
            const other = t.players[seat === 0 ? 1 : 0];
            await interaction.reply({ content: `<@${other.member.id}> is holding **${CARD[other.card]} (${other.card})**. Your own card stays a mystery…`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
            return;
        }
        if (seat !== t.turn) {
            await interaction.reply({ content: "Wait for your turn!", flags: MessageFlags.Ephemeral });
            return;
        }

        const me = t.players[seat];
        const other = t.players[seat === 0 ? 1 : 0];
        const name = me.member.displayName;
        let footer: string | undefined;

        if (action === "fold") {
            t.log.push(`${name} folded`);
            tables.end(t.id);
            footer = finish(t, seat === 0 ? 1 : 0, "fold");
        } else if (action === "raise") {
            if (me.raised || other.stake + t.bet > t.escrow) {
                await interaction.deferUpdate();
                return;
            }
            me.stake = other.stake + t.bet;
            me.raised = true;
            t.checked = false;
            t.log.push(`${name} raised to ${fmt(me.stake)}`);
        } else if (action === "call") {
            if (me.stake < other.stake) {
                t.log.push(`${name} called ${fmt(other.stake)}`);
                me.stake = other.stake;
                tables.end(t.id);
                footer = showdown(t);
            } else if (t.checked) {
                t.log.push(`${name} checked`);
                tables.end(t.id);
                footer = showdown(t);
            } else {
                t.log.push(`${name} checked`);
                t.checked = true;
            }
        }

        if (!footer) {
            t.turn = t.turn === 0 ? 1 : 0;
            tables.touch(t, interaction);
        }
        await interaction.update({ components: [view(t, footer)] });
    }
} satisfies Command;
