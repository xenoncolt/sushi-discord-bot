import { ButtonInteraction, ButtonStyle, ChatInputCommandInteraction, ContainerBuilder, GuildMember, MessageFlags, SendableChannels } from "discord.js";
import { getMember } from "../leveling/members.js";
import { GameKey, getSettings } from "../leveling/settings.js";
import { COLOR, fmt, text } from "../leveling/ui.js";
import { GAME_NAMES, GameStore, LiveGame, Ready, V2, button, editGame, lockBet, newId, refund, row, startCooldown } from "./common.js";


async function ephemeral(interaction: ButtonInteraction, content: string): Promise<null> {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    return null;
}

function xpName(guild_id: string): string {
    return getSettings(guild_id).server.xp_name;
}


// ---- 1v1 challenges ------------------------------------------------------------

export interface Challenge extends LiveGame {
    key: GameKey;
    cmd: string;
    host: GuildMember;
    target_id: string | null;
    bet: number;
    stake: number;          // what each side must put up (Indian Poker: 3× bet)
    lines: string[];
    data: Record<string, string>;   // game-specific choices made at challenge time
    channel: SendableChannels | null;
}

export function challengeView(c: Challenge, status?: string): ContainerBuilder {
    const xp_name = xpName(c.host.guild.id);
    const container = new ContainerBuilder()
        .setAccentColor(status ? COLOR.push : COLOR.pending)
        .addTextDisplayComponents(text([
            `### ⚔️ ${GAME_NAMES[c.key]} Challenge`,
            `<@${c.host.id}> challenges ${c.target_id ? `<@${c.target_id}>` : "**anyone**"}!`,
            `💰 Bet: **${fmt(c.bet)} ${xp_name}** each`,
            ...c.lines
        ].join("\n")));

    if (status) {
        container.addTextDisplayComponents(text(status));
    } else {
        container.addActionRowComponents(row(
            button(`${c.cmd}:${c.id}:accept`, "Accept", ButtonStyle.Success, "✅"),
            button(`${c.cmd}:${c.id}:decline`, c.target_id ? "Decline" : "Cancel", ButtonStyle.Danger, "✖️")
        ));
    }
    return container;
}

export const challenges = new GameStore<Challenge>(90_000, async c => {
    await editGame(c, { components: [challengeView(c, "⌛ Nobody accepted in time. No bets were taken.")] });
});

export async function createChallenge(interaction: ChatInputCommandInteraction, ready: Ready, key: GameKey, cmd: string, lines: string[], stake_multiple = 1, data: Record<string, string> = {}): Promise<void> {
    const target = interaction.options.getUser("opponent");
    if (target?.bot) {
        await interaction.reply({ content: "Bots don't gamble. Pick a person!", flags: MessageFlags.Ephemeral });
        return;
    }
    if (target?.id === interaction.user.id) {
        await interaction.reply({ content: "You can't challenge yourself.", flags: MessageFlags.Ephemeral });
        return;
    }

    const c: Challenge = {
        id: newId(),
        last: interaction,
        key,
        cmd,
        host: ready.member,
        target_id: target?.id ?? null,
        bet: ready.bet,
        stake: ready.bet * stake_multiple,
        lines,
        data,
        channel: ready.channel
    };
    challenges.add(c);
    startCooldown(ready.member.guild.id, ready.member.id, key, ready.gs.cooldown);

    await interaction.reply({
        components: [challengeView(c)],
        flags: V2,
        allowedMentions: { users: c.target_id ? [c.target_id] : [] }
    });
}

export interface Accepted {
    c: Challenge;
    opponent: GuildMember;
    host_level: number;
    opp_level: number;
}

// Both stakes are taken the moment the challenge is accepted.
export async function acceptChallenge(interaction: ButtonInteraction, c: Challenge): Promise<Accepted | null> {
    if (!interaction.inCachedGuild()) return null;
    if (interaction.user.id === c.host.id) return ephemeral(interaction, "You can't accept your own challenge.");
    if (c.target_id && interaction.user.id !== c.target_id) return ephemeral(interaction, `This challenge is for <@${c.target_id}>.`);

    const opponent = interaction.member;
    const xp_name = xpName(c.host.guild.id);
    const opp_balance = getMember(c.host.guild.id, opponent.id).xp;
    if (opp_balance < c.stake) {
        return ephemeral(interaction, `You need **${fmt(c.stake)} ${xp_name}** to accept, but you have **${fmt(opp_balance)}**.`);
    }

    const host_balance = getMember(c.host.guild.id, c.host.id).xp;
    if (host_balance < c.stake) {
        challenges.end(c.id);
        await interaction.update({ components: [challengeView(c, `❌ <@${c.host.id}> no longer has enough ${xp_name} for this bet.`)] });
        return null;
    }

    challenges.end(c.id);
    const host_level = lockBet(c.host, c.stake);
    const opp_level = lockBet(opponent, c.stake);
    return { c, opponent, host_level, opp_level };
}

export async function declineChallenge(interaction: ButtonInteraction, c: Challenge): Promise<void> {
    const by_host = interaction.user.id === c.host.id;
    const by_target = c.target_id !== null && interaction.user.id === c.target_id;
    if (!by_host && !by_target) {
        await ephemeral(interaction, "Only the players in this challenge can do that.");
        return;
    }
    challenges.end(c.id);
    await interaction.update({ components: [challengeView(c, by_host ? "🚫 Challenge cancelled." : `🙅 <@${interaction.user.id}> declined.`)] });
}

// Shared entry point for challenge buttons. Returns the accepted match, or
// null when the click was handled here (decline, errors, wrong person).
export async function challengeButton(interaction: ButtonInteraction, id: string, action: string): Promise<Accepted | null> {
    const c = challenges.get(id);
    if (!c) {
        await ephemeral(interaction, "This challenge is no longer open.");
        return null;
    }
    if (action === "decline") {
        await declineChallenge(interaction, c);
        return null;
    }
    if (action === "accept") return acceptChallenge(interaction, c);
    return null;
}


// ---- lobbies (2-6 players) ---------------------------------------------------------

export interface LobbyPlayer {
    member: GuildMember;
    level_before: number;
}

export interface Lobby extends LiveGame {
    key: GameKey;
    cmd: string;
    host_id: string;
    bet: number;
    players: LobbyPlayer[];
    min: number;
    max: number;
    rules: string[];
    channel: SendableChannels | null;
}

export function lobbyView(l: Lobby, status?: string): ContainerBuilder {
    const xp_name = xpName(l.players[0]?.member.guild.id ?? "");
    const container = new ContainerBuilder()
        .setAccentColor(status ? COLOR.push : COLOR.pending)
        .addTextDisplayComponents(text([
            `### 🎲 ${GAME_NAMES[l.key]} Lobby`,
            `💰 Entry: **${fmt(l.bet)} ${xp_name}** · 👥 ${l.players.length}/${l.max} players`,
            l.players.map((p, i) => `${i === 0 ? "👑" : "•"} <@${p.member.id}>`).join("\n"),
            "",
            ...l.rules.map(r => `-# ${r}`)
        ].join("\n")));

    if (status) {
        container.addTextDisplayComponents(text(status));
    } else {
        container.addActionRowComponents(row(
            button(`${l.cmd}:${l.id}:join`, "Join", ButtonStyle.Success, "➕", l.players.length >= l.max),
            button(`${l.cmd}:${l.id}:leave`, "Leave", ButtonStyle.Secondary, "➖"),
            button(`${l.cmd}:${l.id}:start`, `Start (${l.players.length}/${l.min}+)`, ButtonStyle.Primary, "▶️", l.players.length < l.min),
            button(`${l.cmd}:${l.id}:cancel`, "Cancel", ButtonStyle.Danger, "✖️")
        ));
    }
    return container;
}

function refundAll(l: Lobby): void {
    for (const p of l.players) refund(p.member, l.bet, p.level_before);
}

export const lobbies = new GameStore<Lobby>(180_000, async l => {
    refundAll(l);
    await editGame(l, { components: [lobbyView(l, "⌛ The lobby expired before it started. Entries were refunded.")] });
});

export async function createLobby(interaction: ChatInputCommandInteraction, ready: Ready, key: GameKey, cmd: string, rules: string[], min: number, max: number): Promise<void> {
    const level_before = lockBet(ready.member, ready.bet);
    const l: Lobby = {
        id: newId(),
        last: interaction,
        key,
        cmd,
        host_id: ready.member.id,
        bet: ready.bet,
        players: [{ member: ready.member, level_before }],
        min,
        max,
        rules,
        channel: ready.channel
    };
    lobbies.add(l);
    startCooldown(ready.member.guild.id, ready.member.id, key, ready.gs.cooldown);
    await interaction.reply({ components: [lobbyView(l)], flags: V2, allowedMentions: { parse: [] } });
}

// Handles join/leave/cancel itself. Returns the lobby when the host pressed a
// valid Start, so the caller can run the game.
export async function lobbyButton(interaction: ButtonInteraction, id: string, action: string): Promise<Lobby | null> {
    if (!interaction.inCachedGuild()) return null;
    const l = lobbies.get(id);
    if (!l) return ephemeral(interaction, "This lobby is closed.");

    const user_id = interaction.user.id;
    const xp_name = xpName(interaction.guildId);
    const seat = l.players.findIndex(p => p.member.id === user_id);

    switch (action) {
        case "join": {
            if (seat >= 0) return ephemeral(interaction, "You're already in this lobby.");
            if (l.players.length >= l.max) return ephemeral(interaction, "The lobby is full.");
            const balance = getMember(interaction.guildId, user_id).xp;
            if (balance < l.bet) return ephemeral(interaction, `You need **${fmt(l.bet)} ${xp_name}** to join, but you have **${fmt(balance)}**.`);
            const level_before = lockBet(interaction.member, l.bet);
            l.players.push({ member: interaction.member, level_before });
            lobbies.touch(l, interaction);
            await interaction.update({ components: [lobbyView(l)] });
            return null;
        }
        case "leave": {
            if (seat < 0) return ephemeral(interaction, "You're not in this lobby.");
            if (user_id === l.host_id) {
                lobbies.end(l.id);
                refundAll(l);
                await interaction.update({ components: [lobbyView(l, "🚫 The host left, so the lobby closed. Entries were refunded.")] });
                return null;
            }
            const [p] = l.players.splice(seat, 1);
            refund(p.member, l.bet, p.level_before);
            lobbies.touch(l, interaction);
            await interaction.update({ components: [lobbyView(l)] });
            return null;
        }
        case "cancel": {
            if (user_id !== l.host_id) return ephemeral(interaction, "Only the host can cancel the lobby.");
            lobbies.end(l.id);
            refundAll(l);
            await interaction.update({ components: [lobbyView(l, "🚫 Cancelled by the host. Entries were refunded.")] });
            return null;
        }
        case "start": {
            if (user_id !== l.host_id) return ephemeral(interaction, "Only the host can start the game.");
            if (l.players.length < l.min) return ephemeral(interaction, `You need at least ${l.min} players.`);
            lobbies.end(l.id);
            l.last = interaction;
            return l;
        }
    }
    return null;
}
