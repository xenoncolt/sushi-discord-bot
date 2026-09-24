import { Client, ContainerBuilder, Guild } from "discord.js";
import { createLevelingTable } from "../schema/levelingDB.js";
import { logActivity } from "./activity.js";
import { BoardEntry, boardLine, fullBoard } from "./leaderboard.js";
import { resetAttendance, resetXp } from "./members.js";
import { renderTemplate, resolveChannel, sendContainer } from "./notify.js";
import { syncNickname } from "./prefix.js";
import { syncLevelRoles } from "./roles.js";
import { GuildSettings, getSettings, getState, setState, updateSection } from "./settings.js";
import { zonedParts, zonedToUtc } from "./time.js";
import { isConnected } from "./uptime.js";
import { COLOR, dashboardUrl, fmt, linkRow, sep, text } from "./ui.js";


const db = createLevelingTable();

const PERIOD_MONTHS: Record<string, number[]> = {
    monthly: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    quarterly: [1, 4, 7, 10],
    half: [1, 7],
    yearly: [1]
};

export function nextSeasonReset(season: GuildSettings["season"], tz: string, from: number = Date.now()): number | null {
    if (!season.enabled) return null;
    const [hh, mm] = season.time.split(":").map(Number);

    if (season.period === "date") {
        if (!season.date) return null;
        const [y, m, d] = season.date.split("-").map(Number);
        const at = zonedToUtc(tz, y, m, d, hh, mm);
        return at > from ? at : null;
    }

    const months = PERIOD_MONTHS[season.period];
    const now = zonedParts(tz, from);
    let year = now.year;
    let month = now.month;
    for (let i = 0; i < 14; i++) {
        if (months.includes(month)) {
            const at = zonedToUtc(tz, year, month, 1, hh, mm);
            if (at > from) return at;
        }
        month++;
        if (month > 12) {
            month = 1;
            year++;
        }
    }
    return null;
}

// Called whenever the Season page is saved so the new schedule takes effect.
export function rescheduleSeason(guild_id: string): number | null {
    const settings = getSettings(guild_id);
    const next = nextSeasonReset(settings.season, settings.server.timezone);
    setState(guild_id, "season_next", next ? String(next) : null);
    return next;
}

export interface SeasonArchive {
    id: number;
    guild_id: string;
    target: string;
    ended_at: number;
    xp_rank: string | null;
    total_rank: string | null;
    streak_rank: string | null;
}

export function listSeasons(guild_id: string): Pick<SeasonArchive, "id" | "target" | "ended_at">[] {
    return db.all(`SELECT id, target, ended_at FROM seasons WHERE guild_id = ? ORDER BY id DESC LIMIT 50`, guild_id);
}

export function getSeason(guild_id: string, id: number): SeasonArchive | undefined {
    return db.get<SeasonArchive>(`SELECT * FROM seasons WHERE guild_id = ? AND id = ?`, guild_id, id);
}

type ResetTarget = "exp" | "attendance" | "both";

interface Followup {
    season_id: number;
    target: ResetTarget;
    actor: { id: string; name: string } | null;
    announced?: boolean;
}

// Step one: archive the rankings and zero the numbers in a single transaction
// (plus `also`, which the scheduler uses to move the schedule on). A crash
// can't leave it half done, and can't make the same reset run twice.
function commitReset(guild: Guild, target: ResetTarget, actor: { id: string; name: string } | null, also?: () => void): { season_id: number; members: number } {
    const exp = target === "exp" || target === "both";
    const att = target === "attendance" || target === "both";

    const xp_rank = fullBoard(guild, guild.id, "xp");
    const total_rank = fullBoard(guild, guild.id, "total");
    const streak_rank = fullBoard(guild, guild.id, "streak");

    return db.transaction(() => {
        const archived = db.run(
            `INSERT INTO seasons (guild_id, target, ended_at, xp_rank, total_rank, streak_rank) VALUES (?, ?, ?, ?, ?, ?)`,
            guild.id, target, Date.now(),
            JSON.stringify(xp_rank), JSON.stringify(total_rank), JSON.stringify(streak_rank)
        );

        if (exp) resetXp(guild.id);
        if (att) resetAttendance(guild.id);

        logActivity({
            guild_id: guild.id,
            type: "reset",
            text: `Season reset: ${target === "both" ? "EXP & attendance" : target === "exp" ? "EXP" : "attendance"}`,
            actor_id: actor?.id ?? null,
            actor_name: actor?.name ?? "Season scheduler"
        });

        also?.();
        const followup: Followup = { season_id: archived.lastID, target, actor };
        setState(guild.id, "season_followup", JSON.stringify(followup));
        return { season_id: archived.lastID, members: xp_rank.length };
    });
}

const following_up = new Set<string>();

function parseBoard(json: string | null): BoardEntry[] {
    try {
        return JSON.parse(json ?? "[]");
    } catch {
        return [];
    }
}

// Step two, the slow part that talks to Discord: the announcement, level
// roles and nickname prefixes, and the log post. What is still to do is kept
// in guild_state, so if the bot stops halfway the next start finishes it.
async function followUp(client: Client, guild: Guild): Promise<void> {
    if (following_up.has(guild.id)) return;
    const raw = getState(guild.id, "season_followup");
    if (!raw) return;

    following_up.add(guild.id);
    try {
        let f: Followup;
        try {
            f = JSON.parse(raw);
        } catch {
            setState(guild.id, "season_followup", null);
            return;
        }
        const season = getSeason(guild.id, f.season_id);
        if (!season) {
            setState(guild.id, "season_followup", null);
            return;
        }

        const settings = getSettings(guild.id);
        const exp = f.target === "exp" || f.target === "both";
        const xp_rank = parseBoard(season.xp_rank);
        const total_rank = parseBoard(season.total_rank);

        if (!f.announced) {
            await announceSeason(client, guild, f.target, f.season_id, exp ? xp_rank : total_rank, exp ? "xp" : "total");
            f.announced = true;
            setState(guild.id, "season_followup", JSON.stringify(f));
        }

        // Everyone is level 0 now, so level roles come off and nickname
        // prefixes go back to 0. One member at a time to stay inside
        // Discord's limits. Members already done cost nothing the second time.
        let resynced = 0;
        const prefix_on = settings.level.prefix.trim() !== "";
        if (exp && (settings.roles.level_roles.length || prefix_on)) {
            const level_role_ids = new Set(settings.roles.level_roles.map(r => r.role_id));
            for (const member of guild.members.cache.values()) {
                if (member.user.bot) continue;
                const has_role = member.roles.cache.some(r => level_role_ids.has(r.id));
                if (has_role) await syncLevelRoles(member, 0, false).catch(() => {});
                if (prefix_on) await syncNickname(member, 0).catch(() => {});
                if (has_role || prefix_on) resynced++;
            }
        }

        // Lost the connection halfway? Keep the follow-up for the next tick.
        if (!isConnected(client)) return;

        const log = await resolveChannel(client, settings.season.log_channel);
        if (log) {
            await sendContainer(log, new ContainerBuilder()
                .setAccentColor(COLOR.info)
                .addTextDisplayComponents(text([
                    `### ✅ Season reset complete`,
                    `**Reset:** ${f.target === "both" ? "EXP & attendance" : f.target === "exp" ? "EXP" : "Attendance"}`,
                    `**Archived members:** ${fmt(Math.max(xp_rank.length, total_rank.length))}`,
                    exp ? `**Level roles & prefixes re-synced:** ${fmt(resynced)} members` : "",
                    `**Triggered by:** ${f.actor ? `<@${f.actor.id}>` : "schedule"}`
                ].filter(Boolean).join("\n"))));
        }
        setState(guild.id, "season_followup", null);
    } finally {
        following_up.delete(guild.id);
    }
}

// Manual reset from the dashboard's Reset page.
export async function runSeasonReset(client: Client, guild: Guild, target: ResetTarget, actor?: { id: string; name: string }): Promise<{ season_id: number; members: number }> {
    const done = commitReset(guild, target, actor ?? null);
    await followUp(client, guild);
    return done;
}

async function announceSeason(client: Client, guild: Guild, target: string, season_id: number, ranking: BoardEntry[], type: "xp" | "total"): Promise<void> {
    const settings = getSettings(guild.id);
    const channel = await resolveChannel(client, settings.season.announce_channel);
    if (!channel) return;

    const vars = { server: guild.name, date: new Date().toISOString().slice(0, 10) };
    const title = settings.season.custom_announce && settings.season.announce_title.trim()
        ? renderTemplate(settings.season.announce_title, vars)
        : `🏁 The season has ended!`;
    const body = settings.season.custom_announce && settings.season.announce_body.trim()
        ? renderTemplate(settings.season.announce_body, vars)
        : `Thanks for an amazing season, **${guild.name}**! Here's how it finished.\nA brand new season starts **now** — ${target === "attendance" ? "attendance counts" : `everyone is back to 0 ${settings.server.xp_name}`}. Good luck!`;

    const top = ranking.slice(0, 10);
    const container = new ContainerBuilder()
        .setAccentColor(COLOR.gold)
        .addTextDisplayComponents(text(`## ${title}\n${body}`))
        .addSeparatorComponents(sep())
        .addTextDisplayComponents(text(
            `### ${type === "xp" ? "Final EXP ranking" : "Final attendance ranking"}\n` +
            (top.length ? top.map(e => boardLine(guild.id, type, e)).join("\n") : "*No rankings this season.*")
        ));

    const base = dashboardUrl();
    if (base) {
        container.addActionRowComponents(linkRow({ label: "View full rankings", url: `${base}/leaderboard/${guild.id}/season/${season_id}`, emoji: "📜" }));
    }

    await sendContainer(channel, container, []);
}

// Checked every minute. The next reset time lives in guild_state so a restart
// right before midnight doesn't skip it.
export async function seasonTick(client: Client): Promise<void> {
    // Offline, Discord would miss the announcement and the role changes.
    if (!isConnected(client)) return;

    const now = Date.now();
    for (const guild of client.guilds.cache.values()) {
        // A reset the bot was stopped in the middle of.
        if (getState(guild.id, "season_followup")) {
            await followUp(client, guild).catch(err => console.error(`Season follow-up failed for ${guild.id}:`, err));
            if (getState(guild.id, "season_followup")) continue;
        }

        const settings = getSettings(guild.id);
        if (!settings.season.enabled) continue;

        let next = Number(getState(guild.id, "season_next") ?? NaN);
        if (!Number.isFinite(next)) {
            const computed = rescheduleSeason(guild.id);
            if (!computed) continue;
            next = computed;
        }
        // A reset that fell due while the bot was offline runs now.
        if (now < next) continue;

        try {
            commitReset(guild, settings.season.target, null, () => {
                // A one-off date has nothing to repeat, so the schedule switches off.
                if (settings.season.period === "date") {
                    updateSection(guild.id, "season", { ...settings.season, enabled: false });
                }
                rescheduleSeason(guild.id);
            });
            await followUp(client, guild);
        } catch (err) {
            console.error(`Season reset failed for ${guild.id}:`, err);
        }
    }
}
