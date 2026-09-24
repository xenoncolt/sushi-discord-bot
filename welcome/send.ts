import {
    ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle,
    Client, ContainerBuilder, Guild, GuildMember, MediaGalleryBuilder, MediaGalleryItemBuilder,
    MessageFlags, SectionBuilder, SendableChannels, ThumbnailBuilder
} from "discord.js";
import { memberVars, renderTemplate, resolveChannel } from "../leveling/notify.js";
import { getSettings, WelcomeButton, WelcomeSettings } from "../leveling/settings.js";
import { zonedParts } from "../leveling/time.js";
import { hexToInt, resolveEmoji, sep, text } from "../leveling/ui.js";
import { ordinal, renderWelcomeCard, WelcomeCardData } from "./card.js";

// Greeting somebody who just joined: a Components V2 card assembled from the
// blocks laid out on the dashboard, with a drawn image of their avatar and
// link buttons wherever they were put.

const FILE_NAME = "welcome.png";

// Discord counts every component in a message, nested ones included, and
// turns down anything past forty. Well out of reach of a sane welcome
// message, but a hand-crafted settings blob shouldn't be able to break the
// message for everybody.
const COMPONENT_MAX = 38;


// ---- buttons ------------------------------------------------------------------

// A link button's URL has to be a real one when the message is sent, so a
// channel button is turned into a jump link here rather than being stored
// as one — the server could move the channel, and the link still follows.
function buttonUrl(guild: Guild, button: WelcomeButton): string | null {
    if (button.kind === "url") return /^https?:\/\/\S+$/.test(button.url) ? button.url : null;
    return button.channel_id ? `https://discord.com/channels/${guild.id}/${button.channel_id}` : null;
}

// Whether the builder below will actually post this button. Half-filled ones
// are kept in the settings so the dashboard can hold a row somebody is still
// typing, but they never reach Discord. The dashboard imports this too, to
// say as much on the row.
export function buttonIsLive(b: WelcomeButton): boolean {
    if (!b.label.trim()) return false;
    return b.kind === "channel" ? Boolean(b.channel_id) : /^https?:\/\/\S+$/.test(b.url.trim());
}

function buildButton(guild: Guild, b: WelcomeButton, vars: Record<string, string | number>): ButtonBuilder | null {
    const url = buttonUrl(guild, b);
    const label = renderTemplate(b.label, vars).trim();
    if (!url || !label) return null;

    const button = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label.slice(0, 80)).setURL(url);
    // An unrecognisable emoji is dropped; the label alone is fine.
    const emoji = resolveEmoji(b.emoji);
    if (emoji) button.setEmoji(emoji);
    return button;
}

function buildRow(guild: Guild, buttons: WelcomeButton[], vars: Record<string, string | number>): ActionRowBuilder<ButtonBuilder> | null {
    const built = buttons.slice(0, 5).map(b => buildButton(guild, b, vars)).filter((b): b is ButtonBuilder => b !== null);
    return built.length ? new ActionRowBuilder<ButtonBuilder>().addComponents(built) : null;
}


// ---- placeholders ---------------------------------------------------------------

export function welcomeVars(member: GuildMember, xp_name: string, timezone: string): Record<string, string | number> {
    const now = zonedParts(timezone);
    return {
        ...memberVars(member, xp_name),
        count: member.guild.memberCount,
        ordinal: ordinal(member.guild.memberCount),
        date: `${now.day}/${now.month}/${now.year}`
    };
}

export function cardDataFor(member: GuildMember, vars: Record<string, string | number>): WelcomeCardData {
    return {
        name: String(vars.name ?? member.displayName),
        username: member.user.username,
        avatar_url: member.displayAvatarURL({ extension: "png", forceStatic: true, size: 256 }),
        server: member.guild.name,
        count: member.guild.memberCount
    };
}


// ---- the message -----------------------------------------------------------------

export interface BuiltWelcome {
    container: ContainerBuilder;
    files: AttachmentBuilder[];
}

export async function buildWelcome(member: GuildMember, welcome: WelcomeSettings, xp_name: string, timezone: string): Promise<BuiltWelcome> {
    const guild = member.guild;
    const vars = welcomeVars(member, xp_name, timezone);
    const avatar = member.displayAvatarURL({ extension: "png", size: 256 });
    const files: AttachmentBuilder[] = [];

    // Drawn before anything else is assembled: a failure here must not cost
    // the server its whole welcome, so the image is simply left out instead.
    let image: string | null = null;
    if (welcome.card.enabled) {
        try {
            const png = await renderWelcomeCard(welcome.card, cardDataFor(member, vars));
            files.push(new AttachmentBuilder(png, { name: FILE_NAME }));
            image = `attachment://${FILE_NAME}`;
        } catch (err) {
            console.error(`Welcome card render failed for ${guild.id}:`, err);
        }
    }

    const container = new ContainerBuilder().setAccentColor(hexToInt(welcome.color));
    let used = 0;

    for (const block of welcome.blocks) {
        if (used >= COMPONENT_MAX) break;

        if (block.type === "separator") {
            container.addSeparatorComponents(sep(block.divider));
            used++;
        } else if (block.type === "image") {
            if (!image) continue;
            container.addMediaGalleryComponents(
                new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(image))
            );
            used++;
        } else if (block.type === "buttons") {
            const row = buildRow(guild, block.buttons, vars);
            if (!row) continue;
            container.addActionRowComponents(row);
            used += 1 + block.buttons.length;
        } else {
            // Text, alone or as a section with something down its right side.
            const body = renderTemplate(block.text, vars).trim();
            if (!body) continue;

            const accessory = block.accessory === "button" && block.buttons[0]
                ? buildButton(guild, block.buttons[0], vars)
                : null;

            if (accessory || block.accessory === "avatar") {
                const section = new SectionBuilder().addTextDisplayComponents(text(body));
                if (accessory) section.setButtonAccessory(accessory);
                else section.setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar));
                container.addSectionComponents(section);
                used += 2;
            } else {
                container.addTextDisplayComponents(text(body));
                used++;
            }
        }
    }

    // The drawn card is the point of the message, so if the layout has no
    // image block it still goes in, at the end.
    if (image && !welcome.blocks.some(b => b.type === "image") && used < COMPONENT_MAX) {
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(image))
        );
        used++;
    }

    const footer = renderTemplate(welcome.footer, vars).trim();
    if (footer && used < COMPONENT_MAX) {
        container.addSeparatorComponents(sep());
        container.addTextDisplayComponents(text(`-# ${footer}`));
        used += 2;
    }

    // Discord turns down a container with nothing in it.
    if (!used) container.addTextDisplayComponents(text("​"));

    return { container, files };
}

export async function sendWelcome(channel: SendableChannels, member: GuildMember, welcome: WelcomeSettings, xp_name: string, timezone: string): Promise<boolean> {
    const { container, files } = await buildWelcome(member, welcome, xp_name, timezone);

    // A Components V2 message has no plain content to hang a role ping on, so
    // the ping is its own line above the card.
    const components = welcome.ping_role ? [text(`<@&${welcome.ping_role}>`), container] : [container];

    try {
        await channel.send({
            components,
            files,
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: {
                parse: [],
                users: welcome.mention_user ? [member.id] : [],
                roles: welcome.ping_role ? [welcome.ping_role] : []
            }
        });
        return true;
    } catch (err) {
        console.error(`Welcome message failed in ${member.guild.id}:`, err);
        return false;
    }
}

// What the join event calls: everything is checked here so the event handler
// stays a one-liner.
export async function welcomeMember(client: Client, member: GuildMember): Promise<void> {
    const settings = getSettings(member.guild.id);
    const welcome = settings.welcome;
    if (!welcome.enabled) return;

    const channel = await resolveChannel(client, welcome.channel);
    if (!channel) return;

    await sendWelcome(channel, member, welcome, settings.server.xp_name, settings.server.timezone);
}
