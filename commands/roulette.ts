import { ButtonInteraction, ButtonStyle, ContainerBuilder, MessageFlags, SendableChannels } from "discord.js";
import { Command } from "../types/Command.js";
import { BET_OPTION, GameStore, LiveGame, button, editGame, gameOver, potAfterFee, preflight, rng, routeId, row, settle, shuffle } from "../games/common.js";
import { LobbyPlayer, createLobby, lobbyButton } from "../games/pvp.js";
import { getSettings } from "../leveling/settings.js";
import { COLOR, fmt, sep, signed, text } from "../leveling/ui.js";

// Russian Roulette: one bullet in a six-chamber revolver. Players take turns
// pulling the trigger; the chamber advances after every click, so the odds
// climb until someone is hit. After each elimination the revolver is re-spun
// and the turn order is shuffled again for the next round. The last player
// standing wins the pot (the fee comes out of the others' stakes). Sitting on
// your turn for 30 seconds pulls the trigger for you.

const CHAMBERS = 6;
const TURN_MS = 30_000;

interface Game extends LiveGame {
    players: LobbyPlayer[];
    bet: number;
    channel: SendableChannels | null;
    alive: boolean[];
    order: number[];     // this round's random turn order (seat indexes)
    pos: number;         // position in `order`
    turn: number;
    bullet: number;
    chamber: number;
    log: string[];
    winner: number | null;
    footer: string | null;
}

// A fresh round: reload, re-spin and shuffle who goes when.
function newRound(g: Game): void {
    g.bullet = rng(CHAMBERS);
    g.chamber = 0;
    g.order = shuffle(g.players.map((_, i) => i).filter(i => g.alive[i]));
    g.pos = 0;
    g.turn = g.order[0];
}

function view(g: Game): ContainerBuilder {
    const done = g.winner !== null;
    const odds = Math.round(100 / (CHAMBERS - g.chamber));
    const container = new ContainerBuilder()
        .setAccentColor(done ? COLOR.win : COLOR.lose)
        .addTextDisplayComponents(text([
            `### 🔫 Russian Roulette`,
            g.players.map((p, i) => `${!g.alive[i] ? "💀" : i === g.turn && !done ? "▶️" : "🙂"} <@${p.member.id}>`).join("  "),
            `🔄 Chamber ${g.chamber + 1}/${CHAMBERS}`,
            ...g.log.slice(-4).map(l => `-# ${l}`),
            done
                ? `🏆 <@${g.players[g.winner!].member.id}> is the last one standing!`
                : `▶️ <@${g.players[g.turn].member.id}>, pull the trigger (${odds}% chance) · <t:${Math.floor((Date.now() + TURN_MS) / 1000)}:R>`
        ].join("\n")));

    if (!done) {
        container.addActionRowComponents(row(button(`roulette:${g.id}:pull`, "Pull the trigger", ButtonStyle.Danger, "🔫")));
    }
    if (g.footer) {
        container.addSeparatorComponents(sep());
        container.addTextDisplayComponents(text(g.footer));
    }
    return container;
}

// Returns true when the game is over.
function pull(g: Game, auto: boolean): boolean {
    const shooter = g.players[g.turn];
    const name = shooter.member.displayName + (auto ? " (timed out)" : "");

    if (g.chamber === g.bullet) {
        g.alive[g.turn] = false;
        g.log.push(`💥 BANG! ${name} is out`);
        const left = g.alive.filter(Boolean).length;
        if (left === 1) {
            g.winner = g.alive.indexOf(true);
            payout(g);
            return true;
        }
        newRound(g);
        g.log.push(`🔄 Re-spun — new round, new random order`);
        return false;
    }
    g.log.push(`*click* — ${name} survives`);
    g.chamber++;
    g.pos = (g.pos + 1) % g.order.length;
    g.turn = g.order[g.pos];
    return false;
}

function payout(g: Game): void {
    const settings = getSettings(g.players[0].member.guild.id);
    const xp_name = settings.server.xp_name;
    const { payout, fee } = potAfterFee(g.bet * g.players.length, g.bet, settings.gamble.games.roulette.fee);
    const lines = g.players.map((p, i) => {
        const s = settle(p.member, "roulette", g.bet, i === g.winner ? payout : 0, p.level_before, g.channel, `${g.players.length} players`);
        return `${i === g.winner ? "🏆" : "💀"} <@${p.member.id}> **${signed(s.net)} ${xp_name}**`;
    });
    if (fee) lines.push(`-# House fee: ${fmt(fee)} ${xp_name}`);
    g.footer = lines.join("\n");
}

const games = new GameStore<Game>(TURN_MS, async g => {
    const over = pull(g, true);
    if (!over) games.add(g);
    await editGame(g, { components: [view(g)] });
});

export default {
    name: "roulette",
    description: "Russian Roulette for 2-6 players — last one standing takes the pot",
    options: [BET_OPTION],
    async execute(interaction) {
        const ready = await preflight(interaction, "roulette", interaction.options.getString("bet", true));
        if (!ready) return;
        await createLobby(interaction, ready, "roulette", "roulette", [
            "One bullet, six chambers. Take turns pulling the trigger.",
            "The revolver re-spins after each hit. Last one standing wins the pot."
        ], 2, 6);
    },
    async buttonHandler(interaction: ButtonInteraction) {
        const { id, action } = routeId(interaction.customId);

        if (action !== "pull") {
            const lobby = await lobbyButton(interaction, id, action);
            if (!lobby) return;
            const g: Game = {
                id: lobby.id,
                last: interaction,
                players: [...lobby.players],
                bet: lobby.bet,
                channel: lobby.channel,
                alive: lobby.players.map(() => true),
                order: [],
                pos: 0,
                turn: 0,
                bullet: 0,
                chamber: 0,
                log: [],
                winner: null,
                footer: null
            };
            newRound(g);
            games.add(g);
            await interaction.update({ components: [view(g)], allowedMentions: { users: [g.players[g.turn].member.id] } });
            return;
        }

        const g = games.get(id);
        if (!g) return gameOver(interaction);
        if (g.players[g.turn].member.id !== interaction.user.id) {
            const playing = g.players.some(p => p.member.id === interaction.user.id);
            await interaction.reply({ content: playing ? "It's not your turn to pull." : "You're not in this game.", flags: MessageFlags.Ephemeral });
            return;
        }

        const over = pull(g, false);
        if (over) games.end(g.id);
        else games.touch(g, interaction);
        await interaction.update({ components: [view(g)], allowedMentions: { users: over ? [] : [g.players[g.turn].member.id] } });
    }
} satisfies Command;
