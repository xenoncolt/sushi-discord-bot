import { ButtonInteraction, ButtonStyle, ChatInputCommandInteraction, ContainerBuilder, MessageFlags } from "discord.js";
import { Command } from "../types/Command.js";
import { BET_OPTION, Ready, Settled, V2, button, chance, gameHeader, lockBet, outcomeColor, preflight, resultLines, rng, row, settle, startCooldown, wait } from "../games/common.js";
import { COLOR, sep, text } from "../leveling/ui.js";

// Three reels; all three matching pays the configured multiplier. The win
// chance is fixed at 47%, so the dashboard's "Return" is 47% × multiplier
// (94% at the default ×2).
export const SLOT_WIN_CHANCE = 0.47;
const SYMBOLS = ["🍒", "🍋", "🔔", "⭐", "💎", "🍀"];

function spinReels(win: boolean): string[] {
    if (win) {
        const s = SYMBOLS[rng(SYMBOLS.length)];
        return [s, s, s];
    }
    let reels: string[];
    do {
        reels = [0, 1, 2].map(() => SYMBOLS[rng(SYMBOLS.length)]);
    } while (reels[0] === reels[1] && reels[1] === reels[2]);
    return reels;
}

// The first `stopped` reels show their final symbol in `style`; the rest are
// still spinning and show a different random symbol on every frame.
function reelRow(reels: string[], stopped: number, style: ButtonStyle) {
    return row(...reels.map((emoji, i) => i < stopped
        ? button(`slot:reel:${i}`, "", style, emoji, true)
        : button(`slot:reel:${i}`, "", ButtonStyle.Secondary, SYMBOLS[rng(SYMBOLS.length)], true)));
}

// The reels stop left to right: [reels stopped, ms before the next frame].
// The last reel is held longest.
const FRAMES: [number, number][] = [[0, 1000], [0, 1000], [1, 1300], [2, 1700]];

async function play(interaction: ChatInputCommandInteraction | ButtonInteraction, ready: Ready): Promise<void> {
    const { member, gs, bet, xp_name, channel } = ready;
    startCooldown(member.guild.id, member.id, "slot", gs.cooldown);

    const level_before = lockBet(member, bet);
    const win = chance(SLOT_WIN_CHANCE);
    const reels = spinReels(win);
    const payout = win ? Math.floor(bet * gs.multiplier) : 0;

    const spinning = (stopped: number) => gameHeader(new ContainerBuilder().setAccentColor(COLOR.gold), "🎰 Slot Machine — Spinning...", member.id)
        .addActionRowComponents(reelRow(reels, stopped, ButtonStyle.Primary));

    // Settled only once the last reel stops, so a level-up message can't give
    // the result away mid-spin. The finally makes sure a failed frame never
    // leaves the stake locked.
    let result: Settled;
    try {
        for (const [i, [stopped, ms]] of FRAMES.entries()) {
            if (i === 0) await interaction.reply({ components: [spinning(stopped)], flags: V2, allowedMentions: { parse: [] } });
            else await interaction.editReply({ components: [spinning(stopped)] }).catch(() => {});
            await wait(ms);
        }
    } finally {
        result = settle(member, "slot", bet, payout, level_before, channel, reels.join(""));
    }

    const done = gameHeader(new ContainerBuilder().setAccentColor(win ? 0xf1c40f : outcomeColor(result.net)),
        win ? "🎰 Slot Machine — Winner! 🎉" : "🎰 Slot Machine — No luck", member.id)
        .addActionRowComponents(reelRow(reels, reels.length, win ? ButtonStyle.Success : ButtonStyle.Danger))
        .addSeparatorComponents(sep())
        .addTextDisplayComponents(text(resultLines(result.net, result.balance, xp_name, win ? `🎯 **×${gs.multiplier} Winner!**` : `❌ **No match**`)))
        .addActionRowComponents(row(button(`slot:again:${member.id}:${bet}`, "Spin again", ButtonStyle.Primary, "🔁")));
    await interaction.editReply({ components: [done] }).catch(() => {});
}

export default {
    name: "slot",
    description: "Spin the slot machine — three of a kind wins",
    options: [BET_OPTION],
    async execute(interaction) {
        const ready = await preflight(interaction, "slot", interaction.options.getString("bet", true));
        if (ready) await play(interaction, ready);
    },
    async buttonHandler(interaction) {
        const [, action, owner, bet] = interaction.customId.split(":");
        if (action !== "again") return;
        if (interaction.user.id !== owner) {
            await interaction.reply({ content: "Use `/slot` to spin your own machine!", flags: MessageFlags.Ephemeral });
            return;
        }
        const ready = await preflight(interaction, "slot", bet);
        if (ready) await play(interaction, ready);
    }
} satisfies Command;
