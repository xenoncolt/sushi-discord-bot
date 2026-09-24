import { Client, ContainerBuilder, Guild, GuildMember, MessageFlags, SendableChannels } from "discord.js";
import { buildTemplate, memberVars, resolveChannel } from "../leveling/notify.js";
import { getSettings, getState, setState } from "../leveling/settings.js";
import { dayKey, zonedParts } from "../leveling/time.js";
import { text } from "../leveling/ui.js";
import { isConnected } from "../leveling/uptime.js";
import { refreshPanel } from "./panel.js";
import { ageOn, BirthdayRow, birthdaysOn, formatDate, MONTHS } from "./store.js";


// What today's run has already done, so a restart in the middle of it can pick
// up where it stopped instead of wishing the same people happy birthday twice.
// Written back after every single announcement, for the same reason.
const STATE_KEY = "bd_run";

// A send that failed is worth another go — the gateway hiccups — but a channel
// the bot simply cannot post in must not be retried every minute until
// midnight, so each person gets a small number of attempts.
const MAX_TRIES = 3;

interface RunState {
    day: string;
    done: string[];
    tries: Record<string, number>;
}

function readRun(guild_id: string): RunState | null {
    const raw = getState(guild_id, STATE_KEY);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as RunState;
        if (typeof parsed?.day !== "string" || !Array.isArray(parsed.done)) return null;
        return { ...parsed, tries: parsed.tries ?? {} };
    } catch {
        return null;
    }
}

export function buildAnnouncement(guild: Guild, row: BirthdayRow, member: GuildMember, on: { year: number; month: number; day: number }): ContainerBuilder {
    const settings = getSettings(guild.id);
    const bd = settings.birthday;
    const age = row.year === null ? null : ageOn(row.year, row.month, row.day, on);

    // The age line is a separate setting so the same message works for people
    // who shared a year and people who didn't.
    const tpl = { ...bd.templates.announce };
    if (age !== null && bd.age_line.trim()) tpl.body = `${tpl.body}\n${bd.age_line}`;

    return buildTemplate(tpl, {
        ...memberVars(member, settings.server.xp_name),
        date: formatDate(row.month, row.day),
        day: row.day,
        month: MONTHS[row.month - 1],
        age: age ?? ""
    }, member.displayAvatarURL({ extension: "png", size: 256 }));
}

export async function sendAnnouncement(guild: Guild, channel: SendableChannels, row: BirthdayRow, member: GuildMember, on: { year: number; month: number; day: number }): Promise<boolean> {
    const bd = getSettings(guild.id).birthday;
    const container = buildAnnouncement(guild, row, member, on);

    // A Components V2 message has no plain content to hang a role ping on, so
    // the ping is its own line above the card.
    const components = bd.ping_role ? [text(`<@&${bd.ping_role}>`), container] : [container];

    try {
        await channel.send({
            components,
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: {
                parse: [],
                users: bd.mention_user ? [member.id] : [],
                roles: bd.ping_role ? [bd.ping_role] : []
            }
        });
        return true;
    } catch (err) {
        console.error(`Birthday announcement failed in ${guild.id}:`, err);
        return false;
    }
}

// Exactly the people celebrating today wear the role, and nobody else. Written
// as a full reconcile rather than an add/remove pair so a missed tick, a
// restart or a hand-edited role all correct themselves on the next run.
async function syncRole(guild: Guild, role_id: string | null, should_have: Set<string>): Promise<void> {
    if (!role_id) return;
    const role = guild.roles.cache.get(role_id);
    if (!role) return;

    const me = guild.members.me;
    if (!me?.permissions.has("ManageRoles") || role.position >= me.roles.highest.position) return;

    for (const member of role.members.values()) {
        if (!should_have.has(member.id)) await member.roles.remove(role).catch(() => {});
    }
    for (const user_id of should_have) {
        const member = guild.members.cache.get(user_id);
        if (member && !member.roles.cache.has(role_id)) await member.roles.add(role).catch(() => {});
    }
}

async function runGuild(client: Client, guild: Guild): Promise<void> {
    const settings = getSettings(guild.id);
    const bd = settings.birthday;
    if (!bd.enabled) return;

    const tz = settings.server.timezone;
    const now = zonedParts(tz);
    const today = dayKey(tz);
    const rows = birthdaysOn(guild.id, now.year, now.month, now.day);

    const [hh, mm] = bd.announce_time.split(":").map(Number);
    // Past the time on the server's own clock. A restart later in the day
    // still counts as due, which is how a birthday survives the bot having
    // been offline when the time came round.
    const due = now.hour * 60 + now.minute >= hh * 60 + mm;

    // The role goes on when the announcement is due and comes off as soon as
    // the day turns over, whatever else happens.
    await syncRole(guild, bd.birthday_role, due ? new Set(rows.map(r => r.user_id)) : new Set());
    if (!due) return;

    let run = readRun(guild.id);
    if (run?.day !== today) {
        run = { day: today, done: [], tries: {} };
        setState(guild.id, STATE_KEY, JSON.stringify(run));
    }

    const waiting = rows.filter(r => !run!.done.includes(r.user_id));
    if (!waiting.length) return;

    const channel = await resolveChannel(client, bd.announce_channel);
    let posted = 0;

    for (const row of waiting) {
        // People who left keep their row (they may come back) but get no
        // announcement today.
        const member = guild.members.cache.get(row.user_id) ?? await guild.members.fetch(row.user_id).catch(() => null);

        if (!channel || !member || member.user.bot) {
            run.done.push(row.user_id);
        } else if (await sendAnnouncement(guild, channel, row, member, now)) {
            run.done.push(row.user_id);
            posted++;
        } else {
            // Left out of `done` so the next tick tries again, until the
            // attempts run out and it is given up on for the day.
            const tries = (run.tries[row.user_id] ?? 0) + 1;
            run.tries[row.user_id] = tries;
            if (tries >= MAX_TRIES) run.done.push(row.user_id);
        }

        // Written after every single person, so a crash here resumes rather
        // than starting the whole day over.
        setState(guild.id, STATE_KEY, JSON.stringify(run));

        // The connection dropping mid-run leaves the rest for the next tick.
        if (!isConnected(client)) return;
    }

    // The announcement just pushed the panel up the channel. Rather than wait
    // for the sticky timer, put it back at the bottom straight away.
    if (posted && bd.panel_channel === bd.announce_channel) {
        await refreshPanel(client, guild, "sync").catch(() => {});
    }
}

export async function birthdayTick(client: Client): Promise<void> {
    // Offline, the announcement would go nowhere and the role changes would be
    // lost; everything below is safe to simply try again next minute.
    if (!isConnected(client)) return;

    for (const guild of client.guilds.cache.values()) {
        await runGuild(client, guild).catch(err => console.error(`Birthday run failed for ${guild.id}:`, err));
    }
}
