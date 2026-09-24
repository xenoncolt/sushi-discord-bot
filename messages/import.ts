import {
    APIActionRowComponent, APIButtonComponent, APIComponentInContainer, APIComponentInMessageActionRow,
    APIEmbed, APIMessageComponentEmoji, APIMessageTopLevelComponent, APISectionComponent, ButtonStyle,
    ComponentType, Message,
    MessageFlags
} from "discord.js";
import { CUSTOM_PREFIX } from "./build.js";
import { findButton } from "./store.js";
import {
    ButtonStyleName, emptyDoc, MessageDoc, MsgButton, MsgEmbed, MsgMedia, MsgNode, MsgRow, newButton,
    newMedia, newNode, newRow, newSelect, sanitizeDoc, uid
} from "./schema.js";

// Reading a message the bot has already posted back into a document, so
// anything it sent — built here or not — can be picked up and edited on the
// dashboard afterwards.
//
// Not everything survives the round trip, and pretending otherwise would be
// worse than saying so: a button somebody else's code answers cannot be made
// to keep working from here, and an uploaded file is bytes Discord holds and
// will not hand back as a URL. Those come back as `warnings` for the dashboard
// to show before anything is overwritten.

export interface ImportedMessage {
    doc: MessageDoc;
    warnings: string[];
}

function intToHex(color: number | null | undefined): string {
    if (typeof color !== "number" || color <= 0) return "";
    return `#${(color & 0xffffff).toString(16).padStart(6, "0")}`;
}

const STYLE_NAMES: Partial<Record<ButtonStyle, ButtonStyleName>> = {
    [ButtonStyle.Primary]: "primary",
    [ButtonStyle.Secondary]: "secondary",
    [ButtonStyle.Success]: "success",
    [ButtonStyle.Danger]: "danger"
};

// Back into the form somebody would type into the builder: a custom emoji as
// <:name:id>, a plain one as itself.
function emojiText(emoji: APIMessageComponentEmoji | undefined): string {
    if (!emoji) return "";
    return emoji.id ? `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>` : emoji.name ?? "";
}

const JUMP_LINK = /^https:\/\/(?:\w+\.)?discord\.com\/channels\/(\d{15,21})\/(\d{15,21})\/?$/;


// ---- components -----------------------------------------------------------

function importButton(api: APIButtonComponent, guild_id: string, warnings: string[]): MsgButton {
    const base = newButton({
        label: "label" in api ? api.label ?? "" : "",
        emoji: "emoji" in api ? emojiText(api.emoji) : "",
        style: STYLE_NAMES[api.style] ?? "secondary",
        disabled: Boolean(api.disabled)
    });

    if (api.style === ButtonStyle.Link) {
        const url = "url" in api ? api.url : "";
        // A link into this same server is a channel button here, so moving the
        // channel later still leaves the button pointing at it.
        const jump = JUMP_LINK.exec(url);
        if (jump && jump[1] === guild_id) return { ...base, kind: "channel", channel_id: jump[2] };
        return { ...base, kind: "link", url };
    }

    const custom_id = "custom_id" in api ? api.custom_id : "";
    const parts = custom_id.split(":");
    if (parts[0] === CUSTOM_PREFIX) {
        // One of this builder's own. What it does lives in the draft it was
        // posted from, so it is copied back whole rather than guessed at from
        // how it looks.
        if (parts[1] === "b" && parts[2] && parts[3]) {
            const original = findButton(guild_id, Number(parts[2]), parts[3]);
            if (original) return { ...original, id: uid() };
        }
        // The one-role form, from before a button could do more than toggle.
        if (parts[1] === "role" && parts[2]) {
            return { ...base, kind: "role", role_mode: "toggle", role_ids: [parts[2]] };
        }
    }

    if (api.style !== ButtonStyle.Premium) {
        warnings.push(`The button “${base.label || custom_id}” is answered by something else, so it came in as a label that does nothing.`);
    }
    return { ...base, kind: "none", disabled: true };
}

function importRow(api: APIActionRowComponent<APIComponentInMessageActionRow>, guild_id: string, warnings: string[]): MsgRow | null {
    const first = api.components[0];
    if (!first) return null;

    if (first.type === ComponentType.Button) {
        const row = newRow("buttons");
        row.buttons = api.components
            .filter((c): c is APIButtonComponent => c.type === ComponentType.Button)
            .map(c => importButton(c, guild_id, warnings));
        return row.buttons.length ? row : null;
    }

    if (first.type === ComponentType.StringSelect) {
        const row = newRow("select");
        const select = newSelect();
        select.placeholder = first.placeholder ?? "";
        select.min = first.min_values ?? 0;
        select.max = first.max_values ?? 1;
        select.disabled = Boolean(first.disabled);
        select.options = first.options.map(o => ({
            id: uid(),
            label: o.label,
            description: o.description ?? "",
            emoji: emojiText(o.emoji),
            // Menus built here store a role id as the option's value; one from
            // anywhere else stores whatever its own code expects.
            role_id: /^\d{15,21}$/.test(o.value) ? o.value : null
        }));
        row.select = select;

        if (select.options.some(o => !o.role_id)) {
            warnings.push("A dropdown's options weren't roles, so they came in blank — pick a role for each one.");
        }
        return row;
    }

    warnings.push("A user, role or channel picker was left out: only the role dropdown can be rebuilt here.");
    return null;
}


// ---- components v2 --------------------------------------------------------

function importMedia(url: string, alt: string | null | undefined, spoiler: boolean | undefined, warnings: string[]): MsgMedia {
    const media = newMedia();
    media.alt = alt ?? "";
    media.spoiler = Boolean(spoiler);
    if (url.startsWith("attachment://")) {
        // Discord holds the bytes and will not hand them back as a fetchable
        // URL, so the block comes in empty rather than pointing at nothing.
        warnings.push(`“${url.slice("attachment://".length)}” was uploaded with the original message, so its block came in empty — give it a URL.`);
    } else {
        media.url = url;
    }
    return media;
}

function importSection(api: APISectionComponent, guild_id: string, warnings: string[]): MsgNode {
    const node = newNode("section");
    node.text = api.components.map(c => c.content).join("\n");

    const accessory = api.accessory;
    if (accessory.type === ComponentType.Button) {
        node.accessory = "button";
        node.button = importButton(accessory, guild_id, warnings);
    } else {
        node.accessory = "thumbnail";
        node.thumbnail = importMedia(accessory.media.url, accessory.description, accessory.spoiler, warnings);
    }
    return node;
}

function importInner(api: APIComponentInContainer, guild_id: string, warnings: string[]): MsgNode | null {
    switch (api.type) {
        case ComponentType.TextDisplay: {
            const node = newNode("text");
            node.text = api.content;
            return node;
        }
        case ComponentType.Section:
            return importSection(api, guild_id, warnings);
        case ComponentType.MediaGallery: {
            const node = newNode("gallery");
            node.items = api.items.map(i => importMedia(i.media.url, i.description, i.spoiler, warnings));
            return node;
        }
        case ComponentType.Separator: {
            const node = newNode("separator");
            node.divider = api.divider ?? true;
            node.spacing = api.spacing === 2 ? "large" : "small";
            return node;
        }
        case ComponentType.File: {
            const node = newNode("file");
            node.file = importMedia(api.file.url, null, api.spoiler, warnings);
            return node;
        }
        case ComponentType.ActionRow: {
            const row = importRow(api, guild_id, warnings);
            if (!row) return null;
            const node = newNode("row");
            node.row = row;
            return node;
        }
        default:
            return null;
    }
}

function importTop(api: APIMessageTopLevelComponent, guild_id: string, warnings: string[]): MsgNode | null {
    if (api.type === ComponentType.Container) {
        const node = newNode("container");
        node.accent = intToHex(api.accent_color);
        node.spoiler = Boolean(api.spoiler);
        node.children = api.components
            .map(c => importInner(c, guild_id, warnings))
            .filter((n): n is MsgNode => n !== null);
        return node;
    }
    return importInner(api as APIComponentInContainer, guild_id, warnings);
}


// ---- embeds ---------------------------------------------------------------

function importEmbed(api: APIEmbed): MsgEmbed {
    return {
        id: uid(),
        color: intToHex(api.color),
        author: {
            name: api.author?.name ?? "",
            url: api.author?.url ?? "",
            icon_url: api.author?.icon_url ?? ""
        },
        title: api.title ?? "",
        url: api.url ?? "",
        description: api.description ?? "",
        fields: (api.fields ?? []).map(f => ({ id: uid(), name: f.name, value: f.value, inline: Boolean(f.inline) })),
        image: api.image?.url ?? "",
        thumbnail: api.thumbnail?.url ?? "",
        footer: { text: api.footer?.text ?? "", icon_url: api.footer?.icon_url ?? "" },
        timestamp: api.timestamp ? "custom" : "none",
        timestamp_at: api.timestamp ?? ""
    };
}


// ---- the message ----------------------------------------------------------

export function docFromMessage(message: Message): ImportedMessage {
    const warnings: string[] = [];
    const doc = emptyDoc();
    const guild_id = message.guildId ?? "";
    const components = message.components.map(c => c.toJSON() as APIMessageTopLevelComponent);

    if (message.flags.has(MessageFlags.IsComponentsV2)) {
        doc.mode = "v2";
        doc.nodes = components
            .map(c => importTop(c, guild_id, warnings))
            .filter((n): n is MsgNode => n !== null);
    } else {
        doc.mode = "classic";
        doc.content = message.content;
        doc.embeds = message.embeds.map(e => importEmbed(e.toJSON() as APIEmbed));
        doc.rows = components
            .filter((c): c is APIActionRowComponent<APIComponentInMessageActionRow> => c.type === ComponentType.ActionRow)
            .map(c => importRow(c, guild_id, warnings))
            .filter((r): r is MsgRow => r !== null);
        doc.suppress_embeds = message.flags.has(MessageFlags.SuppressEmbeds);

        if (message.attachments.size) {
            warnings.push(`${message.attachments.size} uploaded file${message.attachments.size === 1 ? " was" : "s were"} left out — Discord's copies expire, so add them again by URL if you want them.`);
        }
    }

    doc.silent = message.flags.has(MessageFlags.SuppressNotifications);
    doc.tts = message.tts;
    // What the original was allowed to ping is not in the message itself, only
    // in who it actually pinged, so this starts from the safe default.
    doc.mentions = { everyone: false, roles: false, users: true };

    // Straight back through the sanitiser: the shapes above come from Discord
    // rather than from this codebase, and a field it stops sending one day
    // should leave a usable document rather than a broken one.
    return { doc: sanitizeDoc(doc), warnings };
}
