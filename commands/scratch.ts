import { ButtonInteraction, ButtonStyle, ContainerBuilder, GuildMember, SendableChannels } from "discord.js";
import { Command } from "../types/Command.js";
import { BET_OPTION, GameStore, LiveGame, V2, button, chance, editGame, gameHeader, gameOver, lockBet, newId, notYours, outcomeColor, preflight, resultLines, rng, routeId, row, settle, startCooldown } from "../games/common.js";
import { getSettings } from "../leveling/settings.js";
import { COLOR, sep, text } from "../leveling/ui.js";

// Three covered buttons, scratched one at a time. All three symbols matching
// pays the multiplier (×2 by default); the win rate is 47%. A ticket left
// unscratched for 5 minutes expires and the bet is lost.
export const SCRATCH_WIN_CHANCE = 0.47;
const SYMBOLS = ["💎", "🍀", "⭐", "🍒", "🔔", "💰"];
const EXPIRES_MS = 5 * 60_000;

interface Ticket extends LiveGame {
    member: GuildMember;
    bet: number;
    level_before: number;
    channel: SendableChannels | null;
    multiplier: number;
    cells: string[];
    revealed: boolean[];
    win: boolean;
    expired: boolean;
    ends_at: number;
}

function draw(win: boolean): string[] {
    if (win) {
        const s = SYMBOLS[rng(SYMBOLS.length)];
        return [s, s, s];
    }
    let cells: string[];
    do {
        cells = [0, 1, 2].map(() => SYMBOLS[rng(SYMBOLS.length)]);
    } while (cells[0] === cells[1] && cells[1] === cells[2]);
    return cells;
}

function view(t: Ticket, finished: { net: number; balance: number } | null): ContainerBuilder {
    const xp_name = getSettings(t.member.guild.id).server.xp_name;
    const title = !finished ? "🎫 Scratch Lottery" : t.expired ? "🎫 Scratch Lottery — Expired" : t.win ? "🎫 Scratch Lottery — Winner! 🎉" : "🎫 Scratch Lottery — No luck";
    const container = gameHeader(
        new ContainerBuilder().setAccentColor(finished ? outcomeColor(finished.net) : COLOR.gold),
        title,
        t.member.id,
        finished ? undefined : `Scratch all 3 — three of a kind wins ×${t.multiplier}`
    );

    container.addActionRowComponents(row(...[0, 1, 2].map(i => {
        const shown = t.revealed[i] || (finished !== null && !t.expired);
        return button(`scratch:${t.id}:cell:${i}`, "", shown && t.win ? ButtonStyle.Success : ButtonStyle.Secondary, shown ? t.cells[i] : "❔", shown || finished !== null);
    })));

    if (finished) {
        container.addSeparatorComponents(sep());
        container.addTextDisplayComponents(text(resultLines(finished.net, finished.balance, xp_name,
            t.expired ? `⌛ **Not scratched within 5 minutes — the bet is lost.**`
                : t.win ? `🎯 **Three ${t.cells[0]} — ×${t.multiplier} Winner!**` : `❌ **No three of a kind**`)));
    } else {
        container.addTextDisplayComponents(text(`-# Expires <t:${Math.floor(t.ends_at / 1000)}:R>`));
    }
    return container;
}

const tickets = new GameStore<Ticket>(EXPIRES_MS, async t => {
    t.expired = true;
    const result = settle(t.member, "scratch", t.bet, 0, t.level_before, t.channel, "expired");
    await editGame(t, { components: [view(t, result)] });
});

export default {
    name: "scratch",
    description: "Scratch 3 buttons — win if all symbols match",
    options: [BET_OPTION],
    async execute(interaction) {
        const ready = await preflight(interaction, "scratch", interaction.options.getString("bet", true));
        if (!ready) return;
        const { member, gs, bet, channel } = ready;

        startCooldown(member.guild.id, member.id, "scratch", gs.cooldown);
        const win = chance(SCRATCH_WIN_CHANCE);
        const t: Ticket = {
            id: newId(),
            last: interaction,
            member,
            bet,
            level_before: lockBet(member, bet),
            channel,
            multiplier: gs.multiplier,
            cells: draw(win),
            revealed: [false, false, false],
            win,
            expired: false,
            ends_at: Date.now() + EXPIRES_MS
        };
        tickets.add(t);
        await interaction.reply({ components: [view(t, null)], flags: V2, allowedMentions: { parse: [] } });
    },
    async buttonHandler(interaction: ButtonInteraction) {
        const { id, arg } = routeId(interaction.customId);
        const t = tickets.get(id);
        if (!t) return gameOver(interaction);
        if (interaction.user.id !== t.member.id) return notYours(interaction, "ticket");

        t.revealed[Number(arg)] = true;
        if (t.revealed.every(Boolean)) {
            tickets.end(t.id);
            const payout = t.win ? Math.floor(t.bet * t.multiplier) : 0;
            const result = settle(t.member, "scratch", t.bet, payout, t.level_before, t.channel, t.cells.join(""));
            await interaction.update({ components: [view(t, result)] });
            return;
        }
        // Scratching doesn't reset the 5 minutes; the ticket just updates.
        t.last = interaction;
        await interaction.update({ components: [view(t, null)] });
    }
} satisfies Command;
