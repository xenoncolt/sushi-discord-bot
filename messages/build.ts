import {
    ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, EmbedBuilder,
    FileBuilder, Guild, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageActionRowComponentBuilder,
    MessageCreateOptions, MessageFlags, SectionBuilder, SeparatorBuilder, SeparatorSpacingSize,
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder, TextDisplayBuilder, ThumbnailBuilder
} from "discord.js";
import { hexToInt, resolveEmoji } from "../leveling/ui.js";
import { fetchAttachment, uploadLimit } from "./fetchFile.js";
import {
    countEmbedText, countNodes, countV2Text, LIMITS, MessageDoc, MsgButton, MsgEmbed, MsgMedia,
    MsgNode, MsgRow, MsgSelect
} from "./schema.js";

// Turning a saved document into something Discord will actually accept.
//
// The rule throughout: anything unfinished is left out rather than allowed to
// bounce the whole message. A button with no label, a gallery with no
// pictures, an embed with nothing in it — each is dropped, and named in
// `dropped` so the dashboard can say what didn't make it. Only a message with
// nothing left at all, or one over a limit that cannot be fixed by dropping
// something, is refused outright.

export class MessageError extends Error {}

export interface BuiltMessage {
    payload: MessageCreateOptions;
    // Pieces that were quietly left out, in words, for the dashboard to relay.
    dropped: string[];
}

const STYLES = {
    primary: ButtonStyle.Primary,
    secondary: ButtonStyle.Secondary,
    success: ButtonStyle.Success,
    danger: ButtonStyle.Danger
} as const;

// Prefix for every custom id this module hands out, so interactionCreate can
// route a press back here without a branch per component. Ids are capped at
// 100 characters by Discord; a role id fits in a button's, but the list of
// roles behind a dropdown does not, so a dropdown carries the saved message's
// row id and the menu is looked up from the database instead.
export const CUSTOM_PREFIX = "msg";

// A button the bot answers is found again the same way a dropdown is: by the
// saved message it belongs to. Its roles, its reply and what it turns into
// afterwards are all far too much to fit in the hundred characters Discord
// allows, and looking them up means editing the draft changes buttons already
// posted.
export function actionButtonId(row_id: number, button_id: string): string {
    return `${CUSTOM_PREFIX}:b:${row_id}:${button_id}`;
}

export function roleSelectId(row_id: number, select_id: string): string {
    return `${CUSTOM_PREFIX}:sel:${row_id}:${select_id}`;
}


// ---- components -----------------------------------------------------------

function jumpUrl(guild: Guild, channel_id: string): string {
    return `https://discord.com/channels/${guild.id}/${channel_id}`;
}

// A button Discord will take, or null when it is still half-written. Discord
// insists on a label or an emoji, a URL for link-styled buttons, and a custom
// id for every other kind.
function buildButton(guild: Guild, b: MsgButton, row_id: number | null): ButtonBuilder | null {
    const label = b.label.trim();
    const emoji = resolveEmoji(b.emoji);
    if (!label && !emoji) return null;

    const button = new ButtonBuilder();
    if (label) button.setLabel(label);
    if (emoji) button.setEmoji(emoji);

    switch (b.kind) {
        case "link": {
            if (!b.url) return null;
            button.setStyle(ButtonStyle.Link).setURL(b.url);
            break;
        }
        case "channel": {
            if (!b.channel_id) return null;
            button.setStyle(ButtonStyle.Link).setURL(jumpUrl(guild, b.channel_id));
            break;
        }
        case "role":
        case "reply":
        case "none": {
            // These are answered by the bot, which has to be able to find them
            // again — so a draft that has never been saved has no working
            // version of them.
            if (row_id === null) return null;
            if (b.kind === "role" && !b.role_ids.length && !b.remove_ids.length) return null;
            if (b.kind === "reply" && !b.reply_text.trim()) return null;
            button.setStyle(STYLES[b.style]).setCustomId(actionButtonId(row_id, b.id));
            if (b.disabled) button.setDisabled(true);
            return button;
        }
    }

    // A link button cannot be disabled through the API — it is either there or
    // it isn't — so the flag is only passed on above, where it means something.
    return button;
}

function buildSelect(s: MsgSelect, row_id: number | null): StringSelectMenuBuilder | null {
    // The menu is answered by looking it up from its saved message, so a
    // document that has never been saved has nothing to look up.
    if (row_id === null) return null;

    const options = s.options
        .filter(o => o.label && o.role_id)
        .map(o => {
            const option = new StringSelectMenuOptionBuilder().setLabel(o.label).setValue(o.role_id!);
            if (o.description) option.setDescription(o.description);
            const emoji = resolveEmoji(o.emoji);
            if (emoji) option.setEmoji(emoji);
            return option;
        });
    if (!options.length) return null;

    // Discord refuses a menu that asks for more picks than it offers.
    const max = Math.min(Math.max(1, s.max), options.length);
    const min = Math.min(s.min, max);

    const menu = new StringSelectMenuBuilder()
        .setCustomId(roleSelectId(row_id, s.id))
        .addOptions(options)
        .setMinValues(min)
        .setMaxValues(max)
        .setDisabled(s.disabled);
    if (s.placeholder) menu.setPlaceholder(s.placeholder);
    return menu;
}

function buildRow(guild: Guild, r: MsgRow, row_id: number | null, dropped: string[]): ActionRowBuilder<MessageActionRowComponentBuilder> | null {
    if (r.type === "select") {
        const menu = buildSelect(r.select, row_id);
        if (!menu) {
            dropped.push(row_id === null ? "a dropdown (save the message first — a menu needs somewhere to look its roles up)" : "a dropdown with no finished options");
            return null;
        }
        return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(menu);
    }

    const buttons = r.buttons
        .slice(0, LIMITS.row_buttons)
        .map(b => buildButton(guild, b, row_id))
        .filter((b): b is ButtonBuilder => b !== null);
    const missing = r.buttons.length - buttons.length;
    if (missing > 0) dropped.push(`${missing} unfinished button${missing === 1 ? "" : "s"}`);
    if (!buttons.length) return null;

    return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(buttons);
}


// ---- embeds ---------------------------------------------------------------

function buildEmbed(e: MsgEmbed): EmbedBuilder | null {
    const fields = e.fields
        .filter(f => f.name.trim() && f.value.trim())
        .map(f => ({ name: f.name, value: f.value, inline: f.inline }));

    // Discord turns down an embed with nothing visible in it.
    const empty = !e.title.trim() && !e.description.trim() && !fields.length
        && !e.image && !e.thumbnail && !e.author.name && !e.footer.text;
    if (empty) return null;

    const embed = new EmbedBuilder();
    if (e.color) embed.setColor(hexToInt(e.color));
    if (e.title.trim()) embed.setTitle(e.title);
    // A URL without a title has nothing to hang itself on.
    if (e.url && e.title.trim()) embed.setURL(e.url);
    if (e.description.trim()) embed.setDescription(e.description);
    if (fields.length) embed.addFields(fields);
    if (e.image) embed.setImage(e.image);
    if (e.thumbnail) embed.setThumbnail(e.thumbnail);
    if (e.author.name) {
        embed.setAuthor({ name: e.author.name, url: e.author.url || undefined, iconURL: e.author.icon_url || undefined });
    }
    if (e.footer.text) {
        embed.setFooter({ text: e.footer.text, iconURL: e.footer.icon_url || undefined });
    }
    if (e.timestamp === "now") embed.setTimestamp(new Date());
    else if (e.timestamp === "custom" && e.timestamp_at) embed.setTimestamp(new Date(e.timestamp_at));

    return embed;
}


// ---- components v2 --------------------------------------------------------

function galleryItem(m: MsgMedia): MediaGalleryItemBuilder {
    const item = new MediaGalleryItemBuilder().setURL(m.url).setSpoiler(m.spoiler);
    if (m.alt) item.setDescription(m.alt);
    return item;
}

// Every piece a container will take. The top level takes these plus a
// container itself, which is why this is kept separate from buildTop below.
type Inner = TextDisplayBuilder | SectionBuilder | MediaGalleryBuilder | SeparatorBuilder | FileBuilder | ActionRowBuilder<MessageActionRowComponentBuilder>;

interface BuildCtx {
    guild: Guild;
    row_id: number | null;
    // Maps a file node's URL to the name it was uploaded under.
    files: Map<string, string>;
    dropped: string[];
}

function buildInner(n: MsgNode, ctx: BuildCtx): Inner | null {
    switch (n.type) {
        case "text": {
            if (!n.text.trim()) return null;
            return new TextDisplayBuilder().setContent(n.text);
        }

        case "section": {
            if (!n.text.trim()) return null;
            const section = new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(n.text));

            if (n.accessory === "button") {
                const button = buildButton(ctx.guild, n.button, ctx.row_id);
                if (!button) {
                    // A section must carry an accessory, so without one it
                    // degrades into the paragraph on its own rather than
                    // taking the text down with it.
                    ctx.dropped.push("a section's button (unfinished) — its text was kept on its own");
                    return new TextDisplayBuilder().setContent(n.text);
                }
                section.setButtonAccessory(button);
                return section;
            }

            if (!n.thumbnail.url) {
                ctx.dropped.push("a section's thumbnail (no image URL) — its text was kept on its own");
                return new TextDisplayBuilder().setContent(n.text);
            }
            const thumb = new ThumbnailBuilder().setURL(n.thumbnail.url).setSpoiler(n.thumbnail.spoiler);
            if (n.thumbnail.alt) thumb.setDescription(n.thumbnail.alt);
            return section.setThumbnailAccessory(thumb);
        }

        case "gallery": {
            const items = n.items.filter(i => i.url).slice(0, LIMITS.gallery_items);
            if (!items.length) {
                ctx.dropped.push("a gallery with no images");
                return null;
            }
            return new MediaGalleryBuilder().addItems(items.map(galleryItem));
        }

        case "separator":
            return new SeparatorBuilder()
                .setDivider(n.divider)
                .setSpacing(n.spacing === "large" ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small);

        case "row":
            return buildRow(ctx.guild, n.row, ctx.row_id, ctx.dropped);

        case "file": {
            const name = ctx.files.get(n.file.url);
            if (!name) {
                // Either there was no URL or the download failed; fetchFiles
                // has already said which in `dropped`.
                return null;
            }
            return new FileBuilder().setURL(`attachment://${name}`).setSpoiler(n.file.spoiler);
        }

        default:
            return null;
    }
}

function buildContainer(n: MsgNode, ctx: BuildCtx): ContainerBuilder | null {
    const container = new ContainerBuilder().setSpoiler(n.spoiler);
    if (n.accent) container.setAccentColor(hexToInt(n.accent));

    let used = 0;
    for (const child of n.children) {
        const built = buildInner(child, ctx);
        if (!built) continue;
        used++;

        if (built instanceof TextDisplayBuilder) container.addTextDisplayComponents(built);
        else if (built instanceof SectionBuilder) container.addSectionComponents(built);
        else if (built instanceof MediaGalleryBuilder) container.addMediaGalleryComponents(built);
        else if (built instanceof SeparatorBuilder) container.addSeparatorComponents(built);
        else if (built instanceof FileBuilder) container.addFileComponents(built);
        else container.addActionRowComponents(built);
    }

    if (!used) {
        ctx.dropped.push("an empty container");
        return null;
    }
    return container;
}

function buildNodes(nodes: MsgNode[], ctx: BuildCtx): (Inner | ContainerBuilder)[] {
    const out: (Inner | ContainerBuilder)[] = [];
    for (const n of nodes) {
        const built = n.type === "container" ? buildContainer(n, ctx) : buildInner(n, ctx);
        if (built) out.push(built);
    }
    return out;
}


// ---- files ----------------------------------------------------------------

// Everything the document wants uploaded, in the order it appears, so a
// failure can be reported against the block it came from.
function fileNodes(doc: MessageDoc): MsgMedia[] {
    if (doc.mode === "classic") return doc.attachments.filter(a => a.url);

    const out: MsgMedia[] = [];
    const walk = (nodes: MsgNode[]) => {
        for (const n of nodes) {
            if (n.type === "file" && n.file.url) out.push(n.file);
            if (n.type === "container") walk(n.children);
        }
    };
    walk(doc.nodes);
    return out;
}

// Discord will not take a URL as an attachment, so the bot has to fetch the
// bytes itself. Names are made unique because two attachments sharing one
// would collide in `attachment://`.
async function fetchFiles(guild: Guild, media: MsgMedia[], dropped: string[]): Promise<{ files: AttachmentBuilder[]; names: Map<string, string> }> {
    const files: AttachmentBuilder[] = [];
    const names = new Map<string, string>();
    const taken = new Set<string>();
    const limit = uploadLimit(guild);

    for (const m of media.slice(0, LIMITS.files)) {
        if (names.has(m.url)) continue;

        const got = await fetchAttachment(m.url, limit);
        if (!got) {
            dropped.push(`a file that couldn't be downloaded (${m.url.slice(0, 60)})`);
            continue;
        }

        let name = got.name;
        for (let n = 2; taken.has(name.toLowerCase()); n++) {
            const dot = got.name.lastIndexOf(".");
            name = dot > 0 ? `${got.name.slice(0, dot)}-${n}${got.name.slice(dot)}` : `${got.name}-${n}`;
        }
        taken.add(name.toLowerCase());
        names.set(m.url, name);

        const attachment = new AttachmentBuilder(got.buffer, { name });
        if (m.alt) attachment.setDescription(m.alt);
        // Components V2 marks a spoiler on the File component itself; a plain
        // attachment under a classic message is marked by its name.
        if (m.spoiler) attachment.setSpoiler(true);
        files.push(attachment);
    }

    return { files, names };
}


// ---- the message ----------------------------------------------------------

function allowedMentions(doc: MessageDoc) {
    const parse: ("everyone" | "roles" | "users")[] = [];
    if (doc.mentions.everyone) parse.push("everyone");
    if (doc.mentions.roles) parse.push("roles");
    if (doc.mentions.users) parse.push("users");
    return { parse };
}

// `row_id` is the saved message this document belongs to. Dropdowns need it to
// be findable again when somebody uses one; a preview of an unsaved draft can
// pass null and simply goes out without its menus.
export async function buildMessage(guild: Guild, doc: MessageDoc, row_id: number | null): Promise<BuiltMessage> {
    const dropped: string[] = [];

    const flags = doc.silent ? MessageFlags.SuppressNotifications : 0;
    const media = fileNodes(doc);
    const { files, names } = media.length ? await fetchFiles(guild, media, dropped) : { files: [], names: new Map<string, string>() };

    if (doc.mode === "v2") {
        if (countNodes(doc.nodes) > LIMITS.v2_total) {
            throw new MessageError(`That's more than the ${LIMITS.v2_total} components Discord allows in one message. Remove a few blocks.`);
        }
        if (countV2Text(doc.nodes) > LIMITS.v2_text) {
            throw new MessageError(`The text adds up to more than ${LIMITS.v2_text} characters, which is Discord's limit for this kind of message.`);
        }

        const components = buildNodes(doc.nodes, { guild, row_id, files: names, dropped });
        if (!components.length) throw new MessageError("There's nothing in this message yet.");
        if (components.length > LIMITS.v2_top) {
            throw new MessageError(`Only ${LIMITS.v2_top} blocks fit at the top level. Put some of them inside a container.`);
        }

        return {
            payload: {
                components,
                files,
                tts: doc.tts,
                flags: flags | MessageFlags.IsComponentsV2,
                allowedMentions: allowedMentions(doc)
            },
            dropped
        };
    }

    // Classic.
    const embeds: EmbedBuilder[] = [];
    for (const e of doc.embeds) {
        const built = buildEmbed(e);
        if (built) embeds.push(built);
        else dropped.push("an empty embed");
    }

    if (countEmbedText(doc.embeds) > LIMITS.embed_total) {
        throw new MessageError(`Embeds may hold ${LIMITS.embed_total} characters between them, and these are over it.`);
    }

    const components: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
    for (const r of doc.rows.slice(0, LIMITS.rows)) {
        const built = buildRow(guild, r, row_id, dropped);
        if (built) components.push(built);
    }

    const content = doc.content.trim();
    if (!content && !embeds.length && !components.length && !files.length) {
        throw new MessageError("There's nothing in this message yet.");
    }

    return {
        payload: {
            content: content || undefined,
            embeds,
            components,
            files,
            tts: doc.tts,
            flags: flags | (doc.suppress_embeds ? MessageFlags.SuppressEmbeds : 0),
            allowedMentions: allowedMentions(doc)
        },
        dropped
    };
}
