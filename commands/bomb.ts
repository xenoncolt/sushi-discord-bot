import { ButtonInteraction, ButtonStyle, ContainerBuilder, GuildMember, LabelBuilder, MessageFlags, ModalBuilder, ModalSubmitInteraction, SendableChannels, TextInputBuilder, TextInputStyle } from "discord.js";
import { Command } from "../types/Command.js";
import { BET_OPTION, GameStore, LiveGame, Settled, V2, button, editGame, gameHeader, gameOver, lockBet, newId, notYours, outcomeColor, preflight, resultLines, routeId, row, settle, shuffle, startCooldown } from "../games/common.js";
import { getSettings } from "../leveling/settings.js";
import { COLOR, fmt, sep, text } from "../leveling/ui.js";

// Guess the 3-digit code (all digits different, never starting with 0). Each guess scores
// S = right digit, right place · B = right digit, wrong place · O = none.
// The faster the bomb is defused, the more it pays: ×first_try on the first
// guess and try_drop less for every guess after that. Running out of
// attempts, giving up or walking away loses the bet.
//
// Someone who always guesses a code that fits every clue so far defuses in
// about 5 tries. At the defaults (×3, −0.5 per try, 6 attempts) that returns
// ~93% on average, and even a solver program only gets ~104%, because nobody
// can reliably do better than 4-5 tries. The Gamble page shows both numbers.

interface Bomb extends LiveGame {
    member: GuildMember;
    bet: number;
    level_before: number;
    channel: SendableChannels | null;
    code: string;
    attempts: number;
    first_try: number;
    try_drop: number;
    guesses: { guess: string; s: number; b: number }[];
    state: "live" | "defused" | "exploded" | "gave_up" | "timed_out";
    result: Settled | null;
}

export function score(code: string, guess: string): { s: number; b: number } {
    let s = 0, b = 0;
    for (let i = 0; i < 3; i++) {
        if (guess[i] === code[i]) s++;
        else if (code.includes(guess[i])) b++;
    }
    return { s, b };
}

// Payout multiplier for defusing on guess number `tries`.
export function payoutFor(first_try: number, try_drop: number, tries: number): number {
    return Math.max(0, Math.round((first_try - try_drop * (tries - 1)) * 1000) / 1000);
}

function x(mult: number): string {
    return `×${Math.round(mult * 100) / 100}`;
}

// Three different digits, the first never 0.
function newCode(): string {
    let digits: string[];
    do {
        digits = shuffle(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]).slice(0, 3);
    } while (digits[0] === "0");
    return digits.join("");
}

function mult(bomb: Bomb, tries: number): number {
    return payoutFor(bomb.first_try, bomb.try_drop, tries);
}

function view(bomb: Bomb): ContainerBuilder {
    const xp_name = getSettings(bomb.member.guild.id).server.xp_name;
    const live = bomb.state === "live";
    const left = bomb.attempts - bomb.guesses.length;
    const next = bomb.guesses.length + 1;
    const title = {
        live: "💣 Bomb Defusal",
        defused: "💣 Bomb Defusal — Defused! 🎉",
        exploded: "💥 Bomb Defusal — BOOM!",
        gave_up: "💥 Bomb Defusal — Gave up",
        timed_out: "💥 Bomb Defusal — Walked away"
    }[bomb.state];
    const color = bomb.result ? outcomeColor(bomb.result.net) : COLOR.gold;
    const container = gameHeader(new ContainerBuilder().setAccentColor(color), title, bomb.member.id, `bet ${fmt(bomb.bet)} ${xp_name}`);

    const log = bomb.guesses.length
        ? bomb.guesses.map((g, i) => `\`${i + 1}.\` **${g.guess}** → ${g.s === 0 && g.b === 0 ? "**O** (out)" : `**${g.s}S ${g.b}B**`}`).join("\n")
        : "*No guesses yet.*";
    container.addTextDisplayComponents(text([
        ...(live
            ? [
                `⏱️ **${left}** attempt(s) left · 3 different digits, the first isn't 0`,
                `💰 Defuse on this try: **${x(mult(bomb, next))}** → **${fmt(Math.floor(bomb.bet * mult(bomb, next)))} ${xp_name}**`
            ]
            : [`🔑 The code was **${bomb.code}**`]),
        "",
        log
    ].join("\n")));

    if (live) {
        const ladder = Array.from({ length: bomb.attempts }, (_, i) => {
            const step = `${i + 1}: ${x(mult(bomb, i + 1))}`;
            return i + 1 === next ? `**${step}**` : step;
        }).join(" · ");
        container.addSeparatorComponents(sep());
        container.addTextDisplayComponents(text([
            `-# Payout by try · ${ladder}`,
            "-# S = right digit & place · B = right digit, wrong place · O = none of the digits"
        ].join("\n")));
        container.addActionRowComponents(row(
            button(`bomb:${bomb.id}:guess`, "Enter code", ButtonStyle.Danger, "✂️"),
            button(`bomb:${bomb.id}:quit`, "Give up (lose bet)", ButtonStyle.Secondary)
        ));
    }

    if (bomb.result) {
        const tries = bomb.guesses.length;
        const headline = {
            live: "",
            defused: `✂️ **Defused on try ${tries}: ${x(mult(bomb, tries))}**`,
            exploded: `💥 **Out of attempts. The bomb went off.**`,
            gave_up: `🏳️ **You gave up. The bomb went off.**`,
            timed_out: `⌛ **No guess for 5 minutes. The bomb went off.**`
        }[bomb.state];
        container.addSeparatorComponents(sep());
        container.addTextDisplayComponents(text(resultLines(bomb.result.net, bomb.result.balance, xp_name, headline)));
    }
    return container;
}

function finish(bomb: Bomb, state: Exclude<Bomb["state"], "live">): void {
    bomb.state = state;
    const tries = bomb.guesses.length;
    const payout = state === "defused" ? Math.floor(bomb.bet * mult(bomb, tries)) : 0;
    const detail = state === "defused" ? `defused in ${tries}` : state.replace("_", " ");
    bomb.result = settle(bomb.member, "bomb", bomb.bet, payout, bomb.level_before, bomb.channel, detail);
}

const bombs = new GameStore<Bomb>(300_000, async bomb => {
    finish(bomb, "timed_out");
    await editGame(bomb, { components: [view(bomb)] });
});

export default {
    name: "bomb",
    description: "Defuse the bomb by cracking its 3-digit code — the faster, the bigger the payout",
    options: [BET_OPTION],
    async execute(interaction) {
        const ready = await preflight(interaction, "bomb", interaction.options.getString("bet", true));
        if (!ready) return;
        const { member, gs, bet, channel } = ready;
        startCooldown(member.guild.id, member.id, "bomb", gs.cooldown);

        const bomb: Bomb = {
            id: newId(),
            last: interaction,
            member,
            bet,
            level_before: lockBet(member, bet),
            channel,
            code: newCode(),
            attempts: gs.attempts,
            first_try: gs.first_try,
            try_drop: gs.try_drop,
            guesses: [],
            state: "live",
            result: null
        };
        bombs.add(bomb);
        await interaction.reply({ components: [view(bomb)], flags: V2, allowedMentions: { parse: [] } });
    },
    async buttonHandler(interaction: ButtonInteraction) {
        const { id, action } = routeId(interaction.customId);
        const bomb = bombs.get(id);
        if (!bomb) return gameOver(interaction);
        if (interaction.user.id !== bomb.member.id) return notYours(interaction, "bomb");

        if (action === "quit") {
            bombs.end(bomb.id);
            finish(bomb, "gave_up");
            await interaction.update({ components: [view(bomb)] });
            return;
        }

        await interaction.showModal(new ModalBuilder()
            .setCustomId(`bomb:${bomb.id}:submit`)
            .setTitle("Cut the wires")
            .addLabelComponents(new LabelBuilder()
                .setLabel("3-digit code (all digits different)")
                .setTextInputComponent(new TextInputBuilder()
                    .setCustomId("code")
                    .setStyle(TextInputStyle.Short)
                    .setMinLength(3)
                    .setMaxLength(3)
                    .setPlaceholder("e.g. 427")
                    .setRequired(true))));
    },
    async modalSubmit(interaction: ModalSubmitInteraction) {
        const { id } = routeId(interaction.customId);
        const bomb = bombs.get(id);
        if (!bomb) return gameOver(interaction);
        if (interaction.user.id !== bomb.member.id) return notYours(interaction, "bomb");

        const guess = interaction.fields.getTextInputValue("code").trim();
        if (!/^\d{3}$/.test(guess) || new Set(guess).size !== 3) {
            await interaction.reply({ content: "The code is exactly 3 digits and no digit repeats, like `427`.", flags: MessageFlags.Ephemeral });
            return;
        }

        bomb.guesses.push({ guess, ...score(bomb.code, guess) });
        if (guess === bomb.code) {
            bombs.end(bomb.id);
            finish(bomb, "defused");
        } else if (bomb.guesses.length >= bomb.attempts) {
            bombs.end(bomb.id);
            finish(bomb, "exploded");
        } else {
            bombs.touch(bomb, interaction);
        }

        if (interaction.isFromMessage()) await interaction.update({ components: [view(bomb)] });
        else await editGame(bomb, { components: [view(bomb)] });
    }
} satisfies Command;
