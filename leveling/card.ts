import { AttachmentBuilder, ChatInputCommandInteraction, ContainerBuilder, MessageFlags, User } from "discord.js";
import { progressFor } from "./formula.js";
import { getMember, liveMonthXp, monthRank, xpRank } from "./members.js";
import { stripPrefix } from "./prefix.js";
import { renderRankCard } from "./rankCard.js";
import { getSettings } from "./settings.js";
import { COLOR, fmt, progressBar, text } from "./ui.js";

// The rank card reply shared by /rank and /level. `content` is an optional
// line shown above the card (/level uses it for the target-level answer).
export async function replyWithCard(interaction: ChatInputCommandInteraction<"cached">, user: User, content?: string): Promise<void> {
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply();

    const guild = interaction.guild;
    const member = guild.members.cache.get(user.id) ?? await guild.members.fetch(user.id).catch(() => null);
    const settings = getSettings(guild.id);
    const row = getMember(guild.id, user.id);
    const progress = progressFor(row.xp, settings.server.formula);
    const name = member ? stripPrefix(guild.id, member.displayName) : row.name ?? user.displayName;

    const data = {
        name,
        avatar_url: (member ?? user).displayAvatarURL({ extension: "png", forceStatic: true, size: 256 }),
        level: progress.level,
        xp: row.xp,
        next_at: progress.next_at,
        progress: progress.current / progress.needed,
        server_rank: xpRank(guild.id, user.id),
        month_rank: monthRank(guild.id, user.id),
        month_xp: liveMonthXp(row, settings.server.timezone),
        xp_name: settings.server.xp_name
    };

    try {
        const png = await renderRankCard(data);
        await interaction.editReply({ content, files: [new AttachmentBuilder(png, { name: "rank.png" })], allowedMentions: { parse: [] } });
    } catch (err) {
        // Should the renderer ever fail (fonts missing after a move, say),
        // the numbers still get through.
        console.error("Rank card render failed:", err);
        const x = settings.server.xp_name;
        await interaction.editReply({
            components: [new ContainerBuilder().setAccentColor(COLOR.gold).addTextDisplayComponents(text([
                content ?? "",
                `### ${name}`,
                `**Level ${data.level}** · Server rank #${data.server_rank} · Monthly rank #${data.month_rank}`,
                `${progressBar(progress.current, progress.needed, 16)} ${fmt(data.xp)} / ${fmt(data.next_at)} ${x}`,
                `Monthly: ${fmt(data.month_xp)} ${x}`
            ].filter(Boolean).join("\n")))],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] }
        });
    }
}
