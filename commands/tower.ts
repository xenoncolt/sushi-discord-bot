import { ButtonInteraction, ButtonStyle, ContainerBuilder, GuildMember, SendableChannels } from "discord.js";
import { Command } from "../types/Command.js";
import { BET_OPTION, GameStore, LiveGame, V2, button, editGame, gameHeader, gameOver, lockBet, newId, notYours, outcomeColor, preflight, resultLines, routeId, row, settle, shuffle, startCooldown } from "../games/common.js";
import { getSettings } from "../leveling/settings.js";
import { COLOR, fmt, sep, text } from "../leveling/ui.js";

// Climb floor by floor; each floor has 3 doors and `traps` of them are traps.
// Every floor cleared adds `per_step` to the multiplier (1 + 0.43 × floors at
// the default) and reaching the top cashes out automatically.
const DOORS = 3;

interface Climb extends LiveGame {
    member: GuildMember;
    bet: number;
    level_before: number;
    channel: SendableChannels | null;
    per_step: number;
    floors: number;
    traps: boolean[][];     // traps[floor][door]
    picks: number[];        // door chosen on each cleared floor
    fell: number | null;    // door that was a trap on the final floor
}

function mult(c: Climb): number {
    return 1 + c.per_step * c.picks.length;
}

function view(c: Climb, finished: { net: number; balance: number } | null): ContainerBuilder {
    const xp_name = getSettings(c.member.guild.id).server.xp_name;
    const title = !finished ? "🗼 Tower" : c.fell !== null ? "🗼 Tower — You fell!" : c.picks.length === c.floors ? "🗼 Tower — Summit! 🎉" : "🗼 Tower — Cashed out! 💰";
    const container = gameHeader(new ContainerBuilder().setAccentColor(finished ? outcomeColor(finished.net) : COLOR.gold), title, c.member.id);

    const current = c.picks.length;
    const lines: string[] = [];
    for (let f = c.floors - 1; f >= 0; f--) {
        const doors = Array.from({ length: DOORS }, (_, d) => {
            if (f < current) return c.picks[f] === d ? "✅" : finished && c.traps[f][d] ? "💀" : "⬛";
            if (f === current && c.fell !== null) return c.fell === d ? "💥" : c.traps[f][d] ? "💀" : "⬛";
            if (finished && f > current) return c.traps[f][d] ? "💀" : "⬛";
            return "🚪";
        }).join(" ");
        const marker = f === current && !finished ? "▶" : " ";
        lines.push(`${marker} \`${String(f + 1).padStart(2)}F\` ${doors}  ×${(1 + c.per_step * (f + 1)).toFixed(2)}`);
    }
    container.addTextDisplayComponents(text(lines.join("\n")));

    if (finished) {
        container.addSeparatorComponents(sep());
        container.addTextDisplayComponents(text(resultLines(finished.net, finished.balance, xp_name,
            c.fell !== null ? `💀 **Trap on floor ${current + 1}.**` : `🎯 **Cleared ${current} floor(s) — ×${mult(c).toFixed(2)}**`)));
    } else {
        container.addActionRowComponents(row(
            ...Array.from({ length: DOORS }, (_, d) => button(`tower:${c.id}:door:${d}`, `Door ${d + 1}`, ButtonStyle.Secondary, "🚪"))
        ));
        container.addActionRowComponents(row(
            button(`tower:${c.id}:cash`, `Cash out ${fmt(Math.floor(c.bet * mult(c)))}`, ButtonStyle.Primary, "💰")
        ));
    }
    return container;
}

function cashOut(c: Climb) {
    return settle(c.member, "tower", c.bet, Math.floor(c.bet * mult(c)), c.level_before, c.channel, `${c.picks.length} floors`);
}

const climbs = new GameStore<Climb>(120_000, async c => {
    const result = cashOut(c);
    await editGame(c, { components: [view(c, result)] });
});

export default {
    name: "tower",
    description: "Climb the tower one safe door at a time — cash out before a trap",
    options: [BET_OPTION],
    async execute(interaction) {
        const ready = await preflight(interaction, "tower", interaction.options.getString("bet", true));
        if (!ready) return;
        const { member, gs, bet, channel } = ready;

        startCooldown(member.guild.id, member.id, "tower", gs.cooldown);
        const traps = Array.from({ length: gs.floors }, () => {
            const doors = new Array(DOORS).fill(false);
            for (const d of shuffle([0, 1, 2]).slice(0, Math.min(DOORS - 1, gs.traps))) doors[d] = true;
            return doors;
        });

        const c: Climb = {
            id: newId(),
            last: interaction,
            member,
            bet,
            level_before: lockBet(member, bet),
            channel,
            per_step: gs.per_step,
            floors: gs.floors,
            traps,
            picks: [],
            fell: null
        };
        climbs.add(c);
        await interaction.reply({ components: [view(c, null)], flags: V2, allowedMentions: { parse: [] } });
    },
    async buttonHandler(interaction: ButtonInteraction) {
        const { id, action, arg } = routeId(interaction.customId);
        const c = climbs.get(id);
        if (!c) return gameOver(interaction);
        if (interaction.user.id !== c.member.id) return notYours(interaction);

        if (action === "cash") {
            climbs.end(c.id);
            await interaction.update({ components: [view(c, cashOut(c))] });
            return;
        }

        const door = Number(arg);
        const floor = c.picks.length;
        if (c.traps[floor][door]) {
            c.fell = door;
            climbs.end(c.id);
            const result = settle(c.member, "tower", c.bet, 0, c.level_before, c.channel, `fell on ${floor + 1}F`);
            await interaction.update({ components: [view(c, result)] });
            return;
        }

        c.picks.push(door);
        if (c.picks.length >= c.floors) {
            climbs.end(c.id);
            await interaction.update({ components: [view(c, cashOut(c))] });
            return;
        }
        climbs.touch(c, interaction);
        await interaction.update({ components: [view(c, null)] });
    }
} satisfies Command;
