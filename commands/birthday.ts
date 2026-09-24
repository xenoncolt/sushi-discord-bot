import {
    ActionRowBuilder, ApplicationCommandOptionType, ButtonInteraction, ChatInputCommandInteraction,
    ContainerBuilder, Guild, MessageFlags, ModalBuilder, ModalSubmitInteraction, RepliableInteraction,
    TextInputBuilder, TextInputStyle
} from "discord.js";
import { refreshPanel } from "../birthday/panel.js";
import { formatDate, getBirthday, parseBirthday, removeBirthday, setBirthday, upcomingBirthdays } from "../birthday/store.js";
import { getSettings } from "../leveling/settings.js";
import { COLOR, hexToInt, sep, text } from "../leveling/ui.js";
import { Command } from "../types/Command.js";
import { ExtendedClient } from "../types/ExtendedClient.js";


const UPCOMING_LIMIT = 15;

async function card(interaction: RepliableInteraction, container: ContainerBuilder): Promise<void> {
    // Always ephemeral: this is the member talking to the bot about their own
    // date, and the channel it happens in is usually the panel's, which is
    // exactly the channel that should stay clean.
    const payload = { components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
    else await interaction.reply(payload);
}

function note(color: number, ...lines: string[]): ContainerBuilder {
    return new ContainerBuilder().setAccentColor(color).addTextDisplayComponents(text(lines.join("\n")));
}

function birthdayModal(guild_id: string, user_id: string): ModalBuilder {
    const existing = getBirthday(guild_id, user_id);

    const date = new TextInputBuilder()
        .setCustomId("date")
        .setLabel("Day and month")
        .setPlaceholder("05-11   ·   5 Nov   ·   25 December")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(30);

    const year = new TextInputBuilder()
        .setCustomId("year")
        .setLabel("Year (optional, shows your age)")
        .setPlaceholder("2000 — leave empty to keep it private")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(4);

    // Changing an existing date starts from what is already stored.
    if (existing) {
        date.setValue(`${existing.day}-${existing.month}`);
        if (existing.year !== null) year.setValue(String(existing.year));
    }

    return new ModalBuilder()
        .setCustomId("birthday:modal")
        .setTitle(existing ? "Change your birthday" : "Your birthday")
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(date),
            new ActionRowBuilder<TextInputBuilder>().addComponents(year)
        );
}

function upcomingCard(guild: Guild): ContainerBuilder {
    const settings = getSettings(guild.id);
    const rows = upcomingBirthdays(guild.id, settings.server.timezone, UPCOMING_LIMIT);

    const container = new ContainerBuilder()
        .setAccentColor(hexToInt(settings.birthday.templates.announce.color))
        .addTextDisplayComponents(text(`## 📅 Upcoming birthdays`));

    if (!rows.length) {
        return container.addTextDisplayComponents(text("*Nobody has added a birthday yet — be the first!*"));
    }

    return container
        .addSeparatorComponents(sep())
        .addTextDisplayComponents(text(rows.map(r => {
            const when = r.in_days === 0 ? "**today!** 🎂" : r.in_days === 1 ? "**tomorrow**" : `in **${r.in_days}** days`;
            const age = r.age === null ? "" : ` · turning ${r.age}`;
            return `<@${r.user_id}> · ${formatDate(r.month, r.day)}${age} · ${when}`;
        }).join("\n")));
}

async function saveFrom(interaction: ModalSubmitInteraction, client: ExtendedClient): Promise<void> {
    if (!interaction.inCachedGuild()) return;

    const parsed = parseBirthday(interaction.fields.getTextInputValue("date"), interaction.fields.getTextInputValue("year"));
    if (typeof parsed === "string") {
        await card(interaction, note(COLOR.lose, `### That date didn't work`, parsed, "", "Press the button again to have another go."));
        return;
    }

    setBirthday(interaction.guildId, interaction.user.id, parsed.month, parsed.day, parsed.year);

    // The month is spelled out on purpose: "05-11" is the 5th of November here
    // and the 11th of May to half the world, and this is where that gets caught.
    const year = parsed.year === null ? "" : ` ${parsed.year}`;
    await card(interaction, note(COLOR.win,
        `### 🎂 Saved — ${formatDate(parsed.month, parsed.day)}${year}`,
        parsed.year === null
            ? "Your age stays private; only the day and month are ever shown."
            : "Your age will be shown in the announcement.",
        "",
        "Wrong date? Press the button again to change it."
    ));

    // The panel counts how many birthdays it holds, so it is worth redrawing.
    await refreshPanel(client, interaction.guild, "sync").catch(() => {});
}

export default {
    name: "birthday",
    description: "Set, change or look up birthdays in this server",
    options: [
        { name: "set", description: "Add or change your birthday", type: ApplicationCommandOptionType.Subcommand },
        { name: "remove", description: "Delete your birthday from this server", type: ApplicationCommandOptionType.Subcommand },
        { name: "list", description: "See whose birthday is coming up next", type: ApplicationCommandOptionType.Subcommand },
        {
            name: "view",
            description: "See when someone's birthday is",
            type: ApplicationCommandOptionType.Subcommand,
            options: [{ name: "user", description: "Whose birthday to look up", type: ApplicationCommandOptionType.User, required: false }]
        }
    ],
    cooldown: 3,

    async execute(interaction: ChatInputCommandInteraction, client: ExtendedClient) {
        if (!interaction.inCachedGuild()) {
            await interaction.reply({ content: "This only works inside a server.", flags: MessageFlags.Ephemeral });
            return;
        }
        if (!getSettings(interaction.guildId).birthday.enabled) {
            await interaction.reply({ content: "Birthdays aren't switched on in this server yet. An admin can enable them on the dashboard.", flags: MessageFlags.Ephemeral });
            return;
        }

        switch (interaction.options.getSubcommand()) {
            case "set":
                await interaction.showModal(birthdayModal(interaction.guildId, interaction.user.id));
                return;

            case "remove": {
                const had = removeBirthday(interaction.guildId, interaction.user.id);
                await card(interaction, had
                    ? note(COLOR.info, "### Removed", "Your birthday is gone from this server. You can add it again whenever you like.")
                    : note(COLOR.push, "### Nothing to remove", "You haven't set a birthday in this server."));
                if (had) await refreshPanel(client, interaction.guild, "sync").catch(() => {});
                return;
            }

            case "list":
                await card(interaction, upcomingCard(interaction.guild));
                return;

            case "view": {
                const user = interaction.options.getUser("user") ?? interaction.user;
                const row = getBirthday(interaction.guildId, user.id);
                const mine = user.id === interaction.user.id;
                await card(interaction, row
                    ? note(COLOR.info, `### 🎂 ${formatDate(row.month, row.day)}`, `${mine ? "That's your birthday" : `<@${user.id}>'s birthday`}${row.year === null ? "" : ` (${row.year})`}.`)
                    : note(COLOR.push, "### No birthday saved", mine ? "Use `/birthday set` to add yours." : `<@${user.id}> hasn't added one.`));
                return;
            }
        }
    },

    // The panel's buttons. Routed here by the "birthday:" prefix on their ids.
    async buttonHandler(interaction: ButtonInteraction, client: ExtendedClient) {
        if (!interaction.inCachedGuild()) return;

        switch (interaction.customId) {
            case "birthday:set":
                await interaction.showModal(birthdayModal(interaction.guildId, interaction.user.id));
                return;

            case "birthday:remove": {
                const had = removeBirthday(interaction.guildId, interaction.user.id);
                await card(interaction, had
                    ? note(COLOR.info, "### Removed", "Your birthday is gone from this server. Press the other button whenever you want to add it back.")
                    : note(COLOR.push, "### Nothing to remove", "You haven't set a birthday in this server yet."));
                if (had) await refreshPanel(client, interaction.guild, "sync").catch(() => {});
                return;
            }

            case "birthday:list":
                await card(interaction, upcomingCard(interaction.guild));
                return;
        }
    },

    async modalSubmit(interaction: ModalSubmitInteraction, client: ExtendedClient) {
        if (interaction.customId === "birthday:modal") await saveFrom(interaction, client);
    }
} satisfies Command;
