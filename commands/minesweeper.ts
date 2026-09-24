import { ButtonInteraction, ButtonStyle, ContainerBuilder, GuildMember, SendableChannels } from "discord.js";
import { Command } from "../types/Command.js";
import { BET_OPTION, GameStore, LiveGame, V2, button, editGame, gameHeader, gameOver, lockBet, newId, notYours, outcomeColor, preflight, resultLines, routeId, row, settle, shuffle, startCooldown } from "../games/common.js";
import { getSettings } from "../leveling/settings.js";
import { COLOR, fmt, sep, text } from "../leveling/ui.js";

// 20 cells in a 4×5 grid. Each safe reveal adds `per_step` to the multiplier
// (1 + 0.2 × reveals at the default), and you can cash out between clicks.
const CELLS = 20;
const COLS = 5;

interface Board extends LiveGame {
    member: GuildMember;
    bet: number;
    level_before: number;
    channel: SendableChannels | null;
    mines: Set<number>;
    revealed: Set<number>;
    per_step: number;
    boom: number | null;
}

export function survival(mines: number, reveals: number): number {
    let p = 1;
    for (let i = 0; i < reveals; i++) p *= (CELLS - mines - i) / (CELLS - i);
    return p;
}

function multiplier(b: Board): number {
    return 1 + b.per_step * b.revealed.size;
}

function view(b: Board, finished: { net: number; balance: number } | null): ContainerBuilder {
    const xp_name = getSettings(b.member.guild.id).server.xp_name;
    const mult = multiplier(b);
    const title = !finished ? "💣 Minesweeper" : b.boom !== null ? "💣 Minesweeper — BOOM!" : "💣 Minesweeper — Cashed out! 💰";
    const container = gameHeader(new ContainerBuilder().setAccentColor(finished ? outcomeColor(finished.net) : COLOR.gold), title, b.member.id);

    if (!finished) {
        const next = b.per_step * (b.revealed.size + 1) + 1;
        const safe_left = CELLS - b.mines.size - b.revealed.size;
        const odds = safe_left / (CELLS - b.revealed.size);
        container.addTextDisplayComponents(text([
            `💣 **${b.mines.size}** mines · 💎 **${b.revealed.size}** revealed`,
            `Current: **×${mult.toFixed(2)}** (${fmt(Math.floor(b.bet * mult))} ${xp_name}) · Next: ×${next.toFixed(2)} at ${Math.round(odds * 100)}% safe`
        ].join("\n")));
    }

    for (let r = 0; r < CELLS / COLS; r++) {
        container.addActionRowComponents(row(...Array.from({ length: COLS }, (_, c) => {
            const i = r * COLS + c;
            if (b.revealed.has(i)) return button(`minesweeper:${b.id}:cell:${i}`, "", ButtonStyle.Success, "💎", true);
            if (finished && b.mines.has(i)) return button(`minesweeper:${b.id}:cell:${i}`, "", i === b.boom ? ButtonStyle.Danger : ButtonStyle.Secondary, "💣", true);
            return button(`minesweeper:${b.id}:cell:${i}`, "", ButtonStyle.Secondary, finished ? "▫️" : "⬛", finished !== null);
        })));
    }

    if (finished) {
        container.addSeparatorComponents(sep());
        container.addTextDisplayComponents(text(resultLines(finished.net, finished.balance, xp_name,
            b.boom !== null ? `💥 **Stepped on a mine after ${b.revealed.size} reveal(s).**` : `🎯 **${b.revealed.size} safe reveal(s) — ×${mult.toFixed(2)}**`)));
    } else {
        container.addActionRowComponents(row(
            button(`minesweeper:${b.id}:cash`, `Cash out ${fmt(Math.floor(b.bet * mult))}`, ButtonStyle.Primary, "💰")
        ));
    }
    return container;
}

function cashOut(b: Board) {
    return settle(b.member, "minesweeper", b.bet, Math.floor(b.bet * multiplier(b)), b.level_before, b.channel, `${b.revealed.size} reveals`);
}

const boards = new GameStore<Board>(120_000, async b => {
    const result = cashOut(b);
    await editGame(b, { components: [view(b, result)] });
});

export default {
    name: "minesweeper",
    description: "Reveal safe cells to grow your multiplier — cash out before you hit a mine",
    options: [BET_OPTION],
    async execute(interaction) {
        const ready = await preflight(interaction, "minesweeper", interaction.options.getString("bet", true));
        if (!ready) return;
        const { member, gs, bet, channel } = ready;

        startCooldown(member.guild.id, member.id, "minesweeper", gs.cooldown);
        const mines = new Set(shuffle(Array.from({ length: CELLS }, (_, i) => i)).slice(0, Math.min(CELLS - 1, gs.mines)));
        const b: Board = {
            id: newId(),
            last: interaction,
            member,
            bet,
            level_before: lockBet(member, bet),
            channel,
            mines,
            revealed: new Set(),
            per_step: gs.per_step,
            boom: null
        };
        boards.add(b);
        await interaction.reply({ components: [view(b, null)], flags: V2, allowedMentions: { parse: [] } });
    },
    async buttonHandler(interaction: ButtonInteraction) {
        const { id, action, arg } = routeId(interaction.customId);
        const b = boards.get(id);
        if (!b) return gameOver(interaction);
        if (interaction.user.id !== b.member.id) return notYours(interaction);

        if (action === "cash") {
            boards.end(b.id);
            await interaction.update({ components: [view(b, cashOut(b))] });
            return;
        }

        const cell = Number(arg);
        if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS || b.revealed.has(cell)) {
            await interaction.deferUpdate();
            return;
        }

        if (b.mines.has(cell)) {
            b.boom = cell;
            boards.end(b.id);
            const result = settle(b.member, "minesweeper", b.bet, 0, b.level_before, b.channel, `mine after ${b.revealed.size}`);
            await interaction.update({ components: [view(b, result)] });
            return;
        }

        b.revealed.add(cell);
        if (b.revealed.size >= CELLS - b.mines.size) {
            boards.end(b.id);
            await interaction.update({ components: [view(b, cashOut(b))] });
            return;
        }
        boards.touch(b, interaction);
        await interaction.update({ components: [view(b, null)] });
    }
} satisfies Command;
