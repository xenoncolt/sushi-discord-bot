import { ButtonInteraction, ButtonStyle, ContainerBuilder, GuildMember, MessageFlags, SendableChannels } from "discord.js";
import { Command } from "../types/Command.js";
import { BET_OPTION, GameStore, LiveGame, Settled, V2, button, editGame, gameHeader, gameOver, lockBet, newId, notYours, outcomeColor, preflight, resultLines, routeId, row, settle, shuffle, startCooldown, wait } from "../games/common.js";
import { getMember } from "../leveling/members.js";
import { getSettings } from "../leveling/settings.js";
import { COLOR, fmt, sep, text } from "../leveling/ui.js";

// One player against the dealer from a fresh 52-card deck. Win pays the
// multiplier (×2), push returns the bet, and a natural 21 on the first two
// cards pays a 1.5× bonus on the winnings (×2.5 at the default).

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["♠", "♥", "♦", "♣"];

type Card = { rank: string; suit: string };

interface Hand extends LiveGame {
    member: GuildMember;
    bet: number;
    level_before: number;
    channel: SendableChannels | null;
    multiplier: number;
    deck: Card[];
    player: Card[];
    dealer: Card[];
    doubled: boolean;
    outcome: "blackjack" | "win" | "push" | "lose" | "bust" | null;
}

function newDeck(): Card[] {
    return shuffle(SUITS.flatMap(suit => RANKS.map(rank => ({ rank, suit }))));
}

export function total(cards: Card[]): { value: number; soft: boolean } {
    let value = 0;
    let aces = 0;
    for (const c of cards) {
        if (c.rank === "A") {
            aces++;
            value += 11;
        } else {
            value += ["J", "Q", "K"].includes(c.rank) ? 10 : Number(c.rank);
        }
    }
    while (value > 21 && aces > 0) {
        value -= 10;
        aces--;
    }
    return { value, soft: aces > 0 };
}

function isBlackjack(cards: Card[]): boolean {
    return cards.length === 2 && total(cards).value === 21;
}

function show(cards: Card[]): string {
    return cards.map(c => `\`${c.rank}${c.suit}\``).join(" ");
}

function payoutFor(h: Hand): number {
    switch (h.outcome) {
        case "blackjack": return Math.floor(h.bet * (1 + (h.multiplier - 1) * 1.5));
        case "win": return Math.floor(h.bet * h.multiplier);
        case "push": return h.bet;
        default: return 0;
    }
}

// `dealing` is a frame of the dealer's turn: how many dealer cards are face up.
function view(h: Hand, finished: { net: number; balance: number } | null, dealing?: number): ContainerBuilder {
    const xp_name = getSettings(h.member.guild.id).server.xp_name;
    const titles: Record<string, string> = {
        blackjack: "🃏 Blackjack — BLACKJACK! 🎉",
        win: "🃏 Blackjack — You win! 🎉",
        push: "🃏 Blackjack — Push",
        lose: "🃏 Blackjack — Dealer wins",
        bust: "🃏 Blackjack — Bust!"
    };
    const container = gameHeader(
        new ContainerBuilder().setAccentColor(finished ? outcomeColor(finished.net) : COLOR.gold),
        finished ? titles[h.outcome!] : dealing ? "🃏 Blackjack — Dealer's turn..." : "🃏 Blackjack",
        h.member.id,
        `Bet ${fmt(h.bet)} ${xp_name}${h.doubled ? " (doubled)" : ""}`
    );

    const p = total(h.player);
    const dealer_cards = finished ? h.dealer : dealing ? h.dealer.slice(0, dealing) : null;
    const dealer_line = dealer_cards
        ? `**Dealer** · ${total(dealer_cards).value}\n${show(dealer_cards)}`
        : `**Dealer** · ${total([h.dealer[0]]).value}+\n${show([h.dealer[0]])} \`❔\``;
    container.addTextDisplayComponents(text(`${dealer_line}\n\n**You** · ${p.value}${p.soft && p.value < 21 ? " (soft)" : ""}\n${show(h.player)}`));

    if (finished) {
        const head = {
            blackjack: `🎯 **Natural 21 — ×${(1 + (h.multiplier - 1) * 1.5).toFixed(2)}!**`,
            win: `🎯 **You beat the dealer — ×${h.multiplier}**`,
            push: `🤝 **Push — bet returned**`,
            lose: `❌ **Dealer had the better hand**`,
            bust: `💥 **Over 21**`
        }[h.outcome!];
        container.addSeparatorComponents(sep());
        container.addTextDisplayComponents(text(resultLines(finished.net, finished.balance, xp_name, head)));
    } else if (!dealing) {
        const can_double = h.player.length === 2 && !h.doubled && getMember(h.member.guild.id, h.member.id).xp >= h.bet;
        container.addActionRowComponents(row(
            button(`blackjack:${h.id}:hit`, "Hit", ButtonStyle.Success, "➕"),
            button(`blackjack:${h.id}:stand`, "Stand", ButtonStyle.Danger, "✋"),
            button(`blackjack:${h.id}:double`, "Double Down", ButtonStyle.Primary, "💰", !can_double)
        ));
    }
    return container;
}

// Dealer draws to 17 and stands on every 17, soft ones included.
function dealerPlays(h: Hand): void {
    while (total(h.dealer).value < 17) h.dealer.push(h.deck.pop()!);
    const d = total(h.dealer).value;
    const p = total(h.player).value;
    h.outcome = d > 21 || p > d ? "win" : p === d ? "push" : "lose";
}

function finish(h: Hand) {
    return settle(h.member, "blackjack", h.bet, payoutFor(h), h.level_before, h.channel,
        `${total(h.player).value} vs ${total(h.dealer).value}${h.doubled ? " doubled" : ""}`);
}

const hands = new GameStore<Hand>(120_000, async h => {
    // Walked away: they stand on what they have.
    dealerPlays(h);
    const result = finish(h);
    await editGame(h, { components: [view(h, result)] });
});

export default {
    name: "blackjack",
    description: "Play blackjack against the dealer",
    options: [BET_OPTION],
    async execute(interaction) {
        const ready = await preflight(interaction, "blackjack", interaction.options.getString("bet", true));
        if (!ready) return;
        const { member, gs, bet, channel } = ready;

        startCooldown(member.guild.id, member.id, "blackjack", gs.cooldown);
        const deck = newDeck();
        const h: Hand = {
            id: newId(),
            last: interaction,
            member,
            bet,
            level_before: lockBet(member, bet),
            channel,
            multiplier: gs.multiplier,
            deck,
            player: [deck.pop()!, deck.pop()!],
            dealer: [deck.pop()!, deck.pop()!],
            doubled: false,
            outcome: null
        };

        const pbj = isBlackjack(h.player);
        const dbj = isBlackjack(h.dealer);
        if (pbj || dbj) {
            h.outcome = pbj && dbj ? "push" : pbj ? "blackjack" : "lose";
            await interaction.reply({ components: [view(h, finish(h))], flags: V2, allowedMentions: { parse: [] } });
            return;
        }

        hands.add(h);
        await interaction.reply({ components: [view(h, null)], flags: V2, allowedMentions: { parse: [] } });
    },
    async buttonHandler(interaction: ButtonInteraction) {
        const { id, action } = routeId(interaction.customId);
        const h = hands.get(id);
        if (!h) return gameOver(interaction);
        if (interaction.user.id !== h.member.id) return notYours(interaction);

        if (action === "double") {
            if (h.player.length !== 2 || h.doubled) {
                await interaction.deferUpdate();
                return;
            }
            if (getMember(h.member.guild.id, h.member.id).xp < h.bet) {
                await interaction.reply({ content: "You don't have enough to double down.", flags: MessageFlags.Ephemeral });
                return;
            }
            lockBet(h.member, h.bet);
            h.bet *= 2;
            h.doubled = true;
            h.player.push(h.deck.pop()!);
            if (total(h.player).value > 21) h.outcome = "bust";
            else dealerPlays(h);
        } else if (action === "hit") {
            h.player.push(h.deck.pop()!);
            const v = total(h.player).value;
            if (v > 21) h.outcome = "bust";
            else if (v === 21) dealerPlays(h);
        } else if (action === "stand") {
            dealerPlays(h);
        }

        if (h.outcome) {
            hands.end(h.id);
            if (h.outcome === "bust") {
                await interaction.update({ components: [view(h, finish(h))] });
                return;
            }
            // The dealer played: flip the hole card, then show each draw on
            // its own frame. Settled after the last card so a level-up message
            // can't spoil the hand (see slot.ts).
            let result: Settled;
            try {
                for (let shown = 2; shown <= h.dealer.length; shown++) {
                    if (shown === 2) await interaction.update({ components: [view(h, null, shown)] });
                    else await interaction.editReply({ components: [view(h, null, shown)] }).catch(() => {});
                    await wait(shown === h.dealer.length ? 1500 : 1200);
                }
            } finally {
                result = finish(h);
            }
            await interaction.editReply({ components: [view(h, result)] }).catch(() => {});
            return;
        }
        hands.touch(h, interaction);
        await interaction.update({ components: [view(h, null)] });
    }
} satisfies Command;
