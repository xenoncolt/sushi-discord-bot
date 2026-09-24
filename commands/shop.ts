import { ActionRowBuilder, ButtonInteraction, ButtonStyle, ContainerBuilder, MessageFlags, StringSelectMenuBuilder, StringSelectMenuInteraction } from "discord.js";
import { Command } from "../types/Command.js";
import { button, row } from "../games/common.js";
import { getMember } from "../leveling/members.js";
import { isManager } from "../leveling/perms.js";
import { buyItem, getItem, listItems, listPurchases, resolveRequest, useItem } from "../leveling/shop.js";
import { getSettings } from "../leveling/settings.js";
import { COLOR, dashboardUrl, fmt, linkRow, sep, text } from "../leveling/ui.js";

const V2_EPHEMERAL = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

function itemKind(type: string, hours: number): string {
    if (type === "role") return "Role";
    if (type === "timed_role") return hours % 24 === 0 ? `Role · ${hours / 24} day${hours === 24 ? "" : "s"}` : `Role · ${hours}h`;
    return "Item";
}

function shopView(guild_id: string, user_id: string): ContainerBuilder {
    const settings = getSettings(guild_id);
    const xp_name = settings.server.xp_name;
    const items = listItems(guild_id);
    const balance = getMember(guild_id, user_id).xp;

    const container = new ContainerBuilder()
        .setAccentColor(COLOR.gold)
        .addTextDisplayComponents(text(`## 🛍️ ${xp_name} Shop\n👛 You have **${fmt(balance)} ${xp_name}**`))
        .addSeparatorComponents(sep());

    if (!items.length) {
        container.addTextDisplayComponents(text("*The shop is empty right now. Admins can stock it from the dashboard.*"));
        return container;
    }

    container.addTextDisplayComponents(text(items.slice(0, 25).map(i => [
        `**${i.emoji ? `${i.emoji} ` : ""}${i.name}** — ${fmt(i.price)} ${xp_name}`,
        `-# ${itemKind(i.type, i.duration_hours)}${i.role_id ? ` · <@&${i.role_id}>` : ""}${i.stock >= 0 ? ` · ${i.stock} left` : ""}${i.description ? ` · ${i.description.slice(0, 80)}` : ""}`
    ].join("\n")).join("\n")));

    container.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId("shop:pick")
            .setPlaceholder("Choose something to buy…")
            .addOptions(items.slice(0, 25).map(i => ({
                label: i.name.slice(0, 100),
                value: String(i.id),
                description: `${fmt(i.price)} ${xp_name}${i.stock === 0 ? " · sold out" : ""}`.slice(0, 100),
                emoji: i.emoji && /^\p{Extended_Pictographic}/u.test(i.emoji) ? i.emoji : undefined
            })))
    ));
    container.addActionRowComponents(row(button("shop:inventory", "Inventory", ButtonStyle.Secondary, "🎒")));
    return container;
}

function inventoryView(guild_id: string, user_id: string): ContainerBuilder {
    const owned = listPurchases(guild_id, { user_id, status: ["owned", "requested", "active"], limit: 25 });
    const container = new ContainerBuilder()
        .setAccentColor(COLOR.info)
        .addTextDisplayComponents(text("## 🎒 Your inventory"))
        .addSeparatorComponents(sep());

    if (!owned.length) {
        container.addTextDisplayComponents(text("*Nothing here yet. Buy something from the shop!*"));
    } else {
        container.addTextDisplayComponents(text(owned.map(p => {
            const state = p.status === "requested" ? "⏳ waiting for an admin"
                : p.status === "owned" ? "ready to use"
                : p.expires_at ? `expires <t:${Math.floor(p.expires_at / 1000)}:R>` : "permanent";
            return `**${p.item_name}** · ${state}`;
        }).join("\n")));

        const usable = owned.filter(p => p.status === "owned");
        if (usable.length) {
            container.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId("shop:use")
                    .setPlaceholder("Use an item…")
                    .addOptions(usable.map(p => ({ label: p.item_name.slice(0, 100), value: String(p.id), description: `Bought ${new Date(p.created_at).toISOString().slice(0, 10)}` })))
            ));
        }
    }
    container.addActionRowComponents(row(button("shop:back", "Back to shop", ButtonStyle.Secondary, "↩️")));
    return container;
}

export default {
    name: "shop",
    description: "Open the XP shop — spend your XP on roles and rewards",
    options: [],
    async execute(interaction) {
        if (!interaction.inCachedGuild()) {
            await interaction.reply({ content: "This only works inside a server.", flags: MessageFlags.Ephemeral });
            return;
        }
        const container = shopView(interaction.guildId, interaction.user.id);
        const url = dashboardUrl();
        if (url) {
            container.addActionRowComponents(linkRow({ label: "Open the web shop", url: `${url}/shop/${interaction.guildId}`, emoji: "🛒" }));
            if (isManager(interaction.member)) container.addTextDisplayComponents(text(`-# Admins: manage items at ${url}/dashboard/${interaction.guildId}/shop`));
        }
        await interaction.reply({ components: [container], flags: V2_EPHEMERAL });
    },

    async selectMenuHandler(interaction: StringSelectMenuInteraction) {
        if (!interaction.inCachedGuild()) return;
        const value = Number(interaction.values[0]);

        if (interaction.customId === "shop:pick") {
            const item = getItem(interaction.guildId, value);
            const xp_name = getSettings(interaction.guildId).server.xp_name;
            if (!item || !item.enabled) {
                await interaction.update({ components: [shopView(interaction.guildId, interaction.user.id)] });
                return;
            }
            await interaction.update({
                components: [new ContainerBuilder().setAccentColor(COLOR.gold)
                    .addTextDisplayComponents(text([
                        `### Buy ${item.emoji ? `${item.emoji} ` : ""}${item.name}?`,
                        item.description,
                        `💰 **${fmt(item.price)} ${xp_name}** · you have ${fmt(getMember(interaction.guildId, interaction.user.id).xp)}`,
                        `-# Spending ${xp_name} can lower your level.`
                    ].filter(Boolean).join("\n")))
                    .addActionRowComponents(row(
                        button(`shop:buy:${item.id}`, "Buy", ButtonStyle.Success, "🛒"),
                        button("shop:back", "Cancel", ButtonStyle.Secondary)
                    ))]
            });
            return;
        }

        if (interaction.customId === "shop:use") {
            const result = await useItem(interaction.member, value);
            const container = inventoryView(interaction.guildId, interaction.user.id);
            container.addTextDisplayComponents(text(`${result.ok ? "✅" : "❌"} ${result.message}`));
            await interaction.update({ components: [container] });
        }
    },

    async buttonHandler(interaction: ButtonInteraction) {
        if (!interaction.inCachedGuild()) return;
        const [, action, arg] = interaction.customId.split(":");

        switch (action) {
            case "inventory":
                await interaction.update({ components: [inventoryView(interaction.guildId, interaction.user.id)] });
                return;
            case "back":
                await interaction.update({ components: [shopView(interaction.guildId, interaction.user.id)] });
                return;
            case "buy": {
                const result = await buyItem(interaction.member, Number(arg));
                const container = shopView(interaction.guildId, interaction.user.id);
                container.addSeparatorComponents(sep());
                container.addTextDisplayComponents(text(`${result.ok ? "✅" : "❌"} ${result.message}`));
                await interaction.update({ components: [container] });
                return;
            }
            // Buttons on benefit requests in the admin log channel.
            case "done":
            case "refund": {
                if (!isManager(interaction.member)) {
                    await interaction.reply({ content: "Only admins can handle shop requests.", flags: MessageFlags.Ephemeral });
                    return;
                }
                const note = await resolveRequest(interaction.guild, Number(arg), action, interaction.member);
                const original = interaction.message.components[0];
                const body = original && "components" in original
                    ? original.components.filter(c => c.type === 10).map(c => "content" in c ? String(c.content) : "").join("\n")
                    : "";
                await interaction.update({
                    components: [new ContainerBuilder().setAccentColor(action === "done" ? COLOR.win : COLOR.push)
                        .addTextDisplayComponents(text(`${body}\n\n${note}`.trim()))]
                });
                return;
            }
        }
    }
} satisfies Command;
