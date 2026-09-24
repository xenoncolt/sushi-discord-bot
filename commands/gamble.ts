import { ButtonInteraction, ButtonStyle, ContainerBuilder, GuildMember, MessageFlags, SendableChannels } from "discord.js";
import { Command } from "../types/Command.js";
import { BET_OPTION, GameStore, LiveGame, OPPONENT_OPTION, button, editGame, gameOver, outcomeColor, potAfterFee, preflight, refund, rng, routeId, row, settle, wait } from "../games/common.js";
import { challengeButton, createChallenge } from "../games/pvp.js";
import { getSettings } from "../leveling/settings.js";
import { COLOR, fmt, sep, signed, text } from "../leveling/ui.js";

// Odd-Even: once the opponent accepts, both players secretly pick Odd or
// Even. A random number is revealed and whoever matches its parity wins the
// loser's bet (minus the fee). If both picked the same side nobody can lose,
// so the bets go back.

type Pick = "odd" | "even";

interface Player {
    member: GuildMember;
    level: number;
    pick: Pick | null;
}

interface Round extends LiveGame {
    players: [Player, Player];
    stake: number;
    channel: SendableChannels | null;
}

// `rolling` shows `number` as one frame of the number still spinning.
function view(r: Round, footer?: string, number?: number, rolling = false): ContainerBuilder {
    const done = number !== undefined || footer !== undefined;
    const container = new ContainerBuilder()
        .setAccentColor(done && !rolling ? outcomeColor(1) : COLOR.gold)
        .addTextDisplayComponents(text([
            rolling ? `### 🎲 Odd or Even — Rolling...` : `### 🎲 Odd or Even`,
            ...r.players.map(p => `${p.pick ? (done ? (p.pick === "odd" ? "1️⃣ **ODD**" : "2️⃣ **EVEN**") : "✅ picked") : "⏳ picking…"} · <@${p.member.id}>`),
            number === undefined ? `Both players, choose **Odd** or **Even**. Picks stay hidden until the reveal.`
                : rolling ? `# 🎰 ${number} …` : `# 🎰 ${number} → ${number % 2 ? "ODD" : "EVEN"}`
        ].join("\n")));

    if (!done) {
        container.addActionRowComponents(row(
            button(`gamble:${r.id}:odd`, "Odd", ButtonStyle.Primary, "1️⃣"),
            button(`gamble:${r.id}:even`, "Even", ButtonStyle.Success, "2️⃣")
        ));
    }
    if (footer) {
        container.addSeparatorComponents(sep());
        container.addTextDisplayComponents(text(footer));
    }
    return container;
}

// Settles the round on `number` and returns the footer describing it.
function resolve(r: Round, number: number): string {
    const settings = getSettings(r.players[0].member.guild.id);
    const xp_name = settings.server.xp_name;
    const parity: Pick = number % 2 ? "odd" : "even";
    const [a, b] = r.players;

    if (a.pick === b.pick) {
        for (const p of r.players) settle(p.member, "oddeven", r.stake, r.stake, p.level, r.channel, "same pick");
        return `🤝 You both picked **${a.pick!.toUpperCase()}**, so nobody can lose — bets returned.`;
    }

    const winner = a.pick === parity ? a : b;
    const loser = winner === a ? b : a;
    const { payout, fee } = potAfterFee(r.stake * 2, r.stake, settings.gamble.games.oddeven.fee);
    const w = settle(winner.member, "oddeven", r.stake, payout, winner.level, r.channel, `${number} ${parity}`);
    const l = settle(loser.member, "oddeven", r.stake, 0, loser.level, r.channel, `${number} ${parity}`);
    return [
        `🏆 <@${winner.member.id}> wins **${signed(w.net)} ${xp_name}** (balance ${fmt(w.balance)})`,
        `💸 <@${loser.member.id}> loses **${fmt(r.stake)} ${xp_name}** (balance ${fmt(l.balance)})`,
        fee ? `-# Fee: ${fmt(fee)} ${xp_name}` : ""
    ].filter(Boolean).join("\n");
}

// Someone never picked: nobody played, so both stakes go back.
const rounds = new GameStore<Round>(60_000, async r => {
    for (const p of r.players) refund(p.member, r.stake, p.level);
    await editGame(r, { components: [view(r, "⌛ Not everyone picked in time. Both bets were returned.")] });
});

export default {
    name: "gamble",
    description: "Odd or Even against another member",
    options: [BET_OPTION, OPPONENT_OPTION],
    async execute(interaction) {
        const ready = await preflight(interaction, "oddeven", interaction.options.getString("bet", true));
        if (!ready) return;
        await createChallenge(interaction, ready, "oddeven", "gamble", [
            "🎲 Both pick Odd or Even, then a random number decides who wins."
        ]);
    },
    async buttonHandler(interaction: ButtonInteraction) {
        const { id, action } = routeId(interaction.customId);

        if (action === "accept" || action === "decline") {
            const match = await challengeButton(interaction, id, action);
            if (!match) return;
            const { c, opponent, host_level, opp_level } = match;
            const r: Round = {
                id: c.id,
                last: interaction,
                players: [
                    { member: c.host, level: host_level, pick: null },
                    { member: opponent, level: opp_level, pick: null }
                ],
                stake: c.stake,
                channel: c.channel
            };
            rounds.add(r);
            await interaction.update({ components: [view(r)], allowedMentions: { parse: [] } });
            return;
        }

        const r = rounds.get(id);
        if (!r) return gameOver(interaction);
        const me = r.players.find(p => p.member.id === interaction.user.id);
        if (!me) {
            await interaction.reply({ content: "You're not in this game.", flags: MessageFlags.Ephemeral });
            return;
        }
        if (me.pick) {
            await interaction.reply({ content: `You already picked **${me.pick.toUpperCase()}**.`, flags: MessageFlags.Ephemeral });
            return;
        }

        me.pick = action === "odd" ? "odd" : "even";
        if (r.players.every(p => p.pick)) {
            rounds.end(r.id);
            // The number spins for a few frames before it lands. Settled after
            // the last frame so a level-up message can't spoil it (see slot.ts).
            const number = rng(100) + 1;
            let footer: string;
            try {
                await interaction.update({ components: [view(r, undefined, rng(100) + 1, true)] });
                await wait(1000);
                await interaction.editReply({ components: [view(r, undefined, rng(100) + 1, true)] }).catch(() => {});
                await wait(1000);
                await interaction.editReply({ components: [view(r, undefined, rng(100) + 1, true)] }).catch(() => {});
                await wait(1500);
            } finally {
                footer = resolve(r, number);
            }
            await interaction.editReply({ components: [view(r, footer, number)] }).catch(() => {});
            return;
        }
        rounds.touch(r, interaction);
        await interaction.update({ components: [view(r)] });
    }
} satisfies Command;
