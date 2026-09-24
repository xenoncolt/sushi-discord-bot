import { ChannelType, Client, Guild, GuildMember, GuildTextBasedChannel, Message, MessageEditOptions, MessageFlags, PermissionFlagsBits } from "discord.js";
import { IncomingMessage, ServerResponse } from "node:http";
import { sendAnnouncement } from "../birthday/announce.js";
import { refreshPanel, syncPanels } from "../birthday/panel.js";
import { getBirthday, parseBirthday, removeBirthday, setBirthday, upcomingBirthdays } from "../birthday/store.js";
import { buildMessage, MessageError } from "../messages/build.js";
import { docFromMessage } from "../messages/import.js";
import { SavedMessage } from "../messages/schema.js";
import { createMessage, deleteMessage, getMessage, listMessages, rememberPost, updateMessage } from "../messages/store.js";
import { createLevelingTable } from "../schema/levelingDB.js";
import { ActivityType, listActivity, logActivity } from "../leveling/activity.js";
import { xpForLevel } from "../leveling/formula.js";
import { BOARD_TYPES, BoardEntry, BoardType, boardPage, displayOf, updateChannelBoards } from "../leveling/leaderboard.js";
import { applyXp, getMember, liveMonthXp, liveStreak, MemberRow, recomputeLevels, setXp } from "../leveling/members.js";
import { buildTemplate, memberVars, resolveChannel, sendContainer } from "../leveling/notify.js";
import { isManager, isServerAdmin } from "../leveling/perms.js";
import { rememberPrefix } from "../leveling/prefix.js";
import { getSeason, listSeasons, rescheduleSeason, runSeasonReset } from "../leveling/season.js";
import { GuildSettings, SECTIONS, SettingsSection, getSettings, getState, resetSettings, updateSection, welcomeCard } from "../leveling/settings.js";
import { buyItem, createItem, deleteItem, getItem, listItems, listPurchases, sanitizeItem, updateItem, useItem } from "../leveling/shop.js";
import { getStats } from "../leveling/stats.js";
import { zonedParts } from "../leveling/time.js";
import { fmt } from "../leveling/ui.js";
import { afterLevelChange, profileOf } from "../leveling/xp.js";
import { renderWelcomeCard } from "../welcome/card.js";
import { cardDataFor, sendWelcome, welcomeVars } from "../welcome/send.js";
import { ApplicationEditError, createQuestion, deleteQuestion, getApplicationSettings, listQuestions, rememberPanelMessage, reorderQuestions, saveApplicationSettings, updateQuestion } from "../utils/applicationAdmin.js";
import { PANEL_DEFAULTS, syncApplicationPanel } from "../utils/applicationFlow.js";
import { OAuthGuild, Session, getSession, inviteUrl, loginEnabled, logout } from "./auth.js";
import { HttpError, json, readJson } from "./http.js";


const db = createLevelingTable();

type Access = "admin" | "manager";

interface Ctx {
    client: Client;
    req: IncomingMessage;
    res: ServerResponse;
    params: string[];
    query: URLSearchParams;
}

type Handler = (ctx: Ctx) => Promise<unknown> | unknown;

const routes: { method: string; pattern: RegExp; handler: Handler }[] = [];

function route(method: string, path: string, handler: Handler): void {
    const pattern = new RegExp("^" + path.replace(/:(\w+)/g, "([^/]+)") + "/?$");
    routes.push({ method, pattern, handler });
}

// ---- access ------------------------------------------------------------------

function requireSession(ctx: Ctx): Session {
    const s = getSession(ctx.req);
    if (!s) throw new HttpError(401, "Please log in with Discord.");
    return s;
}

function accessFor(member: GuildMember | undefined | null): Access | null {
    if (!member) return null;
    if (isServerAdmin(member)) return "admin";
    if (isManager(member)) return "manager";
    return null;
}

async function memberOf(guild: Guild, user_id: string): Promise<GuildMember | null> {
    return guild.members.cache.get(user_id) ?? await guild.members.fetch(user_id).catch(() => null);
}

async function guildAccess(ctx: Ctx, need: Access = "manager"): Promise<{ guild: Guild; session: Session; member: GuildMember; access: Access }> {
    const session = requireSession(ctx);
    const guild = ctx.client.guilds.cache.get(ctx.params[0]);
    if (!guild) throw new HttpError(404, "The bot isn't in that server.");
    const member = await memberOf(guild, session.user_id);
    const access = accessFor(member);
    if (!member || !access) throw new HttpError(403, "You don't have access to this server's dashboard.");
    if (need === "admin" && access !== "admin") throw new HttpError(403, "Only server admins (Manage Server) can do this.");
    return { guild, session, member, access };
}

function publicGuild(ctx: Ctx): Guild {
    const guild = ctx.client.guilds.cache.get(ctx.params[0]);
    if (!guild) throw new HttpError(404, "Unknown server.");
    return guild;
}

function num(v: unknown, name: string): number {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new HttpError(400, `${name} must be a number.`);
    return Math.trunc(n);
}

function obj(v: unknown): Record<string, unknown> {
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new HttpError(400, "Expected an object.");
    return v as Record<string, unknown>;
}

// Autosave fires often; one activity line per person per page per minute is
// plenty to answer "who changed this".
const last_settings_log = new Map<string, number>();
function logSettings(guild_id: string, member: GuildMember, section: string): void {
    const key = `${guild_id}|${member.id}|${section}`;
    if (Date.now() - (last_settings_log.get(key) ?? 0) < 60_000) return;
    last_settings_log.set(key, Date.now());
    logActivity({ guild_id, type: "settings", text: `Updated ${section} settings`, actor_id: member.id, actor_name: member.displayName, user_id: member.id, user_name: member.displayName });
}


// ---- session & guild list -------------------------------------------------------

route("GET", "/api/me", ctx => {
    const s = getSession(ctx.req);
    return {
        login_enabled: loginEnabled(),
        invite_url: ctx.client.user ? inviteUrl(ctx.client) : null,
        bot: ctx.client.user ? { id: ctx.client.user.id, name: ctx.client.user.username, avatar: ctx.client.user.displayAvatarURL({ size: 128 }) } : null,
        user: s ? {
            id: s.user_id,
            username: s.username,
            global_name: s.global_name,
            avatar: s.avatar ? `https://cdn.discordapp.com/avatars/${s.user_id}/${s.avatar}.png?size=128` : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(s.user_id) >> 22n) % 6}.png`
        } : null
    };
});

route("POST", "/api/auth/logout", ctx => {
    logout(ctx.req, ctx.res);
    return { ok: true };
});

route("GET", "/api/guilds", async ctx => {
    const s = requireSession(ctx);
    const manageable = [];
    for (const guild of ctx.client.guilds.cache.values()) {
        const access = accessFor(await memberOf(guild, s.user_id));
        if (access) manageable.push({ id: guild.id, name: guild.name, icon: guild.iconURL({ size: 128 }), access, member_count: guild.memberCount });
    }

    // Servers the user could add the bot to (Manage Server, bot not there yet).
    let invitable: { id: string; name: string; icon: string | null; invite_url: string }[] = [];
    try {
        invitable = (JSON.parse(s.guilds) as OAuthGuild[])
            .filter(g => !ctx.client.guilds.cache.has(g.id) && (g.owner || (BigInt(g.permissions) & (PermissionFlagsBits.ManageGuild | PermissionFlagsBits.Administrator)) !== 0n))
            .map(g => ({
                id: g.id,
                name: g.name,
                icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=128` : null,
                invite_url: inviteUrl(ctx.client, g.id)
            }));
    } catch {
        // An unreadable guild list only hides the invite section.
    }

    return { manageable: manageable.sort((a, b) => a.name.localeCompare(b.name)), invitable };
});

route("GET", "/api/guilds/:id", async ctx => {
    const { guild, access } = await guildAccess(ctx);
    const me = guild.members.me;
    return {
        id: guild.id,
        name: guild.name,
        icon: guild.iconURL({ size: 128 }),
        member_count: guild.memberCount,
        access,
        bot: {
            can_manage_roles: me?.permissions.has(PermissionFlagsBits.ManageRoles) ?? false,
            highest_role: me?.roles.highest.position ?? 0
        }
    };
});

const CHANNEL_KIND: Partial<Record<ChannelType, string>> = {
    [ChannelType.GuildText]: "text",
    [ChannelType.GuildAnnouncement]: "announcement",
    [ChannelType.GuildVoice]: "voice",
    [ChannelType.GuildStageVoice]: "stage",
    [ChannelType.GuildCategory]: "category",
    [ChannelType.GuildForum]: "forum"
};

route("GET", "/api/guilds/:id/channels", async ctx => {
    const { guild } = await guildAccess(ctx);
    return guild.channels.cache
        .filter(c => CHANNEL_KIND[c.type] !== undefined)
        .map(c => ({
            id: c.id,
            name: c.name,
            type: CHANNEL_KIND[c.type]!,
            parent_id: "parentId" in c ? c.parentId : null,
            position: "rawPosition" in c ? c.rawPosition : 0
        }))
        .sort((a, b) => a.position - b.position);
});

route("GET", "/api/guilds/:id/roles", async ctx => {
    const { guild } = await guildAccess(ctx);
    const me = guild.members.me;
    return guild.roles.cache
        .filter(r => r.id !== guild.id)
        .sort((a, b) => b.position - a.position)
        .map(r => ({
            id: r.id,
            name: r.name,
            color: r.hexColor === "#000000" ? null : r.hexColor,
            position: r.position,
            managed: r.managed,
            assignable: !r.managed && !!me && me.permissions.has(PermissionFlagsBits.ManageRoles) && r.position < me.roles.highest.position
        }));
});


// ---- settings -------------------------------------------------------------------

function settingsPayload(guild_id: string): GuildSettings & { meta: Record<string, unknown> } {
    const next = getState(guild_id, "season_next");
    return { ...getSettings(guild_id), meta: { season_next: next ? Number(next) : null } };
}

route("GET", "/api/guilds/:id/settings", async ctx => {
    const { guild } = await guildAccess(ctx);
    return settingsPayload(guild.id);
});

route("PATCH", "/api/guilds/:id/settings/:section", async ctx => {
    const section = ctx.params[1] as SettingsSection;
    if (!SECTIONS.includes(section)) throw new HttpError(404, "Unknown settings section.");
    const { guild, member } = await guildAccess(ctx, section === "roles" ? "admin" : "manager");

    const before = getSettings(guild.id);
    const body = await readJson(ctx.req);
    const after = updateSection(guild.id, section, body);

    if (section === "server") {
        const f0 = before.server.formula, f1 = after.server.formula;
        if (f0.multiplier !== f1.multiplier || f0.offset !== f1.offset || f0.divider !== f1.divider) recomputeLevels(guild.id);
        if (before.server.timezone !== after.server.timezone) rescheduleSeason(guild.id);
    }
    if (section === "season") rescheduleSeason(guild.id);
    if (section === "level" && before.level.prefix !== after.level.prefix) rememberPrefix(guild.id, before.level.prefix);
    if (section === "leaderboard") {
        updateChannelBoards(ctx.client, guild.id).catch(err => console.error("Leaderboard refresh failed:", err));
    }
    // Covers the channel being changed or cleared and the card being edited;
    // syncPanels takes the old panel down before putting the new one up.
    if (section === "birthday") {
        syncPanels(ctx.client, guild.id).catch(err => console.error("Birthday panel refresh failed:", err));
    }

    logSettings(guild.id, member, section);
    return settingsPayload(guild.id);
});


// ---- members / XP management (Level page) -------------------------------------------

function memberJson(guild: Guild, row: MemberRow, tz: string) {
    return {
        user_id: row.user_id,
        ...displayOf(guild, row),
        in_server: guild.members.cache.has(row.user_id),
        xp: row.xp,
        level: row.level,
        month_xp: liveMonthXp(row, tz),
        att_total: row.att_total,
        att_streak: liveStreak(row, tz)
    };
}

route("GET", "/api/guilds/:id/members", async ctx => {
    const { guild } = await guildAccess(ctx);
    const tz = getSettings(guild.id).server.timezone;
    const q = (ctx.query.get("q") ?? "").trim().toLowerCase();
    const page = Math.max(1, Number(ctx.query.get("page")) || 1);
    const per = 25;

    if (q) {
        // Search both people with XP and people who haven't earned any yet.
        const ids = new Set<string>();
        for (const m of guild.members.cache.values()) {
            if (m.user.bot) continue;
            if (m.displayName.toLowerCase().includes(q) || m.user.username.toLowerCase().includes(q) || m.id === q) ids.add(m.id);
        }
        const like = `%${q.replace(/[\\%_]/g, c => `\\${c}`)}%`;
        for (const r of db.all<{ user_id: string }[]>(`SELECT user_id FROM members WHERE guild_id = ? AND LOWER(name) LIKE ? ESCAPE '\\'`, guild.id, like)) ids.add(r.user_id);

        const rows = [...ids].map(id => getMember(guild.id, id)).sort((a, b) => b.xp - a.xp);
        return { total: rows.length, page: 1, pages: 1, members: rows.slice(0, 100).map(r => memberJson(guild, r, tz)) };
    }

    const total = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM members WHERE guild_id = ?`, guild.id)?.n ?? 0;
    const rows = db.all<MemberRow[]>(`SELECT * FROM members WHERE guild_id = ? ORDER BY xp DESC, user_id LIMIT ? OFFSET ?`, guild.id, per, (page - 1) * per);
    return { total, page, pages: Math.max(1, Math.ceil(total / per)), members: rows.map(r => memberJson(guild, r, tz)) };
});

route("POST", "/api/guilds/:id/members/:uid/xp", async ctx => {
    const { guild, member: actor } = await guildAccess(ctx);
    const user_id = ctx.params[1];
    if (!/^\d{15,21}$/.test(user_id)) throw new HttpError(400, "Bad user id.");

    const body = obj(await readJson(ctx.req));
    const settings = getSettings(guild.id);
    const value = Math.max(0, num(body.value, "value"));
    const target = await memberOf(guild, user_id);
    const profile = target ? profileOf(target) : undefined;
    const before = getMember(guild.id, user_id);

    let result;
    let text: string;
    switch (body.mode) {
        case "set_xp":
            result = setXp(guild.id, user_id, value, profile);
            text = `XP set to ${fmt(value)}`;
            break;
        case "set_level":
            result = setXp(guild.id, user_id, xpForLevel(value, settings.server.formula), profile);
            text = `Adjusted to level ${value}`;
            break;
        case "add":
            result = applyXp(guild.id, user_id, value, profile);
            text = `+${fmt(value)} ${settings.server.xp_name} (admin)`;
            break;
        case "remove":
            result = applyXp(guild.id, user_id, -value, profile);
            text = `-${fmt(result.old_xp - result.xp)} ${settings.server.xp_name} (admin)`;
            break;
        default:
            throw new HttpError(400, "mode must be set_xp, set_level, add or remove.");
    }

    if (target) {
        afterLevelChange(target, before.level, result.level, result.xp, { quiet: true }).catch(() => {});
    }
    logActivity({
        guild_id: guild.id,
        type: body.mode === "set_level" ? "level" : "xp",
        user_id,
        user_name: target?.displayName ?? before.name,
        text,
        amount: result.xp - result.old_xp,
        actor_id: actor.id,
        actor_name: actor.displayName
    });

    return memberJson(guild, getMember(guild.id, user_id), settings.server.timezone);
});

route("POST", "/api/guilds/:id/xp/role", async ctx => {
    const { guild, member: actor } = await guildAccess(ctx);
    const body = obj(await readJson(ctx.req));
    const role = guild.roles.cache.get(String(body.role_id));
    if (!role) throw new HttpError(400, "Pick a role.");
    const amount = Math.max(0, num(body.value, "value"));
    const delta = body.mode === "remove" ? -amount : amount;

    let count = 0;
    for (const m of role.members.values()) {
        if (m.user.bot) continue;
        const before = getMember(guild.id, m.id);
        const r = applyXp(guild.id, m.id, delta, profileOf(m));
        afterLevelChange(m, before.level, r.level, r.xp, { quiet: true }).catch(() => {});
        count++;
    }

    const xp_name = getSettings(guild.id).server.xp_name;
    logActivity({ guild_id: guild.id, type: "xp", text: `${delta >= 0 ? "+" : "-"}${fmt(amount)} ${xp_name} to @${role.name} (${count} members)`, actor_id: actor.id, actor_name: actor.displayName });
    return { members: count };
});


// ---- shop -------------------------------------------------------------------------

route("GET", "/api/guilds/:id/shop/items", async ctx => {
    const { guild } = await guildAccess(ctx);
    return listItems(guild.id, true);
});

route("POST", "/api/guilds/:id/shop/items", async ctx => {
    const { guild, member } = await guildAccess(ctx, "admin");
    const input = sanitizeItem(obj(await readJson(ctx.req)));
    if (typeof input === "string") throw new HttpError(400, input);
    const item = createItem(guild.id, input);
    logActivity({ guild_id: guild.id, type: "shop", text: `Added shop item "${item.name}"`, actor_id: member.id, actor_name: member.displayName });
    return item;
});

route("PUT", "/api/guilds/:id/shop/items/:item", async ctx => {
    const { guild, member } = await guildAccess(ctx, "admin");
    const id = num(ctx.params[1], "item");
    if (!getItem(guild.id, id)) throw new HttpError(404, "No such item.");
    const input = sanitizeItem(obj(await readJson(ctx.req)));
    if (typeof input === "string") throw new HttpError(400, input);
    const item = updateItem(guild.id, id, input);
    logActivity({ guild_id: guild.id, type: "shop", text: `Edited shop item "${input.name}"`, actor_id: member.id, actor_name: member.displayName });
    return item;
});

route("DELETE", "/api/guilds/:id/shop/items/:item", async ctx => {
    const { guild, member } = await guildAccess(ctx, "admin");
    const item = getItem(guild.id, num(ctx.params[1], "item"));
    if (!item) throw new HttpError(404, "No such item.");
    deleteItem(guild.id, item.id);
    logActivity({ guild_id: guild.id, type: "shop", text: `Removed shop item "${item.name}"`, actor_id: member.id, actor_name: member.displayName });
    return { ok: true };
});

route("GET", "/api/guilds/:id/shop/purchases", async ctx => {
    const { guild } = await guildAccess(ctx);
    return listPurchases(guild.id, { limit: 100 }).map(p => ({
        ...p,
        user_name: guild.members.cache.get(p.user_id)?.displayName ?? getMember(guild.id, p.user_id).name ?? p.user_id
    }));
});


// ---- birthdays ---------------------------------------------------------------------

route("GET", "/api/guilds/:id/birthdays", async ctx => {
    const { guild } = await guildAccess(ctx);
    const tz = getSettings(guild.id).server.timezone;
    return upcomingBirthdays(guild.id, tz, 500).map(r => ({
        user_id: r.user_id,
        ...displayOf(guild, getMember(guild.id, r.user_id)),
        in_server: guild.members.cache.has(r.user_id),
        month: r.month,
        day: r.day,
        year: r.year,
        age: r.age,
        in_days: r.in_days
    }));
});

// Fixing somebody's date for them, in the same forgiving formats the modal
// accepts ("5 Nov", "05-11", …).
route("PUT", "/api/guilds/:id/birthdays/:uid", async ctx => {
    const { guild, member } = await guildAccess(ctx, "admin");
    const user_id = ctx.params[1];
    if (!/^\d{15,21}$/.test(user_id)) throw new HttpError(400, "Bad user id.");

    const body = obj(await readJson(ctx.req));
    const parsed = parseBirthday(String(body.date ?? ""), String(body.year ?? ""));
    if (typeof parsed === "string") throw new HttpError(400, parsed);

    setBirthday(guild.id, user_id, parsed.month, parsed.day, parsed.year);
    const target = await memberOf(guild, user_id);
    logActivity({
        guild_id: guild.id,
        type: "settings",
        user_id,
        user_name: target?.displayName ?? getMember(guild.id, user_id).name,
        text: `Set birthday to ${parsed.day}/${parsed.month}`,
        actor_id: member.id,
        actor_name: member.displayName
    });
    refreshPanel(ctx.client, guild, "sync").catch(() => {});
    return { ok: true, month: parsed.month, day: parsed.day, year: parsed.year };
});

route("DELETE", "/api/guilds/:id/birthdays/:uid", async ctx => {
    const { guild, member } = await guildAccess(ctx, "admin");
    const user_id = ctx.params[1];
    if (!removeBirthday(guild.id, user_id)) throw new HttpError(404, "That member hasn't set a birthday.");

    const target = await memberOf(guild, user_id);
    logActivity({
        guild_id: guild.id,
        type: "settings",
        user_id,
        user_name: target?.displayName ?? getMember(guild.id, user_id).name,
        text: "Removed birthday",
        actor_id: member.id,
        actor_name: member.displayName
    });
    refreshPanel(ctx.client, guild, "sync").catch(() => {});
    return { ok: true };
});

route("POST", "/api/guilds/:id/birthday/panel", async ctx => {
    const { guild } = await guildAccess(ctx);
    const bd = getSettings(guild.id).birthday;
    if (!bd.enabled) throw new HttpError(400, "Switch birthdays on first.");
    if (!bd.panel_channel) throw new HttpError(400, "Pick a channel for the birthday panel first.");

    await refreshPanel(ctx.client, guild, "sync");
    return { ok: true, message: "The panel is up to date." };
});


// ---- activity, statistics, seasons ---------------------------------------------------

const ACTIVITY_TYPES: ActivityType[] = ["settings", "xp", "level", "roles", "games", "shop", "reset"];

route("GET", "/api/guilds/:id/activity", async ctx => {
    const { guild } = await guildAccess(ctx);
    const type = ctx.query.get("type") as ActivityType | null;
    return listActivity(guild.id, {
        type: type && ACTIVITY_TYPES.includes(type) ? type : undefined,
        search: (ctx.query.get("q") ?? "").trim().slice(0, 100) || undefined,
        before: Number(ctx.query.get("before")) || undefined,
        limit: 50
    });
});

route("GET", "/api/guilds/:id/stats", async ctx => {
    const { guild } = await guildAccess(ctx);
    const range = ctx.query.get("range");
    return getStats(guild.id, range === "day" || range === "month" || range === "year" ? range : "week", guild.memberCount);
});

route("GET", "/api/guilds/:id/seasons", async ctx => {
    const { guild } = await guildAccess(ctx);
    return listSeasons(guild.id);
});


// ---- test messages -------------------------------------------------------------------

route("POST", "/api/guilds/:id/test/:kind", async ctx => {
    const { guild, member } = await guildAccess(ctx);
    const settings = getSettings(guild.id);
    const kind = ctx.params[1];

    if (kind === "leaderboard") {
        await updateChannelBoards(ctx.client, guild.id);
        return { ok: true, message: "Leaderboard channels refreshed." };
    }

    if (kind === "birthday") {
        const channel = await resolveChannel(ctx.client, settings.birthday.announce_channel);
        if (!channel) throw new HttpError(400, "Pick a Birthday Announcement Channel first.");

        // Their own date if they have one, so the preview is honest; otherwise
        // today's, with a year, so the age line shows up in the test too.
        const now = zonedParts(settings.server.timezone);
        const row = getBirthday(guild.id, member.id)
            ?? { guild_id: guild.id, user_id: member.id, month: now.month, day: now.day, year: now.year - 21, updated_at: 0 };
        if (!await sendAnnouncement(guild, channel, row, member, now)) {
            throw new HttpError(400, "I couldn't post there. Check that I can view and send messages in that channel.");
        }
        return { ok: true, message: `Test birthday message sent to #${"name" in channel ? channel.name : "channel"}.` };
    }

    if (kind === "welcome") {
        const channel = await resolveChannel(ctx.client, settings.welcome.channel);
        if (!channel) throw new HttpError(400, "Pick a Welcome Channel first.");
        // Sent as though the person testing had just joined, so the card and
        // every placeholder show real values rather than sample ones.
        if (!await sendWelcome(channel, member, settings.welcome, settings.server.xp_name, settings.server.timezone)) {
            throw new HttpError(400, "I couldn't post there. Check that I can view and send messages in that channel.");
        }
        return { ok: true, message: `Test welcome sent to #${"name" in channel ? channel.name : "channel"}.` };
    }

    if (!["levelup", "role", "total", "streak"].includes(kind)) throw new HttpError(404, "Unknown test.");
    const tpl = settings.notifications.templates[kind as "levelup" | "role" | "total" | "streak"];
    const channel_id = kind === "levelup" ? settings.notifications.levelup_channel : settings.roles.role_channel;
    const channel = await resolveChannel(ctx.client, channel_id);
    if (!channel) {
        throw new HttpError(400, kind === "levelup"
            ? "Pick a Level Up Announcement Channel first (with no channel, level-ups go to wherever the member was chatting)."
            : "Pick a Level Role Announcement Channel on the Roles page first.");
    }

    const row = getMember(guild.id, member.id);
    const top_role = guild.roles.cache.get(settings.roles.level_roles.at(-1)?.role_id ?? "") ?? member.roles.highest;
    const vars = {
        ...memberVars(member, settings.server.xp_name),
        level: row.level + 1,
        old_level: row.level,
        level_diff: 1,
        xp: fmt(row.xp),
        role: top_role.name,
        roleMention: `<@&${top_role.id}>`,
        role_name: top_role.name,
        count: kind === "streak" ? Math.max(1, row.att_streak) : Math.max(1, row.att_total)
    };
    const ok = await sendContainer(channel, buildTemplate(tpl, vars, member.displayAvatarURL({ extension: "png", size: 256 })), []);
    if (!ok) throw new HttpError(400, "I couldn't post there. Check that I can view and send messages in that channel.");
    return { ok: true, message: `Test message sent to #${"name" in channel ? channel.name : "channel"}.` };
});


// ---- welcome card preview -----------------------------------------------------------

// The card as an image, drawn from the settings in the body rather than the
// saved ones, so the dashboard can show what an edit looks like before the
// autosave has even fired.
route("POST", "/api/guilds/:id/welcome/preview", async ctx => {
    const { guild, member } = await guildAccess(ctx);
    const settings = getSettings(guild.id);
    const body = obj(await readJson(ctx.req));

    // Run through the same sanitiser the saved settings use, falling back to
    // what is stored: a draft is no more trustworthy than anything else the
    // browser sends.
    const draft = welcomeCard(body, settings.welcome.card);
    const vars = welcomeVars(member, settings.server.xp_name, settings.server.timezone);
    const png = await renderWelcomeCard(draft, cardDataFor(member, vars));

    ctx.res.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": png.length,
        "Cache-Control": "no-store"
    });
    ctx.res.end(png);
});


// ---- message builder -------------------------------------------------------------

// A saved message is a document plus, once it has been posted, where it went.
// The list carries only enough to draw the sidebar; the builder asks for a
// whole document when one is opened.
function messageSummary(m: SavedMessage) {
    return {
        id: m.id,
        name: m.name,
        mode: m.doc.mode,
        channel_id: m.channel_id,
        message_id: m.message_id,
        created_at: m.created_at,
        updated_at: m.updated_at
    };
}

function messageJson(m: SavedMessage) {
    return { ...messageSummary(m), doc: m.doc };
}

function messageId(ctx: Ctx): number {
    const id = Number(ctx.params[1]);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, "Unknown message.");
    return id;
}

function requireMessage(guild_id: string, id: number): SavedMessage {
    const saved = getMessage(guild_id, id);
    if (!saved) throw new HttpError(404, "That message has been deleted.");
    return saved;
}

// Everything the bot needs before it can post: a channel it can see, and the
// permissions to write in it. Checked here rather than letting the send fail,
// so the dashboard can say which of the two is missing.
async function sendableChannel(guild: Guild, channel_id: unknown): Promise<GuildTextBasedChannel> {
    const channel = guild.channels.cache.get(String(channel_id ?? ""));
    if (!channel) throw new HttpError(400, "Pick a channel in this server first.");
    if (!channel.isTextBased() || !channel.isSendable()) throw new HttpError(400, "I can't post in that kind of channel.");

    const me = guild.members.me;
    const perms = me ? channel.permissionsFor(me) : null;
    if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms.has(PermissionFlagsBits.SendMessages)) {
        throw new HttpError(403, `I can't post in #${channel.name}. Give me View Channel and Send Messages there.`);
    }
    return channel;
}

function channelName(guild: Guild, channel_id: string | null): string {
    const channel = channel_id ? guild.channels.cache.get(channel_id) : null;
    return channel && "name" in channel ? channel.name : "that channel";
}

// Both send paths want to say the same things afterwards: where it went, and
// what was left out on the way.
function sendResult(guild: Guild, verb: string, channel_id: string, message_id: string, dropped: string[]) {
    return {
        ok: true,
        message: `${verb} in #${channelName(guild, channel_id)}.`,
        link: `https://discord.com/channels/${guild.id}/${channel_id}/${message_id}`,
        channel_id,
        message_id,
        dropped
    };
}

// Whatever Discord's "Copy Message Link" produced, or the channel and message
// ids on their own. Only messages this bot wrote can be touched, which is
// Discord's rule as much as this one's.
const MESSAGE_LINK = /(?:channels\/(\d{15,21}|@me)\/)?(\d{15,21})[/-](\d{15,21})/;

async function resolveMessageLink(client: Client, guild: Guild, raw: string): Promise<Message<true>> {
    const found = MESSAGE_LINK.exec(raw.trim());
    if (!found) throw new HttpError(400, "That doesn't look like a message link. Right-click the message in Discord and pick Copy Message Link.");

    const [, link_guild, channel_id, message_id] = found;
    if (link_guild && link_guild !== guild.id) throw new HttpError(400, "That message is in a different server.");

    const channel = guild.channels.cache.get(channel_id);
    if (!channel?.isTextBased()) throw new HttpError(404, "I can't see the channel that message is in.");

    const message = await channel.messages.fetch(message_id).catch(() => null);
    if (!message) throw new HttpError(404, "I couldn't find that message. It may have been deleted, or I may not be able to read that channel.");
    if (message.author.id !== client.user?.id) throw new HttpError(400, "That message was posted by somebody else. I can only edit my own.");

    return message as Message<true>;
}

route("GET", "/api/guilds/:id/messages", async ctx => {
    const { guild } = await guildAccess(ctx);
    return listMessages(guild.id).map(messageSummary);
});

route("POST", "/api/guilds/:id/messages", async ctx => {
    const { guild, member } = await guildAccess(ctx);
    const body = obj(await readJson(ctx.req));
    try {
        const created = createMessage(guild.id, body.name, body.doc);
        logActivity({ guild_id: guild.id, type: "settings", text: `Created the message "${created.name}"`, actor_id: member.id, actor_name: member.displayName });
        return messageJson(created);
    } catch (err) {
        throw new HttpError(400, (err as Error).message);
    }
});

route("GET", "/api/guilds/:id/messages/:mid", async ctx => {
    const { guild } = await guildAccess(ctx);
    return messageJson(requireMessage(guild.id, messageId(ctx)));
});

route("PATCH", "/api/guilds/:id/messages/:mid", async ctx => {
    const { guild, member } = await guildAccess(ctx);
    const id = messageId(ctx);
    const body = obj(await readJson(ctx.req));

    const saved = updateMessage(guild.id, id, { name: body.name, doc: body.doc });
    if (!saved) throw new HttpError(404, "That message has been deleted.");
    logSettings(guild.id, member, `message #${id}`);
    return messageJson(saved);
});

route("DELETE", "/api/guilds/:id/messages/:mid", async ctx => {
    const { guild, member } = await guildAccess(ctx);
    const id = messageId(ctx);
    const saved = requireMessage(guild.id, id);
    deleteMessage(guild.id, id);
    logActivity({ guild_id: guild.id, type: "settings", text: `Deleted the message "${saved.name}"`, actor_id: member.id, actor_name: member.displayName });
    // The posted copy is left alone on purpose: deleting a draft should not
    // take an announcement down with it.
    return { ok: true, posted: Boolean(saved.message_id) };
});

route("POST", "/api/guilds/:id/messages/:mid/send", async ctx => {
    const { guild, member } = await guildAccess(ctx);
    const id = messageId(ctx);
    const saved = requireMessage(guild.id, id);
    const body = obj(await readJson(ctx.req));
    const channel = await sendableChannel(guild, body.channel_id);

    let built;
    try {
        built = await buildMessage(guild, saved.doc, saved.id);
    } catch (err) {
        if (err instanceof MessageError) throw new HttpError(400, err.message);
        throw err;
    }

    let posted;
    try {
        posted = await channel.send(built.payload);
    } catch (err) {
        console.error(`Sending built message ${id} in ${guild.id} failed:`, err);
        throw new HttpError(400, `Discord turned the message down: ${(err as Error).message}`);
    }

    rememberPost(guild.id, id, channel.id, posted.id);
    logActivity({ guild_id: guild.id, type: "settings", text: `Posted the message "${saved.name}" in #${channel.name}`, actor_id: member.id, actor_name: member.displayName });
    return sendResult(guild, "Posted", channel.id, posted.id, built.dropped);
});

// Rewrites the copy already in the channel. Uploads are the one thing an edit
// cannot touch, so a message with files has to be posted fresh instead.
route("POST", "/api/guilds/:id/messages/:mid/update", async ctx => {
    const { guild, member } = await guildAccess(ctx);
    const id = messageId(ctx);
    const saved = requireMessage(guild.id, id);
    if (!saved.channel_id || !saved.message_id) throw new HttpError(400, "This message hasn't been posted anywhere yet.");

    const channel = await sendableChannel(guild, saved.channel_id);
    const existing = await channel.messages.fetch(saved.message_id).catch(() => null);
    if (!existing) {
        rememberPost(guild.id, id, null, null);
        throw new HttpError(404, "The posted copy is gone — somebody deleted it. Send it again to post a new one.");
    }
    if (existing.author.id !== ctx.client.user?.id) throw new HttpError(403, "That message wasn't posted by me, so I can't edit it.");

    let built;
    try {
        built = await buildMessage(guild, saved.doc, saved.id);
    } catch (err) {
        if (err instanceof MessageError) throw new HttpError(400, err.message);
        throw err;
    }

    // An edit that leaves `files` out keeps whatever was uploaded the first
    // time, which would leave the message pointing at attachments the new
    // layout never mentions.
    if (built.payload.files?.length || existing.attachments.size) {
        throw new HttpError(400, "Messages with uploaded files can't be edited in place. Delete the posted copy and send it again.");
    }

    // An edit may only set the two flags Discord lets a message change after the
    // fact; "silent" belongs to the moment a message was posted and is refused
    // here, so it is left off rather than passed through from the build.
    //
    // A Components V2 message carries no content or embeds at all, and passing
    // either — even empty — is refused, so the two shapes are sent as two
    // different edits. Turning a posted message from one shape into the other
    // is something Discord may well turn down; that comes back as its own
    // error below rather than being guessed at here.
    const payload: MessageEditOptions = saved.doc.mode === "v2"
        ? {
            components: built.payload.components ?? [],
            flags: [MessageFlags.IsComponentsV2],
            allowedMentions: built.payload.allowedMentions
        }
        : {
            content: built.payload.content ?? "",
            embeds: built.payload.embeds ?? [],
            components: built.payload.components ?? [],
            // An empty list is how an edit says "none of these flags", which
            // is what clears the link previews back on again.
            flags: saved.doc.suppress_embeds ? [MessageFlags.SuppressEmbeds] : [],
            allowedMentions: built.payload.allowedMentions
        };

    try {
        await existing.edit(payload);
    } catch (err) {
        console.error(`Editing built message ${id} in ${guild.id} failed:`, err);
        throw new HttpError(400, `Discord turned the edit down: ${(err as Error).message}`);
    }

    logActivity({ guild_id: guild.id, type: "settings", text: `Updated the posted message "${saved.name}"`, actor_id: member.id, actor_name: member.displayName });
    return sendResult(guild, "Updated", saved.channel_id, saved.message_id, built.dropped);
});

// Points a draft at a message the bot already posted, so Update rewrites that
// one from now on. Sending null lets go of it again.
route("POST", "/api/guilds/:id/messages/:mid/attach", async ctx => {
    const { guild } = await guildAccess(ctx);
    const id = messageId(ctx);
    requireMessage(guild.id, id);
    const body = obj(await readJson(ctx.req));

    if (body.link === null) {
        rememberPost(guild.id, id, null, null);
    } else {
        const found = await resolveMessageLink(ctx.client, guild, String(body.link ?? ""));
        rememberPost(guild.id, id, found.channelId, found.id);
    }
    return messageJson(requireMessage(guild.id, id));
});

// Reads a message the bot posted back into a fresh draft, so anything it sent
// can be picked up and edited here afterwards.
route("POST", "/api/guilds/:id/messages/import", async ctx => {
    const { guild, member } = await guildAccess(ctx);
    const body = obj(await readJson(ctx.req));
    const found = await resolveMessageLink(ctx.client, guild, String(body.link ?? ""));
    const { doc, warnings } = docFromMessage(found);

    let created: SavedMessage;
    try {
        created = createMessage(guild.id, body.name ?? `Imported from #${channelName(guild, found.channelId)}`, doc);
    } catch (err) {
        throw new HttpError(400, (err as Error).message);
    }
    rememberPost(guild.id, created.id, found.channelId, found.id);

    logActivity({ guild_id: guild.id, type: "settings", text: `Imported the message "${created.name}"`, actor_id: member.id, actor_name: member.displayName });
    return { ...messageJson(requireMessage(guild.id, created.id)), warnings };
});


// ---- reset (Administrator only) ---------------------------------------------------------

route("POST", "/api/guilds/:id/reset", async ctx => {
    const { guild, member } = await guildAccess(ctx, "admin");
    const body = obj(await readJson(ctx.req));
    const actor = { id: member.id, name: member.displayName };
    const log = (text: string) => logActivity({ guild_id: guild.id, type: "reset", text, actor_id: member.id, actor_name: member.displayName });

    switch (body.target) {
        case "exp":
        case "attendance":
        case "both": {
            const r = await runSeasonReset(ctx.client, guild, body.target, actor);
            return { ok: true, message: `Reset done. The old numbers were archived as season #${r.season_id}.` };
        }
        case "user": {
            const user_id = String(body.user_id ?? "");
            const row = getMember(guild.id, user_id);
            if (!row.updated_at) throw new HttpError(404, "That member has no data.");
            db.run(`DELETE FROM members WHERE guild_id = ? AND user_id = ?`, guild.id, user_id);
            const target = await memberOf(guild, user_id);
            if (target) afterLevelChange(target, row.level, 0, 0, { quiet: true }).catch(() => {});
            log(`Reset all data of ${target?.displayName ?? row.name ?? user_id}`);
            return { ok: true, message: "Member data deleted." };
        }
        case "settings": {
            resetSettings(guild.id);
            rescheduleSeason(guild.id);
            log("Reset all settings to defaults");
            return { ok: true, message: "Every setting is back to its default." };
        }
        case "everything": {
            if (body.confirm !== guild.name) throw new HttpError(400, "Type the server name exactly to confirm.");
            for (const table of ["members", "activity", "gamble_log", "stats_daily", "stats_active", "shop_items", "shop_purchases", "seasons", "birthdays", "guild_state"]) {
                db.run(`DELETE FROM ${table} WHERE guild_id = ?`, guild.id);
            }
            resetSettings(guild.id);
            log("Deleted all leveling data and settings");
            return { ok: true, message: "Everything was wiped." };
        }
    }
    throw new HttpError(400, "Unknown reset target.");
});


// ---- public leaderboard ------------------------------------------------------------------

route("GET", "/api/public/guilds/:id", ctx => {
    const guild = publicGuild(ctx);
    const s = getSettings(guild.id);
    return {
        id: guild.id,
        name: guild.name,
        icon: guild.iconURL({ size: 256 }),
        member_count: guild.memberCount,
        xp_name: s.server.xp_name,
        color: s.leaderboard.color,
        seasons: listSeasons(guild.id).slice(0, 12)
    };
});

route("GET", "/api/public/guilds/:id/leaderboard", ctx => {
    const guild = publicGuild(ctx);
    const type = (ctx.query.get("type") ?? "xp") as BoardType;
    if (!BOARD_TYPES.includes(type)) throw new HttpError(400, "Unknown leaderboard.");
    return boardPage(guild, guild.id, type, Number(ctx.query.get("page")) || 1, 10);
});

route("GET", "/api/public/guilds/:id/seasons/:season", ctx => {
    const guild = publicGuild(ctx);
    const season = getSeason(guild.id, num(ctx.params[1], "season"));
    if (!season) throw new HttpError(404, "No such season.");

    const type = ctx.query.get("type") ?? "xp";
    const raw = type === "total" ? season.total_rank : type === "streak" ? season.streak_rank : season.xp_rank;
    const all = JSON.parse(raw ?? "[]") as BoardEntry[];
    const page = Math.max(1, Number(ctx.query.get("page")) || 1);
    const pages = Math.max(1, Math.ceil(all.length / 10));
    const p = Math.min(page, pages);

    return {
        id: season.id,
        target: season.target,
        ended_at: season.ended_at,
        total: all.length,
        page: p,
        pages,
        entries: all.slice((p - 1) * 10, p * 10).map(e => ({ ...e, ...displayOf(guild, { user_id: e.user_id, name: e.name, avatar: e.avatar }) }))
    };
});


// ---- public web shop -----------------------------------------------------------------------
// Anyone can browse; buying needs a Discord login and membership of the server.

async function shopMember(ctx: Ctx): Promise<{ guild: Guild; member: GuildMember }> {
    const session = requireSession(ctx);
    const guild = publicGuild(ctx);
    const member = await memberOf(guild, session.user_id);
    if (!member) throw new HttpError(403, "You need to be a member of this server to shop here.");
    return { guild, member };
}

route("GET", "/api/public/guilds/:id/shop", async ctx => {
    const guild = publicGuild(ctx);
    const settings = getSettings(guild.id);
    const items = listItems(guild.id).map(i => {
        const role = i.role_id ? guild.roles.cache.get(i.role_id) : undefined;
        return {
            id: i.id, name: i.name, description: i.description, emoji: i.emoji, price: i.price, type: i.type,
            duration_hours: i.duration_hours, stock: i.stock, per_user_limit: i.per_user_limit,
            role: role ? { name: role.name, color: role.hexColor === "#000000" ? null : role.hexColor } : null
        };
    });

    let viewer: Record<string, unknown> | null = null;
    const session = getSession(ctx.req);
    if (session) {
        const member = await memberOf(guild, session.user_id);
        viewer = member
            ? {
                member: true,
                name: member.displayName,
                balance: getMember(guild.id, member.id).xp,
                is_admin: isServerAdmin(member),
                inventory: listPurchases(guild.id, { user_id: member.id, status: ["owned", "requested", "active"], limit: 50 })
            }
            : { member: false };
    }

    return {
        guild: { id: guild.id, name: guild.name, icon: guild.iconURL({ size: 128 }) },
        xp_name: settings.server.xp_name,
        items,
        viewer
    };
});

route("POST", "/api/shop/:id/buy", async ctx => {
    const { guild, member } = await shopMember(ctx);
    const body = obj(await readJson(ctx.req));
    const result = await buyItem(member, num(body.item_id, "item_id"));
    return { ...result, balance: getMember(guild.id, member.id).xp };
});

route("POST", "/api/shop/:id/use", async ctx => {
    const { member } = await shopMember(ctx);
    const body = obj(await readJson(ctx.req));
    return await useItem(member, num(body.purchase_id, "purchase_id"));
});


// ---- dispatch ------------------------------------------------------------------------------

// ---- applications ------------------------------------------------------------

// The editor throws for anything the person got wrong; a 400 puts the message
// in front of them instead of burying it in the bot's log as a 500.
async function editing<T>(run: () => T | Promise<T>): Promise<T> {
    try {
        return await run();
    } catch (err) {
        if (err instanceof ApplicationEditError) throw new HttpError(400, err.message);
        throw err;
    }
}

function applicationsPayload(guild_id: string) {
    return {
        settings: getApplicationSettings(guild_id) ?? null,
        questions: listQuestions(guild_id),
        defaults: PANEL_DEFAULTS
    };
}

// Wording and channels only matter once they are on the panel people can see.
async function refreshPanelFor(ctx: Ctx, guild_id: string): Promise<void> {
    const config = getApplicationSettings(guild_id);
    if (!config) return;

    try {
        const message_id = await syncApplicationPanel(ctx.client, config);
        if (message_id !== config.panel_msg_id) rememberPanelMessage(guild_id, message_id);
    } catch (err) {
        console.error(`Application panel refresh failed for ${guild_id}:`, err);
    }
}

route("GET", "/api/guilds/:id/applications", async ctx => {
    const { guild } = await guildAccess(ctx);
    return applicationsPayload(guild.id);
});

route("PUT", "/api/guilds/:id/applications/settings", async ctx => {
    const { guild, member } = await guildAccess(ctx, "admin");
    const body = obj(await readJson(ctx.req));

    await editing(() => saveApplicationSettings(guild.id, body));
    await refreshPanelFor(ctx, guild.id);

    logSettings(guild.id, member, "applications");
    return applicationsPayload(guild.id);
});

route("POST", "/api/guilds/:id/applications/questions", async ctx => {
    const { guild, member } = await guildAccess(ctx, "admin");
    const body = obj(await readJson(ctx.req));

    await editing(() => createQuestion(guild.id, body));
    logSettings(guild.id, member, "applications");
    return applicationsPayload(guild.id);
});

route("PATCH", "/api/guilds/:id/applications/questions/:qid", async ctx => {
    const { guild, member } = await guildAccess(ctx, "admin");
    const body = obj(await readJson(ctx.req));

    await editing(() => updateQuestion(guild.id, num(ctx.params[1], "question"), body));
    logSettings(guild.id, member, "applications");
    return applicationsPayload(guild.id);
});

route("DELETE", "/api/guilds/:id/applications/questions/:qid", async ctx => {
    const { guild, member } = await guildAccess(ctx, "admin");

    await editing(() => deleteQuestion(guild.id, num(ctx.params[1], "question")));
    logSettings(guild.id, member, "applications");
    return applicationsPayload(guild.id);
});

route("POST", "/api/guilds/:id/applications/questions/reorder", async ctx => {
    const { guild, member } = await guildAccess(ctx, "admin");
    const body = obj(await readJson(ctx.req));
    const order = Array.isArray(body.order) ? body.order : [];

    await editing(() => reorderQuestions(guild.id, order.map((entry: Record<string, unknown>) => ({
        id: num(entry.id, "id"),
        stage: num(entry.stage, "stage")
    }))));

    logSettings(guild.id, member, "applications");
    return applicationsPayload(guild.id);
});

route("POST", "/api/guilds/:id/applications/panel", async ctx => {
    const { guild } = await guildAccess(ctx, "admin");
    if (!getApplicationSettings(guild.id)) throw new HttpError(400, "Save the channels first.");

    await refreshPanelFor(ctx, guild.id);
    return applicationsPayload(guild.id);
});


function sameOrigin(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (!origin) return true;
    const host = req.headers["x-forwarded-host"] ?? req.headers.host;
    try {
        return new URL(origin).host === host;
    } catch {
        return false;
    }
}

export async function handleApi(client: Client, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const method = req.method ?? "GET";
    if (method !== "GET" && !sameOrigin(req)) {
        json(res, 403, { error: "Cross-site request refused." });
        return;
    }

    for (const r of routes) {
        if (r.method !== method) continue;
        const m = r.pattern.exec(url.pathname);
        if (!m) continue;
        try {
            const result = await r.handler({ client, req, res, params: m.slice(1).map(decodeURIComponent), query: url.searchParams });
            if (!res.headersSent) json(res, 200, result ?? { ok: true });
        } catch (err) {
            if (err instanceof HttpError) {
                json(res, err.status, { error: err.message });
            } else {
                console.error(`Dashboard API ${method} ${url.pathname} failed:`, err);
                json(res, 500, { error: "Something went wrong on the bot's side." });
            }
        }
        return;
    }
    json(res, 404, { error: "Not found." });
}
