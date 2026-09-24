import { Client } from "discord.js";
import { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { createLevelingTable } from "../schema/levelingDB.js";
import { dashboardUrl } from "../leveling/ui.js";
import { cookie, HttpError, parseCookies, redirect } from "./http.js";


const db = createLevelingTable();

// Discord OAuth2 "authorization code" login. The bot only needs to know who
// you are; what you may manage is worked out from its own member cache, so
// only the identify and guilds scopes are asked for.

const SESSION_DAYS = 7;
const SESSION_COOKIE = "lv_sid";
const STATE_COOKIE = "lv_oauth";

export interface Session {
    id: string;
    user_id: string;
    username: string;
    global_name: string | null;
    avatar: string | null;
    guilds: string;        // JSON of the user's guilds at login, for the "invite" list
    created_at: number;
    expires_at: number;
}

export interface OAuthGuild {
    id: string;
    name: string;
    icon: string | null;
    owner: boolean;
    permissions: string;
}

function secure(): boolean {
    return (dashboardUrl() ?? "").startsWith("https://");
}

export function loginEnabled(): boolean {
    return Boolean(process.env.DISCORD_CLIENT_SECRET && dashboardUrl());
}

function clientId(client: Client): string {
    return process.env.DISCORD_CLIENT_ID || client.user!.id;
}

function redirectUri(): string {
    return `${dashboardUrl()}/api/auth/callback`;
}

// Only same-site paths, so the login can't be turned into an open redirect.
function safePath(path: string | null | undefined): string {
    return path && path.startsWith("/") && !path.startsWith("//") ? path : "/servers";
}

export function startLogin(client: Client, res: ServerResponse, next: string | null): void {
    if (!loginEnabled()) throw new HttpError(503, "Dashboard login isn't configured. Set DISCORD_CLIENT_SECRET and DASHBOARD_URL.");
    const state = randomBytes(16).toString("base64url");
    const url = new URL("https://discord.com/oauth2/authorize");
    url.searchParams.set("client_id", clientId(client));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", redirectUri());
    url.searchParams.set("scope", "identify guilds");
    url.searchParams.set("state", state);
    url.searchParams.set("prompt", "none");

    redirect(res, url.toString(), {
        "Set-Cookie": cookie(STATE_COOKIE, `${state}|${safePath(next)}`, { maxAge: 600, secure: secure() })
    });
}

async function discord<T>(path: string, token: string): Promise<T> {
    const r = await fetch(`https://discord.com/api/v10${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000)
    });
    if (!r.ok) throw new HttpError(502, `Discord answered ${r.status} for ${path}.`);
    return await r.json() as T;
}

export async function finishLogin(client: Client, req: IncomingMessage, res: ServerResponse, query: URLSearchParams): Promise<void> {
    const [state, next] = (parseCookies(req)[STATE_COOKIE] ?? "").split("|");
    const clear_state = cookie(STATE_COOKIE, "", { maxAge: 0, secure: secure() });

    if (query.get("error")) {
        redirect(res, "/?login=cancelled", { "Set-Cookie": clear_state });
        return;
    }
    const code = query.get("code");
    if (!code || !state || query.get("state") !== state) {
        throw new HttpError(400, "Login expired or was tampered with. Please try again.");
    }

    const token_res = await fetch("https://discord.com/api/v10/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: clientId(client),
            client_secret: process.env.DISCORD_CLIENT_SECRET!,
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri()
        }),
        signal: AbortSignal.timeout(10_000)
    });
    if (!token_res.ok) throw new HttpError(502, "Discord refused the login. Check DISCORD_CLIENT_SECRET and the redirect URL.");
    const token = await token_res.json() as { access_token: string };

    const user = await discord<{ id: string; username: string; global_name: string | null; avatar: string | null }>("/users/@me", token.access_token);
    const guilds = await discord<OAuthGuild[]>("/users/@me/guilds", token.access_token).catch(() => []);

    // The access token itself is thrown away; nothing here acts on the
    // user's behalf later.
    const id = randomBytes(32).toString("base64url");
    const now = Date.now();
    db.run(
        `INSERT INTO dashboard_sessions (id, user_id, username, global_name, avatar, guilds, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        id, user.id, user.username, user.global_name, user.avatar,
        JSON.stringify(guilds.map(g => ({ id: g.id, name: g.name, icon: g.icon, owner: g.owner, permissions: g.permissions }))),
        now, now + SESSION_DAYS * 86_400_000
    );
    db.run(`DELETE FROM dashboard_sessions WHERE expires_at < ?`, now);

    redirect(res, safePath(next), {
        "Set-Cookie": [clear_state, cookie(SESSION_COOKIE, id, { maxAge: SESSION_DAYS * 86_400, secure: secure() })]
    });
}

export function getSession(req: IncomingMessage): Session | null {
    const id = parseCookies(req)[SESSION_COOKIE];
    if (!id) return null;
    const s = db.get<Session>(`SELECT * FROM dashboard_sessions WHERE id = ?`, id);
    if (!s || s.expires_at < Date.now()) return null;
    return s;
}

export function logout(req: IncomingMessage, res: ServerResponse): void {
    const id = parseCookies(req)[SESSION_COOKIE];
    if (id) db.run(`DELETE FROM dashboard_sessions WHERE id = ?`, id);
    res.setHeader("Set-Cookie", cookie(SESSION_COOKIE, "", { maxAge: 0, secure: secure() }));
}

export function inviteUrl(client: Client, guild_id?: string): string {
    // Manage Roles, Manage Nicknames (level prefix), Manage Messages (/purge),
    // View Channels, Send Messages, Embed Links, Attach Files,
    // Read Message History, Use External Emojis.
    const url = new URL("https://discord.com/oauth2/authorize");
    url.searchParams.set("client_id", clientId(client));
    url.searchParams.set("permissions", "403041280");
    url.searchParams.set("scope", "bot applications.commands");
    if (guild_id) {
        url.searchParams.set("guild_id", guild_id);
        url.searchParams.set("disable_guild_select", "true");
    }
    return url.toString();
}
