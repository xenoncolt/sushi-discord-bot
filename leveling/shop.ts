import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, ContainerBuilder, DiscordAPIError, Guild, GuildMember, MessageFlags, PermissionFlagsBits, RESTJSONErrorCodes } from "discord.js";
import { createLevelingTable } from "../schema/levelingDB.js";
import { logActivity } from "./activity.js";
import { getMember } from "./members.js";
import { resolveChannel, sendContainer } from "./notify.js";
import { getSettings } from "./settings.js";
import { isConnected } from "./uptime.js";
import { COLOR, fmt, text } from "./ui.js";
import { changeXp } from "./xp.js";


const db = createLevelingTable();

export type ShopItemType = "role" | "timed_role" | "item";

export interface ShopItem {
    id: number;
    guild_id: string;
    name: string;
    description: string;
    emoji: string;
    price: number;
    type: ShopItemType;
    role_id: string | null;
    duration_hours: number;
    stock: number;            // -1 = unlimited
    per_user_limit: number;   // 0 = unlimited
    enabled: number;
    sort: number;
    created_at: number;
}

export interface Purchase {
    id: number;
    guild_id: string;
    user_id: string;
    item_id: number;
    item_name: string;
    price: number;
    type: ShopItemType;
    role_id: string | null;
    // role: active | timed_role: active → expired | item: owned → requested → fulfilled | refunded
    status: "active" | "expired" | "owned" | "requested" | "fulfilled" | "refunded";
    expires_at: number | null;
    created_at: number;
    used_at: number | null;
    handled_by: string | null;
}

export function listItems(guild_id: string, include_disabled = false): ShopItem[] {
    return db.all<ShopItem[]>(
        `SELECT * FROM shop_items WHERE guild_id = ? ${include_disabled ? "" : "AND enabled = 1"} ORDER BY sort, price, id`,
        guild_id
    );
}

export function getItem(guild_id: string, id: number): ShopItem | undefined {
    return db.get<ShopItem>(`SELECT * FROM shop_items WHERE guild_id = ? AND id = ?`, guild_id, id);
}

export interface ItemInput {
    name: string;
    description: string;
    emoji: string;
    price: number;
    type: ShopItemType;
    role_id: string | null;
    duration_hours: number;
    stock: number;
    per_user_limit: number;
    enabled: boolean;
    sort: number;
}

export function sanitizeItem(raw: Record<string, unknown>): ItemInput | string {
    const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 80) : "";
    if (!name) return "Item needs a name.";
    const type = raw.type === "role" || raw.type === "timed_role" || raw.type === "item" ? raw.type : null;
    if (!type) return "Unknown item type.";
    const role_id = typeof raw.role_id === "string" && /^\d{15,21}$/.test(raw.role_id) ? raw.role_id : null;
    if (type !== "item" && !role_id) return "Pick the role this item gives.";
    const int = (v: unknown, min: number, max: number, def: number) => {
        const n = Math.trunc(Number(v));
        return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
    };
    const duration_hours = int(raw.duration_hours, 0, 24 * 365, 0);
    if (type === "timed_role" && duration_hours < 1) return "Timed roles need a duration of at least 1 hour.";
    return {
        name,
        description: typeof raw.description === "string" ? raw.description.slice(0, 300) : "",
        emoji: typeof raw.emoji === "string" ? raw.emoji.trim().slice(0, 32) : "",
        price: int(raw.price, 0, 1_000_000_000, 0),
        type,
        role_id: type === "item" ? null : role_id,
        duration_hours: type === "timed_role" ? duration_hours : 0,
        stock: int(raw.stock, -1, 1_000_000, -1),
        per_user_limit: int(raw.per_user_limit, 0, 1000, 0),
        enabled: raw.enabled !== false,
        sort: int(raw.sort, 0, 10_000, 0)
    };
}

export function createItem(guild_id: string, input: ItemInput): ShopItem {
    const r = db.run(
        `INSERT INTO shop_items (guild_id, name, description, emoji, price, type, role_id, duration_hours, stock, per_user_limit, enabled, sort, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        guild_id, input.name, input.description, input.emoji, input.price, input.type, input.role_id,
        input.duration_hours, input.stock, input.per_user_limit, input.enabled, input.sort, Date.now()
    );
    return getItem(guild_id, r.lastID)!;
}

export function updateItem(guild_id: string, id: number, input: ItemInput): ShopItem | undefined {
    db.run(
        `UPDATE shop_items SET name = ?, description = ?, emoji = ?, price = ?, type = ?, role_id = ?, duration_hours = ?,
            stock = ?, per_user_limit = ?, enabled = ?, sort = ? WHERE guild_id = ? AND id = ?`,
        input.name, input.description, input.emoji, input.price, input.type, input.role_id, input.duration_hours,
        input.stock, input.per_user_limit, input.enabled, input.sort, guild_id, id
    );
    return getItem(guild_id, id);
}

export function deleteItem(guild_id: string, id: number): void {
    db.run(`DELETE FROM shop_items WHERE guild_id = ? AND id = ?`, guild_id, id);
}

export function listPurchases(guild_id: string, opts: { user_id?: string; status?: string[]; limit?: number } = {}): Purchase[] {
    const where = [`guild_id = ?`];
    const params: unknown[] = [guild_id];
    if (opts.user_id) {
        where.push(`user_id = ?`);
        params.push(opts.user_id);
    }
    if (opts.status?.length) {
        where.push(`status IN (${opts.status.map(() => "?").join(",")})`);
        params.push(...opts.status);
    }
    params.push(opts.limit ?? 100);
    return db.all<Purchase[]>(`SELECT * FROM shop_purchases WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ?`, ...params);
}

export function getPurchase(guild_id: string, id: number): Purchase | undefined {
    return db.get<Purchase>(`SELECT * FROM shop_purchases WHERE guild_id = ? AND id = ?`, guild_id, id);
}

function roleIssue(guild: Guild, role_id: string | null): string | null {
    if (!role_id) return null;
    const role = guild.roles.cache.get(role_id);
    const me = guild.members.me;
    if (!role) return "The role for this item no longer exists. Please tell an admin.";
    if (!me?.permissions.has(PermissionFlagsBits.ManageRoles) || role.position >= me.roles.highest.position || role.managed) {
        return "I'm not allowed to hand out that role. An admin needs to move my role above it.";
    }
    return null;
}

export async function buyItem(member: GuildMember, item_id: number): Promise<{ ok: boolean; message: string }> {
    const guild = member.guild;
    const settings = getSettings(guild.id);
    const xp_name = settings.server.xp_name;
    const item = getItem(guild.id, item_id);

    if (!item || !item.enabled) return { ok: false, message: "That item isn't for sale any more." };
    if (item.stock === 0) return { ok: false, message: `**${item.name}** is sold out.` };

    if (item.per_user_limit > 0) {
        const owned = db.get<{ n: number }>(
            `SELECT COUNT(*) AS n FROM shop_purchases WHERE guild_id = ? AND user_id = ? AND item_id = ? AND status != 'refunded'`,
            guild.id, member.id, item.id
        )?.n ?? 0;
        if (owned >= item.per_user_limit) return { ok: false, message: `You can only buy **${item.name}** ${item.per_user_limit} time(s).` };
    }

    const issue = roleIssue(guild, item.role_id);
    if (issue) return { ok: false, message: issue };

    // Buying a timed role you already hold extends it instead of stacking.
    const active_timed = item.type === "timed_role"
        ? db.get<Purchase>(
            `SELECT * FROM shop_purchases WHERE guild_id = ? AND user_id = ? AND item_id = ? AND status = 'active' ORDER BY expires_at DESC LIMIT 1`,
            guild.id, member.id, item.id
        )
        : undefined;

    // A role they already hold some other way would be taken off them when a
    // timed purchase ran out, so that is refused too.
    if (item.role_id && !active_timed && member.roles.cache.has(item.role_id)) {
        return { ok: false, message: `You already have <@&${item.role_id}>.` };
    }

    const balance = getMember(guild.id, member.id).xp;
    if (balance < item.price) {
        return { ok: false, message: `**${item.name}** costs **${fmt(item.price)} ${xp_name}** but you only have **${fmt(balance)}**.` };
    }

    // Take the XP first; if the role then fails to apply it is refunded below.
    await changeXp(member, -item.price);
    if (item.stock > 0) db.run(`UPDATE shop_items SET stock = stock - 1 WHERE id = ? AND stock > 0`, item.id);

    const now = Date.now();
    let expires_at: number | null = null;
    let purchase_id: number;

    if (active_timed) {
        expires_at = Math.max(active_timed.expires_at ?? now, now) + item.duration_hours * 3_600_000;
        db.run(`UPDATE shop_purchases SET expires_at = ?, price = price + ? WHERE id = ?`, expires_at, item.price, active_timed.id);
        purchase_id = active_timed.id;
    } else {
        if (item.type === "timed_role") expires_at = now + item.duration_hours * 3_600_000;
        purchase_id = db.run(
            `INSERT INTO shop_purchases (guild_id, user_id, item_id, item_name, price, type, role_id, status, expires_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            guild.id, member.id, item.id, item.name, item.price, item.type, item.role_id,
            item.type === "item" ? "owned" : "active", expires_at, now
        ).lastID;
    }

    if (item.role_id && !member.roles.cache.has(item.role_id)) {
        try {
            await member.roles.add(item.role_id, `Bought "${item.name}" in the EXP shop`);
        } catch (err) {
            console.error(`Shop role grant failed for ${member.id}:`, err);
            await changeXp(member, item.price);
            if (item.stock > 0) db.run(`UPDATE shop_items SET stock = stock + 1 WHERE id = ?`, item.id);
            if (!active_timed) db.run(`UPDATE shop_purchases SET status = 'refunded' WHERE id = ?`, purchase_id);
            return { ok: false, message: "I couldn't give you the role, so your purchase was refunded." };
        }
    }

    logActivity({ guild_id: guild.id, type: "shop", user_id: member.id, user_name: member.displayName, text: `Bought ${item.name}`, amount: -item.price });

    // The purchase is already done at this point, so a failing log post must
    // not turn it into an error for the buyer.
    try {
        const log = await resolveChannel(member.client, settings.notifications.shop_log_channel);
        if (log) {
            await sendContainer(log, new ContainerBuilder().setAccentColor(COLOR.gold).addTextDisplayComponents(text([
                `### 🛍️ ${item.emoji ? `${item.emoji} ` : ""}${item.name}`,
                `<@${member.id}> bought this for **${fmt(item.price)} ${xp_name}**.`,
                expires_at ? `Expires <t:${Math.floor(expires_at / 1000)}:R>` : ""
            ].filter(Boolean).join("\n"))));
        }
    } catch (err) {
        console.error("Shop log post failed:", err);
    }

    const extra = item.type === "item"
        ? "It's in your inventory — press **Use** in `/shop` when you want an admin to fulfil it."
        : expires_at
            ? `<@&${item.role_id}> is yours until <t:${Math.floor(expires_at / 1000)}:f>.`
            : `<@&${item.role_id}> is yours.`;
    return { ok: true, message: `You bought **${item.name}** for **${fmt(item.price)} ${xp_name}**. ${extra}` };
}

// Custom items: the member asks for it to be fulfilled and admins get a
// request with Done / Refund buttons in the admin log channel.
export async function useItem(member: GuildMember, purchase_id: number): Promise<{ ok: boolean; message: string }> {
    const purchase = getPurchase(member.guild.id, purchase_id);
    if (!purchase || purchase.user_id !== member.id || purchase.status !== "owned") {
        return { ok: false, message: "That item isn't in your inventory." };
    }

    const settings = getSettings(member.guild.id);
    const channel = await resolveChannel(member.client, settings.notifications.shop_admin_channel);
    if (!channel) return { ok: false, message: "No admin log channel is set up yet, so nobody would see the request. Please tell an admin." };

    db.run(`UPDATE shop_purchases SET status = 'requested', used_at = ? WHERE id = ?`, Date.now(), purchase.id);

    const container = new ContainerBuilder()
        .setAccentColor(COLOR.pending)
        .addTextDisplayComponents(text([
            `### 📬 Benefit request #${purchase.id}`,
            `<@${member.id}> wants to use **${purchase.item_name}** (bought for ${fmt(purchase.price)} ${settings.server.xp_name}).`
        ].join("\n")))
        .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`shop:done:${purchase.id}`).setLabel("Mark fulfilled").setEmoji("✅").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`shop:refund:${purchase.id}`).setLabel("Refund").setEmoji("↩️").setStyle(ButtonStyle.Secondary)
        ));

    await channel.send({ components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
    logActivity({ guild_id: member.guild.id, type: "shop", user_id: member.id, user_name: member.displayName, text: `Requested ${purchase.item_name}` });
    return { ok: true, message: `Your request for **${purchase.item_name}** was sent to the admins.` };
}

export async function resolveRequest(guild: Guild, purchase_id: number, action: "done" | "refund", admin: GuildMember): Promise<string> {
    const purchase = getPurchase(guild.id, purchase_id);
    if (!purchase || purchase.status !== "requested") return "This request was already handled.";

    if (action === "refund") {
        const member = await guild.members.fetch(purchase.user_id).catch(() => null);
        if (member) await changeXp(member, purchase.price);
        db.run(`UPDATE shop_purchases SET status = 'refunded', handled_by = ? WHERE id = ?`, admin.id, purchase.id);
        logActivity({ guild_id: guild.id, type: "shop", user_id: purchase.user_id, user_name: member?.displayName ?? null, text: `Refunded ${purchase.item_name}`, amount: purchase.price, actor_id: admin.id, actor_name: admin.displayName });
        return `↩️ Refunded by <@${admin.id}>.`;
    }

    db.run(`UPDATE shop_purchases SET status = 'fulfilled', handled_by = ? WHERE id = ?`, admin.id, purchase.id);
    logActivity({ guild_id: guild.id, type: "shop", user_id: purchase.user_id, text: `${purchase.item_name} fulfilled`, actor_id: admin.id, actor_name: admin.displayName });
    return `✅ Fulfilled by <@${admin.id}>.`;
}

// Every minute: take timed roles back off. Failures go to the admin log so a
// role never silently stays on someone forever.
export async function expireTimedRoles(client: Client): Promise<void> {
    // Offline, the removals would fail. Expiry times are stored, so whatever
    // ran out meanwhile is picked up as soon as the bot is back.
    if (!isConnected(client)) return;

    const due = db.all<Purchase[]>(`SELECT * FROM shop_purchases WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?`, Date.now());
    const expire = (id: number) => db.run(`UPDATE shop_purchases SET status = 'expired' WHERE id = ?`, id);

    for (const p of due) {
        const guild = client.guilds.cache.get(p.guild_id);
        if (!guild) continue;

        // Discord saying "no such member" means they left: nothing to take
        // back. Any other failure (a network blip) is retried next minute.
        const member = await guild.members.fetch(p.user_id)
            .catch(err => err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownMember ? null : undefined);
        if (member === undefined) continue;
        if (!member || !p.role_id || !member.roles.cache.has(p.role_id)) {
            expire(p.id);
            continue;
        }

        try {
            await member.roles.remove(p.role_id, `EXP shop "${p.item_name}" expired`);
            expire(p.id);
            logActivity({ guild_id: guild.id, type: "shop", user_id: member.id, user_name: member.displayName, text: `${p.item_name} expired` });
        } catch (err) {
            if (!(err instanceof DiscordAPIError)) continue;
            // Discord refused (missing permission, role above the bot's), so
            // retrying won't help. Hand it to the admins.
            expire(p.id);
            console.error(`Timed role revoke failed for ${p.user_id}:`, err);
            const channel = await resolveChannel(client, getSettings(guild.id).notifications.shop_admin_channel);
            if (channel) {
                await sendContainer(channel, new ContainerBuilder().setAccentColor(COLOR.lose).addTextDisplayComponents(text(
                    `### ⚠️ Could not remove expired role\n<@${p.user_id}>'s **${p.item_name}** expired but I couldn't remove <@&${p.role_id}>. Please remove it by hand.`
                )));
            }
        }
    }
}
