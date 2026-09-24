import {
    APIMessageTopLevelComponent, ButtonInteraction, ButtonStyle, GuildMember, MessageFlags,
    PermissionFlagsBits, Role, StringSelectMenuInteraction
} from "discord.js";
import { logActivity } from "../leveling/activity.js";
import { renderTemplate } from "../leveling/notify.js";
import { manageable } from "../leveling/roles.js";
import { CUSTOM_PREFIX } from "./build.js";
import { ButtonAfter, ButtonStyleName, MsgButton, newButton } from "./schema.js";
import { findButton, findSelect } from "./store.js";

// Answering the buttons and dropdowns inside a message built on the dashboard.
//
// What a press does is read back out of the saved draft every time, never
// baked into the custom id, so editing the message on the dashboard changes
// buttons that were posted weeks ago.
//
// The one thing worth being clear about: Discord gives every viewer the same
// components. There is no button that looks pressed to one person and fresh to
// everyone else. So a press has two separate halves — a reply, which is
// private to the presser by default, and an optional rewrite of the button
// itself, which everybody sees and therefore only makes sense once.

export function isBuilderComponent(custom_id: string): boolean {
    return custom_id.startsWith(`${CUSTOM_PREFIX}:`);
}

type AnyInteraction = ButtonInteraction | StringSelectMenuInteraction;

async function reply(interaction: AnyInteraction, content: string, ephemeral = true): Promise<void> {
    const payload = ephemeral ? { content, flags: MessageFlags.Ephemeral as const } : { content };
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
}

function note(member: GuildMember, text: string): void {
    logActivity({
        guild_id: member.guild.id,
        type: "roles",
        user_id: member.id,
        user_name: member.displayName,
        text
    });
}

function names(roles: Role[]): string {
    return roles.map(r => `**${r.name}**`).join(", ");
}


// ---- role changes ----------------------------------------------------------

interface RoleResult {
    added: Role[];
    removed: Role[];
    // Named rather than resolved, because the reason one was skipped is often
    // that the bot can't see far enough up the list to resolve it properly.
    skipped: string[];
}

// Giving somebody a role that carries Administrator is not something a button
// should ever do, whatever the hierarchy says — the bot's own top role can sit
// above one by accident, and a button that quietly makes anybody an admin is
// the kind of mistake nobody notices until it matters. Taking one away is only
// held to the hierarchy check, so "leave the staff team" still works.
function usable(member: GuildMember, role_id: string, giving: boolean): Role | null {
    const role = manageable(member, role_id);
    if (!role) return null;
    if (giving && role.permissions.has(PermissionFlagsBits.Administrator)) return null;
    return role;
}

async function applyRoles(member: GuildMember, b: MsgButton): Promise<RoleResult | null> {
    const has = (id: string) => member.roles.cache.has(id);

    // Toggle looks at whether they already have the lot: holding all of them
    // means the press takes them back, anything less means it tops them up.
    const holding = b.role_ids.length > 0 && b.role_ids.every(has);
    const give = b.role_mode === "remove" || (b.role_mode === "toggle" && holding) ? [] : b.role_ids;
    const take = b.role_mode === "remove" ? b.role_ids
        : b.role_mode === "toggle" && holding ? b.role_ids
        : b.remove_ids;

    const result: RoleResult = { added: [], removed: [], skipped: [] };

    for (const id of new Set(give)) {
        if (has(id)) continue;
        const role = usable(member, id, true);
        if (role) result.added.push(role);
        else result.skipped.push(member.guild.roles.cache.get(id)?.name ?? "a role");
    }
    for (const id of new Set(take)) {
        if (!has(id)) continue;
        const role = usable(member, id, false);
        if (role) result.removed.push(role);
        else result.skipped.push(member.guild.roles.cache.get(id)?.name ?? "a role");
    }

    try {
        if (result.added.length) await member.roles.add(result.added, "Message builder button");
        if (result.removed.length) await member.roles.remove(result.removed, "Message builder button");
    } catch (err) {
        console.error(`A message button's role change failed in ${member.guild.id}:`, err);
        return null;
    }

    for (const role of result.added) note(member, `Took @${role.name} from a message button`);
    for (const role of result.removed) note(member, `Lost @${role.name} from a message button`);
    return result;
}


// ---- what the presser is told ----------------------------------------------

function describe(b: MsgButton, member: GuildMember, result: RoleResult | null): string {
    const vars = {
        user: `<@${member.id}>`,
        name: member.displayName,
        server: member.guild.name,
        added: result ? names(result.added) : "",
        removed: result ? names(result.removed) : ""
    };

    if (b.reply_text.trim()) return renderTemplate(b.reply_text, vars).slice(0, 2000);
    // A decorative button says nothing at all; the press is simply swallowed.
    if (b.kind === "none") return "";
    if (!result) return "Done.";

    const lines: string[] = [];
    if (result.added.length) lines.push(`You now have ${names(result.added)}.`);
    if (result.removed.length) lines.push(`Took back ${names(result.removed)}.`);
    if (result.skipped.length) {
        lines.push(`I couldn't touch ${result.skipped.map(n => `**${n}**`).join(", ")} — ${result.skipped.length === 1 ? "it's" : "they're"} above me, or too powerful to hand out.`);
    }
    if (!lines.length) lines.push("Nothing to change — you already have exactly that.");
    return lines.join("\n").slice(0, 2000);
}


// ---- rewriting the button for everyone -------------------------------------

const STYLE_NUMBERS: Record<ButtonStyleName, ButtonStyle> = {
    primary: ButtonStyle.Primary,
    secondary: ButtonStyle.Secondary,
    success: ButtonStyle.Success,
    danger: ButtonStyle.Danger
};

// The posted message is the only honest record of its own state: button A may
// already have been pressed and changed, and rebuilding from the draft would
// quietly put it back. So the live components are patched in place instead,
// and nothing about a press has to be stored anywhere.
interface RawComponent {
    type: number;
    custom_id?: string;
    label?: string;
    style?: number;
    disabled?: boolean;
    components?: RawComponent[];
    accessory?: RawComponent;
}

function patch(node: RawComponent, custom_id: string, after: ButtonAfter): boolean {
    if (node.custom_id === custom_id) {
        if (after.label) node.label = after.label;
        if (after.style !== "keep") node.style = STYLE_NUMBERS[after.style];
        if (after.disable) node.disabled = true;
        return true;
    }
    // A button can also be the thing sitting down the right of a section.
    if (node.accessory && patch(node.accessory, custom_id, after)) return true;
    for (const child of node.components ?? []) {
        if (patch(child, custom_id, after)) return true;
    }
    return false;
}

function changesAnything(after: ButtonAfter): boolean {
    return after.mode === "everyone" && (Boolean(after.label) || after.style !== "keep" || after.disable);
}

async function rewrite(interaction: ButtonInteraction, after: ButtonAfter): Promise<void> {
    const message = interaction.message;
    const components = message.components.map(c => c.toJSON()) as unknown as RawComponent[];
    if (!components.some(c => patch(c, interaction.customId, after))) return;

    // An edit may only carry the flags Discord lets a message change after the
    // fact, and a Components V2 message has to keep saying that it is one.
    const flags: (MessageFlags.IsComponentsV2 | MessageFlags.SuppressEmbeds)[] = [];
    if (message.flags.has(MessageFlags.IsComponentsV2)) flags.push(MessageFlags.IsComponentsV2);
    if (message.flags.has(MessageFlags.SuppressEmbeds)) flags.push(MessageFlags.SuppressEmbeds);

    try {
        await interaction.update({ components: components as unknown as APIMessageTopLevelComponent[], flags });
    } catch (err) {
        // Two people pressing at once is the usual reason. The press itself
        // already worked, so this stays a log line rather than an apology.
        console.error(`Rewriting a message button failed in ${interaction.guildId}:`, err);
    }
}


// ---- a press ---------------------------------------------------------------

async function press(interaction: ButtonInteraction, b: MsgButton): Promise<void> {
    const member = interaction.member;
    // A message can be forwarded into a DM, where there is nobody to give a
    // role to. Saying so beats leaving the press hanging.
    if (!(member instanceof GuildMember)) {
        await reply(interaction, "This only works inside the server the message was posted in.");
        return;
    }

    let result: RoleResult | null = null;
    if (b.kind === "role") {
        result = await applyRoles(member, b);
        if (!result) {
            await reply(interaction, "Something went wrong changing your roles. Ask an admin to check my permissions.");
            return;
        }
    }

    // The button only changes for everybody once the press actually worked —
    // greying out a claim button that failed would leave nobody able to claim.
    if (changesAnything(b.after) && !result?.skipped.length) {
        await rewrite(interaction, b.after);
    }

    const text = describe(b, member, result);
    if (text.trim()) await reply(interaction, text, !b.reply_public);
    else if (!interaction.replied && !interaction.deferred) await interaction.deferUpdate().catch(() => {});
}


// ---- a dropdown setting a whole set ----------------------------------------

async function applySelection(interaction: StringSelectMenuInteraction, row_id: number, select_id: string): Promise<void> {
    const member = interaction.member;
    if (!(member instanceof GuildMember)) {
        await reply(interaction, "This only works inside the server the message was posted in.");
        return;
    }

    // The roles behind a menu are far too long to fit in a custom id, so the
    // menu is looked up from the message it belongs to. An edit on the
    // dashboard therefore takes effect on menus already posted, and a deleted
    // draft leaves them inert rather than wrong.
    const menu = findSelect(member.guild.id, row_id, select_id);
    if (!menu) {
        await reply(interaction, "This menu isn't set up any more. Ask an admin to repost it.");
        return;
    }

    const offered = [...new Set(menu.options.map(o => o.role_id).filter((id): id is string => Boolean(id)))];
    const wanted = new Set(interaction.values);
    const result: RoleResult = { added: [], removed: [], skipped: [] };

    for (const id of offered) {
        const has = member.roles.cache.has(id);
        const want = wanted.has(id);
        if (has === want) continue;

        const role = usable(member, id, want);
        if (!role) {
            result.skipped.push(member.guild.roles.cache.get(id)?.name ?? "a role");
            continue;
        }
        (want ? result.added : result.removed).push(role);
    }

    try {
        if (result.added.length) await member.roles.add(result.added, "Message builder menu");
        if (result.removed.length) await member.roles.remove(result.removed, "Message builder menu");
    } catch (err) {
        console.error(`A message menu's role change failed in ${member.guild.id}:`, err);
        await reply(interaction, "Something went wrong updating your roles. Ask an admin to check my permissions.");
        return;
    }

    for (const role of result.added) note(member, `Took @${role.name} from a message menu`);
    for (const role of result.removed) note(member, `Lost @${role.name} from a message menu`);

    const lines: string[] = [];
    if (result.added.length) lines.push(`Added ${names(result.added)}.`);
    if (result.removed.length) lines.push(`Removed ${names(result.removed)}.`);
    if (result.skipped.length) {
        lines.push(`I couldn't touch ${result.skipped.map(n => `**${n}**`).join(", ")} — ${result.skipped.length === 1 ? "it's" : "they're"} above me, or too powerful to hand out.`);
    }
    if (!lines.length) lines.push("Nothing to change — you already have exactly those.");

    await reply(interaction, lines.join("\n"));
}


// ---- routing ---------------------------------------------------------------

export async function handleBuilderButton(interaction: ButtonInteraction): Promise<void> {
    const [, kind, a, b] = interaction.customId.split(":");

    if (kind === "b" && a && b) {
        const button = findButton(interaction.guildId ?? "", Number(a), b);
        if (!button) {
            await reply(interaction, "This button isn't set up any more. Ask an admin to repost the message.");
            return;
        }
        await press(interaction, button);
        return;
    }

    // The one-role form, from before a button could do more than toggle one.
    if (kind === "role" && a) {
        await press(interaction, newButton({ kind: "role", role_mode: "toggle", role_ids: [a] }));
        return;
    }

    // A decorative button, or one whose shape this version doesn't know.
    // Acknowledge it rather than leaving a spinner on somebody's screen.
    await interaction.deferUpdate().catch(() => {});
}

export async function handleBuilderSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, kind, row, select_id] = interaction.customId.split(":");
    const row_id = Number(row);
    if (kind !== "sel" || !Number.isInteger(row_id) || !select_id) {
        await interaction.deferUpdate().catch(() => {});
        return;
    }
    await applySelection(interaction, row_id, select_id);
}
