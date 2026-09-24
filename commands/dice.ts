import { ButtonInteraction, ContainerBuilder } from "discord.js";
import { Command } from "../types/Command.js";
import { BET_OPTION, OPPONENT_OPTION, Settled, outcomeColor, potAfterFee, preflight, rng, routeId, settle, wait } from "../games/common.js";
import { challengeButton, createChallenge } from "../games/pvp.js";
import { getSettings } from "../leveling/settings.js";
import { COLOR, fmt, sep, signed, text } from "../leveling/ui.js";

// Dice: both players roll one die (1-6) and the higher number wins. A tie is
// re-rolled automatically, so there are no draws. The loser's bet goes to the
// winner, minus the fee.

const DIE = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

export default {
    name: "dice",
    description: "Roll a die against another member — the higher number wins",
    options: [BET_OPTION, OPPONENT_OPTION],
    async execute(interaction) {
        const ready = await preflight(interaction, "dice", interaction.options.getString("bet", true));
        if (!ready) return;
        await createChallenge(interaction, ready, "dice", "dice", ["🎲 Both roll a die — the higher number wins. Ties roll again."]);
    },
    async buttonHandler(interaction: ButtonInteraction) {
        const { id, action } = routeId(interaction.customId);
        const match = await challengeButton(interaction, id, action);
        if (!match) return;
        const { c, opponent, host_level, opp_level } = match;

        const settings = getSettings(c.host.guild.id);
        const xp_name = settings.server.xp_name;

        const ties: string[] = [];
        let h: number, o: number;
        for (;;) {
            h = rng(6) + 1;
            o = rng(6) + 1;
            if (h !== o) break;
            ties.push(`${DIE[h - 1]} ${h} vs ${o} ${DIE[o - 1]} — tie, rolling again`);
        }

        const host_wins = h > o;
        const winner = host_wins ? c.host : opponent;
        const loser = host_wins ? opponent : c.host;
        const { payout, fee } = potAfterFee(c.stake * 2, c.stake, settings.gamble.games.dice.fee);

        // Both dice tumble (a random face per frame), then the host's lands,
        // then the opponent's. Settled after the last frame so a level-up
        // message can't spoil the roll (see slot.ts).
        const face = () => DIE[rng(6)];
        const rolling = (host: string, opp: string) => new ContainerBuilder()
            .setAccentColor(COLOR.gold)
            .addTextDisplayComponents(text([
                `### 🎲 Dice — Rolling...`,
                `# ${host}  vs  ${opp}`,
                `<@${c.host.id}> vs <@${opponent.id}>`
            ].join("\n")));

        let w: Settled, l: Settled;
        try {
            await interaction.update({ components: [rolling(face(), face())] });
            await wait(1000);
            await interaction.editReply({ components: [rolling(face(), face())] }).catch(() => {});
            await wait(1300);
            await interaction.editReply({ components: [rolling(`${DIE[h - 1]} ${h}`, face())] }).catch(() => {});
            await wait(1700);
        } finally {
            w = settle(winner, "dice", c.stake, payout, host_wins ? host_level : opp_level, c.channel, `${h} vs ${o}`);
            l = settle(loser, "dice", c.stake, 0, host_wins ? opp_level : host_level, c.channel, `${h} vs ${o}`);
        }

        const container = new ContainerBuilder()
            .setAccentColor(outcomeColor(1))
            .addTextDisplayComponents(text([
                `### 🎲 Dice — <@${winner.id}> wins!`,
                ...ties.map(t => `-# ${t}`),
                `# ${DIE[h - 1]} ${h}  vs  ${o} ${DIE[o - 1]}`,
                `<@${c.host.id}> vs <@${opponent.id}>`
            ].join("\n")))
            .addSeparatorComponents(sep())
            .addTextDisplayComponents(text([
                `🏆 <@${winner.id}> wins **${signed(w.net)} ${xp_name}** (balance ${fmt(w.balance)})`,
                `💸 <@${loser.id}> loses **${fmt(c.stake)} ${xp_name}** (balance ${fmt(l.balance)})`,
                fee ? `-# Fee: ${fmt(fee)} ${xp_name}` : ""
            ].filter(Boolean).join("\n")));

        await interaction.editReply({ components: [container] }).catch(() => {});
    }
} satisfies Command;
