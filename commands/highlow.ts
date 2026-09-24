import { ButtonInteraction, ButtonStyle, ContainerBuilder, GuildMember, SendableChannels } from "discord.js";
import { Command } from "../types/Command.js";
import { BET_OPTION, GameStore, LiveGame, V2, button, editGame, gameHeader, gameOver, lockBet, newId, notYours, outcomeColor, preflight, resultLines, rng, routeId, row, settle, startCooldown } from "../games/common.js";
import { getSettings } from "../leveling/settings.js";
import { COLOR, fmt, sep, text } from "../leveling/ui.js";

// A card from A to K is shown; guess whether the next is higher or lower.
// The same rank is a tie and loses — that is where the house edge comes from.
//
// Each guess pays fair odds for the chance it actually had, shaved by
// `house_edge`. Calling Higher on a 2 is nearly free money so it barely moves
// the multiplier; calling Lower on a 2 is 1-in-13 and pays over ×12. That keeps
// the expected return at exactly (1 - edge) per guess no matter which card
// comes up or which button is pressed, so no card is ever worth skipping and
// there is no line of play that beats the house.
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["♠️", "♥️", "♦️", "♣️"];

// Safety net: a run this hot would distort the economy, so it force-cashes.
const MAX_MULT = 1000;

type Dir = "high" | "low";

interface Card {
    value: number;   // 1-13
    suit: string;
}

interface Round extends LiveGame {
    member: GuildMember;
    bet: number;
    level_before: number;
    channel: SendableChannels | null;
    edge: number;        // house edge as a fraction, e.g. 0.03
    max_rounds: number;
    wins: number;
    mult: number;        // running multiplier, 1 until the first correct guess
    history: Card[];
    lost: boolean;
}

function draw(): Card {
    return { value: rng(13) + 1, suit: SUITS[rng(4)] };
}

function label(c: Card): string {
    return `${RANKS[c.value - 1]}${c.suit}`;
}

// Chance the next card lands on the chosen side of `c`. Ranks are drawn
// uniformly, so the 1/13 tie belongs to neither side.
function chanceOf(c: Card, dir: Dir): number {
    return (dir === "high" ? 13 - c.value : c.value - 1) / 13;
}

// Fair odds for that chance, minus the house cut. 0 when the guess is
// impossible, in which case the button is disabled.
function stepMult(c: Card, dir: Dir, edge: number): number {
    const p = chanceOf(c, dir);
    return p <= 0 ? 0 : (1 - edge) / p;
}

function payout(r: Round): number {
    return Math.floor(r.bet * r.mult);
}

function view(r: Round, finished: { net: number; balance: number } | null): ContainerBuilder {
    const xp_name = getSettings(r.member.guild.id).server.xp_name;
    const current = r.history[r.history.length - 1];
    const title = !finished ? "🃏 High-Low" : r.lost ? "🃏 High-Low — Busted!" : "🃏 High-Low — Cashed out! 💰";
    const container = gameHeader(new ContainerBuilder().setAccentColor(finished ? outcomeColor(finished.net) : COLOR.gold), title, r.member.id);

    const up = stepMult(current, "high", r.edge);
    const down = stepMult(current, "low", r.edge);
    const trail = r.history.slice(-8).map(label).join(" → ");
    const lines = [
        `# ${label(current)}`,
        `-# ${trail}`,
        r.lost
            ? `🔥 Streak: **${r.wins}** / ${r.max_rounds} · Lost at **×${r.mult.toFixed(2)}**`
            : `🔥 Streak: **${r.wins}** / ${r.max_rounds} · Current **×${r.mult.toFixed(2)}** (${fmt(payout(r))} ${xp_name})`
    ];
    if (!finished) {
        // Payouts live on the buttons; this line is just the odds behind them.
        const odds = [
            up > 0 ? `Higher (${Math.round(chanceOf(current, "high") * 100)}%)` : "",
            down > 0 ? `Lower (${Math.round(chanceOf(current, "low") * 100)}%)` : ""
        ].filter(Boolean).join(" · ");
        lines.push(`-# Chance: ${odds} · Same number loses`);
    }
    container.addTextDisplayComponents(text(lines.join("\n")));

    if (finished) {
        container.addSeparatorComponents(sep());
        container.addTextDisplayComponents(text(resultLines(finished.net, finished.balance, xp_name,
            r.lost ? `❌ **Streak ended at ${r.wins}.**` : `🎯 **${r.wins} correct — ×${r.mult.toFixed(2)}**`)));
    } else {
        container.addActionRowComponents(row(
            button(`highlow:${r.id}:high`, up > 0 ? `Higher ×${up.toFixed(2)}` : "Higher", ButtonStyle.Success, "⬆️", up <= 0),
            button(`highlow:${r.id}:low`, down > 0 ? `Lower ×${down.toFixed(2)}` : "Lower", ButtonStyle.Danger, "⬇️", down <= 0),
            button(`highlow:${r.id}:cash`, `Cash out ${fmt(payout(r))}`, ButtonStyle.Primary, "💰")
        ));
    }
    return container;
}

function cashOut(r: Round) {
    return settle(r.member, "highlow", r.bet, payout(r), r.level_before, r.channel, `${r.wins} wins ×${r.mult.toFixed(2)}`);
}

const rounds = new GameStore<Round>(120_000, async r => {
    const result = cashOut(r);
    await editGame(r, { components: [view(r, result)] });
});

export default {
    name: "highlow",
    description: "Guess if the next card is higher or lower — cash out any time",
    options: [BET_OPTION],
    async execute(interaction) {
        const ready = await preflight(interaction, "highlow", interaction.options.getString("bet", true));
        if (!ready) return;
        const { member, gs, bet, channel } = ready;

        startCooldown(member.guild.id, member.id, "highlow", gs.cooldown);
        const r: Round = {
            id: newId(),
            last: interaction,
            member,
            bet,
            level_before: lockBet(member, bet),
            channel,
            edge: gs.house_edge / 100,
            max_rounds: gs.max_rounds,
            wins: 0,
            mult: 1,
            history: [draw()],
            lost: false
        };
        rounds.add(r);
        await interaction.reply({ components: [view(r, null)], flags: V2, allowedMentions: { parse: [] } });
    },
    async buttonHandler(interaction: ButtonInteraction) {
        const { id, action } = routeId(interaction.customId);
        const r = rounds.get(id);
        if (!r) return gameOver(interaction);
        if (interaction.user.id !== r.member.id) return notYours(interaction);

        if (action === "cash") {
            rounds.end(r.id);
            await interaction.update({ components: [view(r, cashOut(r))] });
            return;
        }

        const dir: Dir = action === "high" ? "high" : "low";
        const before = r.history[r.history.length - 1];
        const step = stepMult(before, dir, r.edge);
        if (step <= 0) return gameOver(interaction);   // impossible guess, button was disabled

        const next = draw();
        r.history.push(next);
        const right = dir === "high" ? next.value > before.value : next.value < before.value;

        if (!right) {
            r.lost = true;
            rounds.end(r.id);
            const result = settle(r.member, "highlow", r.bet, 0, r.level_before, r.channel, `lost at ${r.wins}`);
            await interaction.update({ components: [view(r, result)] });
            return;
        }

        r.wins++;
        r.mult *= step;
        if (r.wins >= r.max_rounds || r.mult >= MAX_MULT) {
            rounds.end(r.id);
            await interaction.update({ components: [view(r, cashOut(r))] });
            return;
        }
        rounds.touch(r, interaction);
        await interaction.update({ components: [view(r, null)] });
    }
} satisfies Command;
