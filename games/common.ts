import { ActionRowBuilder, ApplicationCommandOptionData, ApplicationCommandOptionType, ButtonBuilder, ButtonInteraction, ButtonStyle, ChatInputCommandInteraction, Client, ContainerBuilder, GuildMember, InteractionEditReplyOptions, MessageComponentInteraction, MessageFlags, ModalSubmitInteraction, SendableChannels } from "discord.js";
import { randomBytes, randomInt } from "node:crypto";
import { createLevelingTable } from "../schema/levelingDB.js";
import { logActivity } from "../leveling/activity.js";
import { applyXp, getMember } from "../leveling/members.js";
import { GameKey, GameSettings, getSettings } from "../leveling/settings.js";
import { COLOR, fmt, sep, signed, text } from "../leveling/ui.js";
import { afterLevelChange, profileOf } from "../leveling/xp.js";


const db = createLevelingTable();

export const GAME_NAMES: Record<GameKey, string> = {
    oddeven: "Odd-Even",
    dice: "Dice",
    baskin: "Baskin Robbins 31",
    roulette: "Russian Roulette",
    indianpoker: "Indian Poker",
    tictactoe: "Tic-Tac-Toe",
    scratch: "Scratch Lottery",
    slot: "Slot Machine",
    wheel: "Spin Wheel",
    minesweeper: "Minesweeper",
    highlow: "High-Low",
    blackjack: "Blackjack",
    tower: "Tower",
    horserace: "Horse Race",
    bomb: "Bomb Defusal"
};

export const BET_OPTION: ApplicationCommandOptionData = {
    name: "bet",
    description: "How much to bet: a number, 'all', 'half', '25%' or '2k'",
    type: ApplicationCommandOptionType.String,
    required: true,
    max_length: 20
};

export const OPPONENT_OPTION: ApplicationCommandOptionData = {
    name: "opponent",
    description: "Challenge someone specific (leave empty to let anyone accept)",
    type: ApplicationCommandOptionType.User,
    required: false
};

export function rng(max: number): number {
    return randomInt(max);
}

// True with probability p, from the crypto RNG like every other roll here.
export function chance(p: number): boolean {
    return randomInt(1_000_000) < p * 1_000_000;
}

export function shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
}

export function newId(): string {
    return randomBytes(5).toString("base64url");
}

// "100", "1,000", "2k", "1.5m", "all", "half", "25%".
export function parseBet(input: string, balance: number): number | null {
    const raw = input.trim().toLowerCase().replace(/[,_\s]/g, "");
    if (raw === "all" || raw === "max" || raw === "allin") return balance;
    if (raw === "half") return Math.floor(balance / 2);

    const pct = raw.match(/^(\d+(?:\.\d+)?)%$/);
    if (pct) return Math.floor(balance * Math.min(100, Number(pct[1])) / 100);

    const num = raw.match(/^(\d+(?:\.\d+)?)([km]?)$/);
    if (!num) return null;
    const mult = num[2] === "k" ? 1_000 : num[2] === "m" ? 1_000_000 : 1;
    const value = Math.floor(Number(num[1]) * mult);
    return Number.isFinite(value) ? value : null;
}

// ---- cooldowns -----------------------------------------------------------------

const cooldowns = new Map<string, number>();

export function cooldownLeft(guild_id: string, user_id: string, key: GameKey): number {
    const until = cooldowns.get(`${guild_id}|${user_id}|${key}`) ?? 0;
    return Math.max(0, until - Date.now());
}

export function startCooldown(guild_id: string, user_id: string, key: GameKey, seconds: number): void {
    if (seconds <= 0) return;
    cooldowns.set(`${guild_id}|${user_id}|${key}`, Date.now() + seconds * 1000);
}

setInterval(() => {
    const now = Date.now();
    for (const [k, until] of cooldowns) if (until <= now) cooldowns.delete(k);
}, 5 * 60 * 1000).unref();


// ---- preflight -------------------------------------------------------------------

export interface Ready {
    member: GuildMember;
    gs: GameSettings;
    bet: number;
    balance: number;
    xp_name: string;
    channel: SendableChannels | null;
}

async function deny(interaction: ChatInputCommandInteraction | MessageComponentInteraction, message: string): Promise<null> {
    const payload = { content: message, flags: MessageFlags.Ephemeral as const };
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
    return null;
}

// Everything a game has to check before taking a bet. Replies with the reason
// and returns null when the game can't start. `stake_multiple` is how many
// bets the player must be able to cover (Indian Poker needs 3×).
export async function preflight(
    interaction: ChatInputCommandInteraction | ButtonInteraction,
    key: GameKey,
    bet_input: string | null,
    stake_multiple = 1
): Promise<Ready | null> {
    if (!interaction.inCachedGuild()) return deny(interaction, "Games only work inside a server.");

    const settings = getSettings(interaction.guildId);
    const gs = settings.gamble.games[key];
    const xp_name = settings.server.xp_name;

    if (!settings.gamble.enabled || !gs.enabled) return deny(interaction, `**${GAME_NAMES[key]}** is turned off on this server.`);

    const allowed = settings.gamble.channels;
    if (allowed.length) {
        const ch = interaction.channel;
        const ids = [interaction.channelId, ch && "parentId" in ch ? ch.parentId : null].filter(Boolean) as string[];
        if (!ids.some(id => allowed.includes(id))) {
            return deny(interaction, `Games can only be played in ${allowed.map(id => `<#${id}>`).join(", ")}.`);
        }
    }

    const wait = cooldownLeft(interaction.guildId, interaction.user.id, key);
    if (wait > 0) return deny(interaction, `⏳ Slow down! You can play **${GAME_NAMES[key]}** again in **${(wait / 1000).toFixed(1)}s**.`);

    const member = interaction.member;
    const balance = getMember(interaction.guildId, member.id).xp;
    let bet = 0;

    if (bet_input !== null) {
        const parsed = parseBet(bet_input, balance);
        if (parsed === null) return deny(interaction, `I couldn't read **${bet_input}** as a bet. Try a number like \`100\`, \`all\`, \`half\` or \`25%\`.`);
        bet = parsed;
        if (bet <= 0) return deny(interaction, `You need to bet at least **1 ${xp_name}**. You have **${fmt(balance)}**.`);
        if (gs.min_bet > 0 && bet < gs.min_bet) return deny(interaction, `The minimum bet for **${GAME_NAMES[key]}** is **${fmt(gs.min_bet)} ${xp_name}**.`);
        if (gs.max_bet > 0 && bet > gs.max_bet) return deny(interaction, `The maximum bet for **${GAME_NAMES[key]}** is **${fmt(gs.max_bet)} ${xp_name}**.`);
        if (bet * stake_multiple > balance) {
            return deny(interaction, stake_multiple > 1
                ? `You need **${fmt(bet * stake_multiple)} ${xp_name}** (${stake_multiple}× the bet) to play, but you have **${fmt(balance)}**.`
                : `You don't have enough ${xp_name}. You have **${fmt(balance)}**.`);
        }
    }

    const channel = interaction.channel?.isSendable() ? interaction.channel : null;
    return { member, gs, bet, balance, xp_name, channel };
}


// ---- money -----------------------------------------------------------------------

// Every stake in play is also written to game_escrow, in the same transaction
// that moves the XP. Games themselves live in memory, so without this a crash
// or a restart for an update would swallow the bets of every game running at
// that moment. recoverStakes() gives them back on the next start.
function hold(guild_id: string, user_id: string, delta: number): void {
    if (delta === 0) return;
    db.run(
        `INSERT INTO game_escrow (guild_id, user_id, amount, updated_at) VALUES (?, ?, MAX(0, ?), ?)
         ON CONFLICT(guild_id, user_id) DO UPDATE SET amount = MAX(0, amount + ?), updated_at = excluded.updated_at`,
        guild_id, user_id, delta, Date.now(), delta
    );
    if (delta < 0) db.run(`DELETE FROM game_escrow WHERE guild_id = ? AND user_id = ? AND amount <= 0`, guild_id, user_id);
}

// Takes the stake now so it can't be spent twice while the game runs. Side
// effects (level-down roles, logs) wait for settle(), so a bet that is won
// straight back never flickers anyone's roles.
export function lockBet(member: GuildMember, amount: number): number {
    return db.transaction(() => {
        const r = applyXp(member.guild.id, member.id, -amount, profileOf(member));
        hold(member.guild.id, member.id, -r.applied);
        return r.old_level;
    });
}

export interface Settled {
    net: number;
    balance: number;
}

// Pays out (payout may be 0) and records the result. Synchronous so the game
// can show the final balance immediately; level-up messages and role changes
// run in the background.
export function settle(
    member: GuildMember,
    key: GameKey,
    bet: number,
    payout: number,
    level_before: number,
    channel: SendableChannels | null,
    detail = ""
): Settled {
    const net = payout - bet;
    const outcome = net > 0 ? "Victory" : net < 0 ? "Defeat" : "Push";

    const r = db.transaction(() => {
        const r = applyXp(member.guild.id, member.id, payout, profileOf(member));
        hold(member.guild.id, member.id, -bet);
        db.run(
            `INSERT INTO gamble_log (guild_id, user_id, game, bet, payout, net, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            member.guild.id, member.id, key, bet, payout, net, detail, Date.now()
        );
        logActivity({
            guild_id: member.guild.id,
            type: "games",
            user_id: member.id,
            user_name: member.displayName,
            text: `${GAME_NAMES[key]} ${outcome} · ${signed(net)}`,
            amount: net
        });
        return r;
    });

    afterLevelChange(member, level_before, r.level, r.xp, { channel }).catch(err => console.error("Post-game level change failed:", err));
    return { net, balance: r.xp };
}

// Hands a locked stake back untouched (cancelled lobby, expired challenge).
export function refund(member: GuildMember, amount: number, level_before: number): void {
    const r = db.transaction(() => {
        const r = applyXp(member.guild.id, member.id, amount, profileOf(member));
        hold(member.guild.id, member.id, -amount);
        return r;
    });
    if (r.level !== level_before) {
        afterLevelChange(member, level_before, r.level, r.xp).catch(() => {});
    }
}

interface Recovered {
    guild_id: string;
    user_id: string;
    old_level: number;
    level: number;
    xp: number;
}

let recovered: Recovered[] = [];

// Runs once at start-up, before the bot logs in, so no game of this process
// can be holding a stake yet: anything still in escrow belonged to a game
// that was cut off when the previous process stopped. Returns what went back.
export function recoverStakes(): number {
    const rows = db.all<{ guild_id: string; user_id: string; amount: number }[]>(
        `SELECT guild_id, user_id, amount FROM game_escrow WHERE amount > 0`
    );
    let total = 0;
    for (const row of rows) {
        db.transaction(() => {
            const r = applyXp(row.guild_id, row.user_id, row.amount);
            db.run(`DELETE FROM game_escrow WHERE guild_id = ? AND user_id = ?`, row.guild_id, row.user_id);
            logActivity({
                guild_id: row.guild_id,
                type: "games",
                user_id: row.user_id,
                user_name: getMember(row.guild_id, row.user_id).name,
                text: `Bet refunded · +${fmt(row.amount)} (game cut off by a bot restart)`,
                amount: row.amount
            });
            if (r.level !== r.old_level) recovered.push({ guild_id: row.guild_id, user_id: row.user_id, old_level: r.old_level, level: r.level, xp: r.xp });
        });
        total += row.amount;
    }
    if (rows.length) console.log(`Refunded ${fmt(total)} XP of bets from ${rows.length} game player(s) cut off by the last shutdown.`);
    return rows.length;
}

// Level roles of refunded players can only be fixed once Discord is
// connected, so this runs from the ready handler.
export async function resyncRecoveredRoles(client: Client): Promise<void> {
    const todo = recovered;
    recovered = [];
    for (const r of todo) {
        const member = client.guilds.cache.get(r.guild_id)?.members.cache.get(r.user_id);
        if (member) await afterLevelChange(member, r.old_level, r.level, r.xp, { quiet: true }).catch(() => {});
    }
}

// PvP: the fee comes out of the winnings, i.e. the other players' stakes, and
// never out of the winner's own stake.
export function potAfterFee(pot: number, own_stake: number, fee_pct: number): { payout: number; fee: number } {
    const fee = Math.floor(Math.max(0, pot - own_stake) * fee_pct / 100);
    return { payout: pot - fee, fee };
}


// ---- UI helpers ------------------------------------------------------------------

export function resultLines(net: number, balance: number, xp_name: string, headline: string): string {
    const label = net > 0 ? "💰 Profit" : net < 0 ? "💸 Lost" : "🤝 Returned";
    return [
        headline,
        `${label}: **${signed(net)} ${xp_name}**`,
        `👛 Remaining: **${fmt(balance)} ${xp_name}**`
    ].join("\n");
}

export function outcomeColor(net: number): number {
    return net > 0 ? COLOR.win : net < 0 ? COLOR.lose : COLOR.push;
}

export function gameHeader(container: ContainerBuilder, title: string, user_id: string, sub?: string): ContainerBuilder {
    container.addTextDisplayComponents(text(`### ${title}\n<@${user_id}>${sub ? ` · ${sub}` : ""}`));
    container.addSeparatorComponents(sep());
    return container;
}

export function button(id: string, label: string, style: ButtonStyle = ButtonStyle.Secondary, emoji?: string, disabled = false): ButtonBuilder {
    const b = new ButtonBuilder().setCustomId(id).setStyle(style).setDisabled(disabled);
    if (label) b.setLabel(label);
    if (emoji) b.setEmoji(emoji);
    return b;
}

export function row(...buttons: ButtonBuilder[]): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
}

export const V2 = MessageFlags.IsComponentsV2;

// Pause between animation frames. Keep frames about a second apart: every
// frame is a message edit, and faster edits run into Discord's rate limit.
export function wait(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
}

export async function notYours(interaction: ButtonInteraction | ModalSubmitInteraction, what = "game"): Promise<void> {
    await interaction.reply({ content: `This isn't your ${what}. Start your own!`, flags: MessageFlags.Ephemeral }).catch(() => {});
}

export async function gameOver(interaction: ButtonInteraction | ModalSubmitInteraction): Promise<void> {
    await interaction.reply({ content: "This game has already ended.", flags: MessageFlags.Ephemeral }).catch(() => {});
}


// ---- live game store -------------------------------------------------------------

type Editable = ChatInputCommandInteraction | MessageComponentInteraction | ModalSubmitInteraction;

export interface LiveGame {
    id: string;
    // Latest interaction on the message; its token (valid 15 minutes) is how
    // the game edits itself when it times out with nobody clicking.
    last: Editable;
}

// Games live in memory. An idle game times out and its onExpire decides what
// happens to the stake (usually cash out or forfeit, depending on the game).
export class GameStore<T extends LiveGame> {
    private games = new Map<string, { game: T; timer: NodeJS.Timeout }>();

    constructor(private readonly idle_ms: number, private readonly onExpire: (game: T) => Promise<void> | void) {}

    add(game: T): void {
        this.games.set(game.id, { game, timer: this.arm(game) });
    }

    get(id: string): T | undefined {
        return this.games.get(id)?.game;
    }

    touch(game: T, last?: Editable): void {
        const entry = this.games.get(game.id);
        if (!entry) return;
        if (last) game.last = last;
        clearTimeout(entry.timer);
        entry.timer = this.arm(game);
    }

    end(id: string): void {
        const entry = this.games.get(id);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.games.delete(id);
    }

    find(pred: (game: T) => boolean): T | undefined {
        for (const { game } of this.games.values()) if (pred(game)) return game;
        return undefined;
    }

    private arm(game: T): NodeJS.Timeout {
        return setTimeout(() => {
            this.games.delete(game.id);
            Promise.resolve(this.onExpire(game)).catch(err => console.error("Game expiry failed:", err));
        }, this.idle_ms);
    }
}

export async function editGame(game: LiveGame, payload: InteractionEditReplyOptions): Promise<void> {
    await game.last.editReply(payload).catch(() => {});
}

export function routeId(custom_id: string): { id: string; action: string; arg: string } {
    const [, id = "", action = "", arg = ""] = custom_id.split(":");
    return { id, action, arg };
}

export function gambleHistory(guild_id: string, user_id: string, limit = 10) {
    const recent = db.all<{ game: GameKey; bet: number; net: number; created_at: number }[]>(
        `SELECT game, bet, net, created_at FROM gamble_log WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?`,
        guild_id, user_id, limit
    );
    const totals = db.get<{ games: number; wins: number; losses: number; net: number; wagered: number }>(
        `SELECT COUNT(*) AS games,
                SUM(CASE WHEN net > 0 THEN 1 ELSE 0 END) AS wins,
                SUM(CASE WHEN net < 0 THEN 1 ELSE 0 END) AS losses,
                COALESCE(SUM(net), 0) AS net,
                COALESCE(SUM(bet), 0) AS wagered
         FROM gamble_log WHERE guild_id = ? AND user_id = ?`,
        guild_id, user_id
    ) ?? { games: 0, wins: 0, losses: 0, net: 0, wagered: 0 };
    return { recent, totals };
}
