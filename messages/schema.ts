import { bool, color, id, ids, num, obj, oneOf, str } from "../leveling/sanitize.js";

// The document behind a custom message: what the dashboard's builder edits,
// and what the bot turns into a real Discord message when somebody presses
// Send.
//
// Discord offers two shapes and refuses to mix them. A *classic* message is
// plain text, up to ten embeds and up to five rows of components. A
// *Components V2* message gives up content and embeds entirely in exchange for
// a tree of layout components — the only way to get a coloured container, an
// image beside a paragraph, or buttons in the middle of the text. `mode` picks
// which one is sent; both halves are kept in the document, so switching back
// and forth never loses the other one's work.


// ---- limits ---------------------------------------------------------------
// Discord's own, copied here so the builder can show a counter and the
// sanitiser can cut in the same place, rather than the API refusing the
// message after somebody has already pressed Send.

export const LIMITS = {
    content: 2000,

    embeds: 10,
    embed_title: 256,
    embed_description: 4096,
    embed_author: 256,
    embed_footer: 2048,
    embed_fields: 25,
    field_name: 256,
    field_value: 1024,
    // Across every embed on the message, counting title, description, fields,
    // footer and author name together.
    embed_total: 6000,

    rows: 5,
    row_buttons: 5,
    button_label: 80,
    // How many roles one button may hand out or take away at once. Well past
    // anything sensible, low enough that one press can't rewrite somebody's
    // whole role list.
    button_roles: 10,
    reply_text: 1500,
    select_placeholder: 150,
    select_options: 25,
    option_label: 100,
    option_description: 100,

    // A Components V2 message: ten things at the top level, forty components
    // in total once everything nested is counted, and four thousand
    // characters of text across the lot.
    v2_top: 10,
    v2_total: 40,
    v2_text: 4000,

    gallery_items: 10,
    // Files are fetched from a URL and uploaded with the message, so this is
    // both Discord's attachment limit and how many downloads one Send may do.
    files: 10,

    url: 1000,
    name: 80
} as const;


// ---- the pieces -----------------------------------------------------------

// A picture, or any other file, named by URL. Discord fetches the ones it
// shows itself (galleries, thumbnails, embed images); the ones that have to be
// real attachments are downloaded by the bot at send time.
export interface MsgMedia {
    id: string;
    url: string;
    // Shown on hover and read out by screen readers.
    alt: string;
    spoiler: boolean;
}

// What a button does when it is pressed.
//
// Discord only lets a button carry a URL when it is styled as a link, so
// "link" and "channel" always come out grey with an outbound arrow and ignore
// `style`. The other two are ordinary custom-id buttons the bot answers
// itself: "role" hands out or takes back a role, and "none" is a dead button
// used as a label.
export type ButtonKind = "link" | "channel" | "role" | "reply" | "none";
export type ButtonStyleName = "primary" | "secondary" | "success" | "danger";
export type RoleMode = "add" | "remove" | "toggle";

// What the posted message does to itself once a press has gone through.
//
// Discord gives every viewer the same components — there is no such thing as a
// button that looks pressed to one person and fresh to everybody else. So
// "everyone" really does mean everyone, which makes it right for a one-shot
// (claim the prize, close the thread) and wrong for anything repeatable. The
// per-person half of "the button changed" is the reply the presser gets, which
// only they see.
export interface ButtonAfter {
    mode: "nothing" | "everyone";
    // "" keeps whatever the button already said.
    label: string;
    // "keep" leaves the colour alone.
    style: ButtonStyleName | "keep";
    disable: boolean;
}

export interface MsgButton {
    id: string;
    kind: ButtonKind;
    label: string;
    emoji: string;
    style: ButtonStyleName;
    // Posted greyed out from the start.
    disabled: boolean;

    url: string;
    channel_id: string | null;

    // kind "role": which roles, and what pressing does to them. `remove_ids`
    // are taken away at the same time, which is how a set of buttons that are
    // meant to be exclusive (Yes / No, pick a team) works in one press.
    role_mode: RoleMode;
    role_ids: string[];
    remove_ids: string[];

    // What the presser is told. Empty means the bot describes what it did.
    // Placeholders: {user} {name} {added} {removed} {server}.
    reply_text: string;
    // Off is an ephemeral reply only the presser sees, which is almost always
    // what you want — a public one posts a new message to the channel every
    // single press.
    reply_public: boolean;

    after: ButtonAfter;
}

export interface MsgOption {
    id: string;
    label: string;
    description: string;
    emoji: string;
    role_id: string | null;
}

// A dropdown. Only the self-assign role menu exists so far: a plain list of
// roles somebody may give themselves, which is the one kind of menu that can
// be answered without the bot knowing anything else about the message.
export interface MsgSelect {
    id: string;
    kind: "role";
    placeholder: string;
    min: number;
    max: number;
    disabled: boolean;
    options: MsgOption[];
}

// One action row: up to five buttons, or a single dropdown. Discord will not
// take both in the same row.
export interface MsgRow {
    id: string;
    type: "buttons" | "select";
    buttons: MsgButton[];
    select: MsgSelect;
}

export interface MsgField {
    id: string;
    name: string;
    value: string;
    inline: boolean;
}

export interface MsgEmbed {
    id: string;
    // "" leaves the stripe off altogether.
    color: string;
    author: { name: string; url: string; icon_url: string };
    title: string;
    url: string;
    description: string;
    fields: MsgField[];
    image: string;
    thumbnail: string;
    footer: { text: string; icon_url: string };
    // "now" stamps the moment the message is sent; "custom" uses `timestamp_at`.
    timestamp: "none" | "now" | "custom";
    timestamp_at: string;
}

export type NodeType = "text" | "section" | "gallery" | "separator" | "row" | "file" | "container";

// One block of a Components V2 message. Every field lives on every node rather
// than in a union, because the builder binds straight to them: a block
// somebody switches from Text to Section should still have its paragraph when
// they switch back.
export interface MsgNode {
    id: string;
    type: NodeType;

    // "text", and the paragraph of a "section".
    text: string;

    // "section": exactly one thing sits down its right-hand side.
    accessory: "thumbnail" | "button";
    thumbnail: MsgMedia;
    button: MsgButton;

    // "gallery": one to ten pictures, laid out by Discord.
    items: MsgMedia[];

    // "separator": a visible line, or just breathing room.
    divider: boolean;
    spacing: "small" | "large";

    // "row"
    row: MsgRow;

    // "file": uploaded with the message rather than linked, so it lands as a
    // real attachment with a download button.
    file: MsgMedia;

    // "container": the bordered card. "" for no accent stripe.
    accent: string;
    spoiler: boolean;
    children: MsgNode[];
}

export interface MessageDoc {
    mode: "classic" | "v2";

    // Classic.
    content: string;
    embeds: MsgEmbed[];
    rows: MsgRow[];
    // Files posted under a classic message. The bot downloads each one when
    // the message goes out, so these end up as real uploads rather than links.
    attachments: MsgMedia[];

    // Components V2.
    nodes: MsgNode[];

    // Both.
    tts: boolean;
    // Posted without a ping sound and without lighting the channel up.
    silent: boolean;
    // Classic only: hides the automatic previews of links in the content.
    suppress_embeds: boolean;
    // Which mentions in the text may actually notify anybody. Off means the
    // mention still renders, it just doesn't ping.
    mentions: { everyone: boolean; roles: boolean; users: boolean };
}

// A saved message: the document plus where it was last posted, so the same
// draft can be edited in place afterwards.
export interface SavedMessage {
    id: number;
    guild_id: string;
    name: string;
    doc: MessageDoc;
    channel_id: string | null;
    message_id: string | null;
    created_at: number;
    updated_at: number;
}


// ---- defaults -------------------------------------------------------------

let counter = 0;

// Stable keys, so the builder can reorder and delete rows safely. Only ever
// generated on the bot's side for imports and new documents; anything the
// browser sends brings its own.
export function uid(): string {
    return `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function newButton(overrides: Partial<MsgButton> = {}): MsgButton {
    return {
        id: uid(),
        kind: "link",
        label: "",
        emoji: "",
        style: "secondary",
        disabled: false,
        url: "",
        channel_id: null,
        role_mode: "toggle",
        role_ids: [],
        remove_ids: [],
        reply_text: "",
        reply_public: false,
        after: { mode: "nothing", label: "", style: "keep", disable: false },
        ...overrides
    };
}

export function newSelect(): MsgSelect {
    return { id: uid(), kind: "role", placeholder: "Pick your roles", min: 0, max: 1, disabled: false, options: [] };
}

export function newRow(type: MsgRow["type"] = "buttons"): MsgRow {
    return { id: uid(), type, buttons: type === "buttons" ? [newButton()] : [], select: newSelect() };
}

export function newEmbed(): MsgEmbed {
    return {
        id: uid(),
        color: "#5865f2",
        author: { name: "", url: "", icon_url: "" },
        title: "",
        url: "",
        description: "",
        fields: [],
        image: "",
        thumbnail: "",
        footer: { text: "", icon_url: "" },
        timestamp: "none",
        timestamp_at: ""
    };
}

export function newMedia(): MsgMedia {
    return { id: uid(), url: "", alt: "", spoiler: false };
}

export function newNode(type: NodeType): MsgNode {
    return {
        id: uid(),
        type,
        text: type === "text" || type === "section" ? "New paragraph" : "",
        accessory: "thumbnail",
        thumbnail: newMedia(),
        button: newButton(),
        items: type === "gallery" ? [newMedia()] : [],
        divider: true,
        spacing: "small",
        row: newRow(),
        file: newMedia(),
        accent: "#5865f2",
        spoiler: false,
        children: type === "container" ? [newNode("text")] : []
    };
}

export function emptyDoc(): MessageDoc {
    return {
        mode: "v2",
        content: "",
        embeds: [],
        rows: [],
        attachments: [],
        nodes: [newNode("container")],
        tts: false,
        silent: false,
        suppress_embeds: false,
        mentions: { everyone: false, roles: false, users: true }
    };
}


// ---- sanitising -----------------------------------------------------------

const HTTPS = /^https:\/\/\S+$/;
const HTTP_ANY = /^https?:\/\/\S+$/;

// Discord fetches these itself and only speaks https. An unusable one is
// dropped rather than kept, so nothing halfway through a paste survives long
// enough to make the whole message bounce.
function url(v: unknown, secure = true): string {
    const raw = str(v, "", LIMITS.url).trim();
    return (secure ? HTTPS : HTTP_ANY).test(raw) ? raw : "";
}

// An empty colour means "no accent at all", which is a different thing from
// the default colour, so this one cannot fall back to a default.
function optionalColor(v: unknown): string {
    return color(v, "");
}

function key(v: unknown, i: number, prefix: string): string {
    return str(v, "", 40).trim() || `${prefix}${i}`;
}

function media(v: unknown, i = 0): MsgMedia {
    const o = obj(v);
    return {
        id: key(o.id, i, "m"),
        url: url(o.url),
        alt: str(o.alt, "", 256).trim(),
        spoiler: bool(o.spoiler, false)
    };
}

const STYLE_NAMES = ["primary", "secondary", "success", "danger"] as const;

function after(v: unknown): ButtonAfter {
    const o = obj(v);
    return {
        mode: oneOf(o.mode, ["nothing", "everyone"] as const, "nothing"),
        label: str(o.label, "", LIMITS.button_label).trim(),
        style: oneOf(o.style, ["keep", ...STYLE_NAMES] as const, "keep"),
        disable: bool(o.disable, false)
    };
}

function button(v: unknown, i = 0): MsgButton {
    const o = obj(v);
    // Buttons saved before one could carry several roles kept a single
    // `role_id`. Converted rather than dropped, so nothing anybody already
    // posted stops working.
    const roles = o.role_ids === undefined && o.role_id !== undefined
        ? ids([o.role_id], [], LIMITS.button_roles)
        : ids(o.role_ids, [], LIMITS.button_roles);

    return {
        id: key(o.id, i, "b"),
        kind: oneOf(o.kind, ["link", "channel", "role", "reply", "none"] as const, "link"),
        // Half-filled buttons are kept rather than dropped: the builder saves
        // while somebody is still typing, and one vanishing under the cursor
        // is worse than an unfinished one sitting in the draft. The send step
        // leaves out anything still incomplete.
        label: str(o.label, "", LIMITS.button_label).trim(),
        emoji: str(o.emoji, "", 64).trim(),
        style: oneOf(o.style, STYLE_NAMES, "secondary"),
        disabled: bool(o.disabled, false),
        url: url(o.url, false),
        channel_id: id(o.channel_id, null),
        role_mode: oneOf(o.role_mode, ["add", "remove", "toggle"] as const, "toggle"),
        role_ids: roles,
        // A role on both lists would be given and taken away in the same
        // press, so the giving side wins.
        remove_ids: ids(o.remove_ids, [], LIMITS.button_roles).filter(r => !roles.includes(r)),
        reply_text: str(o.reply_text, "", LIMITS.reply_text),
        reply_public: bool(o.reply_public, false),
        after: after(o.after)
    };
}

function option(v: unknown, i: number): MsgOption {
    const o = obj(v);
    return {
        id: key(o.id, i, "o"),
        label: str(o.label, "", LIMITS.option_label).trim(),
        description: str(o.description, "", LIMITS.option_description).trim(),
        emoji: str(o.emoji, "", 64).trim(),
        role_id: id(o.role_id, null)
    };
}

function select(v: unknown, i = 0): MsgSelect {
    const o = obj(v);
    const options = (Array.isArray(o.options) ? o.options : []).slice(0, LIMITS.select_options).map(option);
    return {
        id: key(o.id, i, "s"),
        kind: "role",
        placeholder: str(o.placeholder, "", LIMITS.select_placeholder).trim(),
        min: num(o.min, 0, 0, LIMITS.select_options),
        // Asking for more picks than there are options is refused by Discord,
        // so the ceiling follows the list.
        max: num(o.max, 1, 1, Math.max(1, options.length || LIMITS.select_options)),
        disabled: bool(o.disabled, false),
        options
    };
}

function row(v: unknown, i = 0): MsgRow {
    const o = obj(v);
    return {
        id: key(o.id, i, "r"),
        type: oneOf(o.type, ["buttons", "select"] as const, "buttons"),
        buttons: (Array.isArray(o.buttons) ? o.buttons : []).slice(0, LIMITS.row_buttons).map(button),
        select: select(o.select, i)
    };
}

function field(v: unknown, i: number): MsgField {
    const o = obj(v);
    return {
        id: key(o.id, i, "f"),
        name: str(o.name, "", LIMITS.field_name),
        value: str(o.value, "", LIMITS.field_value),
        inline: bool(o.inline, false)
    };
}

function embed(v: unknown, i: number): MsgEmbed {
    const o = obj(v);
    const author = obj(o.author);
    const footer = obj(o.footer);
    const at = str(o.timestamp_at, "", 40).trim();
    return {
        id: key(o.id, i, "e"),
        color: optionalColor(o.color),
        author: {
            name: str(author.name, "", LIMITS.embed_author).trim(),
            url: url(author.url, false),
            icon_url: url(author.icon_url)
        },
        title: str(o.title, "", LIMITS.embed_title),
        url: url(o.url, false),
        description: str(o.description, "", LIMITS.embed_description),
        fields: (Array.isArray(o.fields) ? o.fields : []).slice(0, LIMITS.embed_fields).map(field),
        image: url(o.image),
        thumbnail: url(o.thumbnail),
        footer: {
            text: str(footer.text, "", LIMITS.embed_footer).trim(),
            icon_url: url(footer.icon_url)
        },
        timestamp: oneOf(o.timestamp, ["none", "now", "custom"] as const, "none"),
        timestamp_at: Number.isFinite(Date.parse(at)) ? at : ""
    };
}

// Containers may not hold containers, so `depth` stops a crafted document
// nesting them; one at the wrong depth becomes a plain text block instead.
function node(v: unknown, i: number, depth: number): MsgNode {
    const o = obj(v);
    let type = oneOf(o.type, ["text", "section", "gallery", "separator", "row", "file", "container"] as const, "text");
    if (type === "container" && depth > 0) type = "text";

    const children = type === "container" && Array.isArray(o.children)
        ? o.children.slice(0, LIMITS.v2_total).map((c, ci) => node(c, ci, depth + 1))
        : [];

    return {
        id: key(o.id, i, "n"),
        type,
        text: str(o.text, "", LIMITS.v2_text),
        accessory: oneOf(o.accessory, ["thumbnail", "button"] as const, "thumbnail"),
        thumbnail: media(o.thumbnail),
        button: button(o.button),
        items: (Array.isArray(o.items) ? o.items : []).slice(0, LIMITS.gallery_items).map(media),
        divider: bool(o.divider, true),
        spacing: oneOf(o.spacing, ["small", "large"] as const, "small"),
        row: row(o.row),
        file: media(o.file),
        accent: optionalColor(o.accent),
        spoiler: bool(o.spoiler, false),
        children
    };
}

export function sanitizeDoc(v: unknown): MessageDoc {
    const o = obj(v);
    const d = emptyDoc();
    const mentions = obj(o.mentions);

    return {
        mode: oneOf(o.mode, ["classic", "v2"] as const, d.mode),
        content: str(o.content, "", LIMITS.content),
        embeds: (Array.isArray(o.embeds) ? o.embeds : []).slice(0, LIMITS.embeds).map(embed),
        rows: (Array.isArray(o.rows) ? o.rows : []).slice(0, LIMITS.rows).map(row),
        attachments: (Array.isArray(o.attachments) ? o.attachments : []).slice(0, LIMITS.files).map(media),
        nodes: (Array.isArray(o.nodes) ? o.nodes : d.nodes).slice(0, LIMITS.v2_top).map((n, i) => node(n, i, 0)),
        tts: bool(o.tts, false),
        silent: bool(o.silent, false),
        suppress_embeds: bool(o.suppress_embeds, false),
        mentions: {
            everyone: bool(mentions.everyone, false),
            roles: bool(mentions.roles, false),
            users: bool(mentions.users, true)
        }
    };
}

export function sanitizeName(v: unknown, fallback = "Untitled message"): string {
    return str(v, "", LIMITS.name).trim() || fallback;
}


// ---- counting -------------------------------------------------------------
// Both the builder and the send step need these, and a disagreement between
// the two would show up as a message that looks fine and then bounces.

export function countRow(r: MsgRow): number {
    return 1 + (r.type === "buttons" ? r.buttons.length : 1);
}

export function countNode(n: MsgNode): number {
    switch (n.type) {
        // The paragraph and the thing beside it are components of their own.
        case "section": return 3;
        case "row": return countRow(n.row);
        case "container": return 1 + n.children.reduce((sum, c) => sum + countNode(c), 0);
        // A gallery's pictures are items rather than components, so a gallery
        // counts as one however many are in it.
        default: return 1;
    }
}

export function countNodes(nodes: MsgNode[]): number {
    return nodes.reduce((sum, n) => sum + countNode(n), 0);
}

// Every character Discord counts towards the four thousand a Components V2
// message may carry.
export function countV2Text(nodes: MsgNode[]): number {
    let total = 0;
    for (const n of nodes) {
        if (n.type === "text" || n.type === "section") total += n.text.length;
        if (n.type === "container") total += countV2Text(n.children);
    }
    return total;
}

export function countEmbedText(embeds: MsgEmbed[]): number {
    let total = 0;
    for (const e of embeds) {
        total += e.title.length + e.description.length + e.footer.text.length + e.author.name.length;
        for (const f of e.fields) total += f.name.length + f.value.length;
    }
    return total;
}

// Files are downloaded one by one when the message goes out, so the builder
// shows how many a Send would fetch.
function countNodeFiles(nodes: MsgNode[]): number {
    let total = 0;
    for (const n of nodes) {
        if (n.type === "file" && n.file.url) total++;
        if (n.type === "container") total += countNodeFiles(n.children);
    }
    return total;
}

export function countFiles(doc: MessageDoc): number {
    return doc.mode === "v2"
        ? countNodeFiles(doc.nodes)
        : doc.attachments.filter(a => a.url).length;
}
