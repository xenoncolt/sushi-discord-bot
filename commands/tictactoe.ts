import { ButtonInteraction, ButtonStyle, ContainerBuilder, GuildMember, MessageFlags, SendableChannels } from "discord.js";
import { Command } from "../types/Command.js";
import { BET_OPTION, GameStore, LiveGame, OPPONENT_OPTION, button, editGame, gameOver, outcomeColor, potAfterFee, preflight, rng, routeId, row, settle } from "../games/common.js";
import { challengeButton, createChallenge } from "../games/pvp.js";
import { getSettings } from "../leveling/settings.js";
import { COLOR, fmt, sep, signed, text } from "../leveling/ui.js";

// 3×3, three in a row wins the pot (minus fee). A full board is a draw and
// both bets come back. Taking longer than a minute on your turn forfeits.

const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

interface Seat {
    member: GuildMember;
    level: number;
}

interface Match extends LiveGame {
    seats: [Seat, Seat];   // seats[0] plays ❌ and moves first
    stake: number;
    channel: SendableChannels | null;
    board: (0 | 1 | null)[];
    turn: 0 | 1;
    result: string | null;
}

function winnerOf(board: (0 | 1 | null)[]): { mark: 0 | 1; line: number[] } | null {
    for (const line of LINES) {
        const [a, b, c] = line;
        if (board[a] !== null && board[a] === board[b] && board[a] === board[c]) return { mark: board[a]!, line };
    }
    return null;
}

function view(m: Match, footer?: string): ContainerBuilder {
    const win = winnerOf(m.board);
    const container = new ContainerBuilder()
        .setAccentColor(m.result ? outcomeColor(win ? 1 : 0) : COLOR.gold)
        .addTextDisplayComponents(text([
            `### ⭕❌ Tic-Tac-Toe`,
            `❌ <@${m.seats[0].member.id}> vs ⭕ <@${m.seats[1].member.id}>`,
            m.result ?? `${m.turn === 0 ? "❌" : "⭕"} <@${m.seats[m.turn].member.id}>'s turn · <t:${Math.floor((Date.now() + 60_000) / 1000)}:R>`
        ].join("\n")));

    for (let r = 0; r < 3; r++) {
        container.addActionRowComponents(row(...[0, 1, 2].map(c => {
            const i = r * 3 + c;
            const mark = m.board[i];
            const lit = win?.line.includes(i);
            return button(
                `tictactoe:${m.id}:cell:${i}`,
                "",
                lit ? ButtonStyle.Success : mark === 0 ? ButtonStyle.Danger : mark === 1 ? ButtonStyle.Primary : ButtonStyle.Secondary,
                mark === 0 ? "✖️" : mark === 1 ? "⭕" : "▫️",
                mark !== null || m.result !== null
            );
        })));
    }

    if (footer) {
        container.addSeparatorComponents(sep());
        container.addTextDisplayComponents(text(footer));
    }
    return container;
}

function payWinner(m: Match, winner: 0 | 1, why: string): string {
    const settings = getSettings(m.seats[0].member.guild.id);
    const xp_name = settings.server.xp_name;
    const { payout, fee } = potAfterFee(m.stake * 2, m.stake, settings.gamble.games.tictactoe.fee);
    const w = m.seats[winner];
    const l = m.seats[winner === 0 ? 1 : 0];
    const ws = settle(w.member, "tictactoe", m.stake, payout, w.level, m.channel, why);
    const ls = settle(l.member, "tictactoe", m.stake, 0, l.level, m.channel, why);
    m.result = `🏆 <@${w.member.id}> wins${why === "timeout" ? " — the other player ran out of time" : ""}!`;
    return [
        `🏆 <@${w.member.id}> **${signed(ws.net)} ${xp_name}** (balance ${fmt(ws.balance)})`,
        `💸 <@${l.member.id}> **-${fmt(m.stake)} ${xp_name}** (balance ${fmt(ls.balance)})`,
        fee ? `-# House fee: ${fmt(fee)} ${xp_name}` : ""
    ].filter(Boolean).join("\n");
}

const matches = new GameStore<Match>(60_000, async m => {
    const footer = payWinner(m, m.turn === 0 ? 1 : 0, "timeout");
    await editGame(m, { components: [view(m, footer)] });
});

export default {
    name: "tictactoe",
    description: "Play tic-tac-toe against another member for a bet",
    options: [BET_OPTION, OPPONENT_OPTION],
    async execute(interaction) {
        const ready = await preflight(interaction, "tictactoe", interaction.options.getString("bet", true));
        if (!ready) return;
        await createChallenge(interaction, ready, "tictactoe", "tictactoe", ["⭕❌ Three in a row wins the pot. First move is random."]);
    },
    async buttonHandler(interaction: ButtonInteraction) {
        const { id, action, arg } = routeId(interaction.customId);

        if (action === "accept" || action === "decline") {
            const match = await challengeButton(interaction, id, action);
            if (!match) return;
            const { c, opponent, host_level, opp_level } = match;
            const host: Seat = { member: c.host, level: host_level };
            const opp: Seat = { member: opponent, level: opp_level };
            const m: Match = {
                id: c.id,
                last: interaction,
                seats: rng(2) === 0 ? [host, opp] : [opp, host],
                stake: c.stake,
                channel: c.channel,
                board: new Array(9).fill(null),
                turn: 0,
                result: null
            };
            matches.add(m);
            await interaction.update({ components: [view(m)], allowedMentions: { users: [m.seats[0].member.id] } });
            return;
        }

        const m = matches.get(id);
        if (!m) return gameOver(interaction);
        const seat = m.seats.findIndex(s => s.member.id === interaction.user.id);
        if (seat < 0) {
            await interaction.reply({ content: "You're not playing in this match.", flags: MessageFlags.Ephemeral });
            return;
        }
        if (seat !== m.turn) {
            await interaction.reply({ content: "Wait for your turn!", flags: MessageFlags.Ephemeral });
            return;
        }

        const cell = Number(arg);
        if (m.board[cell] !== null) {
            await interaction.deferUpdate();
            return;
        }
        m.board[cell] = m.turn;

        if (winnerOf(m.board)) {
            matches.end(m.id);
            const footer = payWinner(m, m.turn, "three in a row");
            await interaction.update({ components: [view(m, footer)] });
            return;
        }

        if (m.board.every(c => c !== null)) {
            matches.end(m.id);
            for (const s of m.seats) settle(s.member, "tictactoe", m.stake, m.stake, s.level, m.channel, "draw");
            m.result = "🤝 It's a draw! Both bets were returned.";
            await interaction.update({ components: [view(m)] });
            return;
        }

        m.turn = m.turn === 0 ? 1 : 0;
        matches.touch(m, interaction);
        await interaction.update({ components: [view(m)] });
    }
} satisfies Command;
