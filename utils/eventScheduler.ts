import { Client, ContainerBuilder, MessageFlags, SendableChannels, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder } from "discord.js";
import { createTimingTable } from "../schema/timingDB.js";
import { TimingRow } from "../types/TimingRow.js";


const db = await createTimingTable();

// Node's setTimeout stores the delay in a 32-bit signed int; a larger delay
// overflows and fires (almost) immediately. Cap each hop below that and re-arm
// for longer waits so monthly / far-future events actually wait.
const MAX_DELAY = 2_147_483_647;

// miss event time 5 min
const CATCH_UP_GRACE_MS = 10 * 60 * 1000;


const timers = new Map<number, NodeJS.Timeout>();


export function clearEventTimer(id: number): void {
    const t = timers.get(id);
    if (t) {
        clearTimeout(t);
        timers.delete(id);
    }
}

// Arm a cancellable timer that fires at `fireAt` (epoch ms), chunking the wait
// into <= MAX_DELAY hops so long delays don't overflow setTimeout.
function armTimer(id: number, fireAt: number, onFire: () => void): void {
    clearEventTimer(id);

    const step = () => {
        const remaining = fireAt - Date.now();
        if (remaining <= 0) {
            timers.delete(id);
            onFire();
            return;
        }
        timers.set(id, setTimeout(step, Math.min(remaining, MAX_DELAY)));
    };

    step();
}


export function scheduleEvent(client: Client, event: TimingRow): void {
    const delay = event.event_time - Date.now();

    if (delay <= 0) {
        handleMissed(client, event).catch(console.error);
        return;
    }

    if (event.board_channel_id) {
        updateBoardMsg(client, event).catch(console.error);
    }

    armTimer(event.id, event.event_time, () => {
        onFire(client, event.id).catch(console.error);
    });
}


// Fired by the timer. Re-reads the event fresh (it may have been edited or
// removed while pending), posts it, then either deletes (once) or advances and
// reschedules (recurring). Wrapped so a failure can never crash the process or
// silently kill a recurring schedule.
async function onFire(client: Client, id: number): Promise<void> {
    try {
        const event = await db.get<TimingRow>(`SELECT * FROM timing WHERE id = ?`, id);
        if (!event) {
            clearEventTimer(id);
            return;
        }

        await fireEvent(client, event);

        if (event.type === "once") {
            await db.run(`DELETE FROM timing WHERE id = ?`, id);
            clearEventTimer(id);
        } else {
            const next_time = getNextOccurrence(event.event_time, event.type);
            await db.run(`UPDATE timing SET event_time = ? WHERE id = ?`, next_time, id);
            scheduleEvent(client, { ...event, event_time: next_time });
        }
    } catch (err) {
        console.error(`Failed to process event ${id}:`, err);
    }
}


async function handleMissed(client: Client, event: TimingRow): Promise<void> {
    const overdue_by = Date.now() - event.event_time;

    if (overdue_by <= CATCH_UP_GRACE_MS) {
        await fireEvent(client, event);
    } else {
        console.warn(`Skipping stale occurrence of "${event.event_name}" (overdue ${msToHuman(overdue_by)})`);
    }

    if (event.type === "once") {
        await db.run(`DELETE FROM timing WHERE id = ?`, event.id);
        clearEventTimer(event.id);
        return;
    }

    const next_time = advanceToFuture(event.event_time, event.type);
    if (next_time <= event.event_time) {
        console.warn(`Cannot advance event "${event.event_name}" of unknown type "${event.type}"`);
        return;
    }

    await db.run(`UPDATE timing SET event_time = ? WHERE id = ?`, next_time, event.id);
    scheduleEvent(client, { ...event, event_time: next_time });
}


export async function startEventScheduler(client: Client): Promise<void> {
    const events = await db.all<TimingRow[]>(`SELECT * FROM timing`);
    for (const event of events) {
        scheduleEvent(client, event);
    }
}


function buildBoardContainer(event_name: string, time_ms: number, type: TimingRow["type"]): ContainerBuilder {
    const unix_sec = Math.floor(time_ms / 1000);
    const label = type === "once" ? "Time" : "Next";

    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
        new TextDisplayBuilder()
            .setContent(`# ${event_name}`)
    )

    container.addSeparatorComponents(
        new SeparatorBuilder()
            .setSpacing(SeparatorSpacingSize.Small)
            .setDivider(true)
    )

    container.addTextDisplayComponents(
        new TextDisplayBuilder()
            .setContent(`**${label}**: <t:${unix_sec}:f> | <t:${unix_sec}:R>`)
    )

    return container;
}

async function resolveSendable(client: Client, channel_id: string): Promise<SendableChannels | null> {
    const channel = client.channels.cache.get(channel_id)
        ?? await client.channels.fetch(channel_id).catch(() => null);

    if (channel && channel.isTextBased() && channel.isSendable()) {
        return channel;
    }
    return null;
}


async function fireEvent(client: Client, event: TimingRow): Promise<void> {
    try {
        const channel = await resolveSendable(client, event.channel_id);
        if (channel) {
            const container = new ContainerBuilder();
            container.addTextDisplayComponents(
                new TextDisplayBuilder()
                    .setContent(`${event.msg}\nStart: <t:${Math.floor(event.event_time / 1000)}:R>`)
            )

            await channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } else {
            console.warn(`Announcement channel ${event.channel_id} not available for ${event.event_name}`);
        }
    } catch (err) {
        console.error(`Failed to send announcement for ${event.event_name}`, err);
    }

    if (event.board_channel_id) {
        try {
            await updateBoardMsg(client, event);
        } catch (err) {
            console.error(`Failed to update board for ${event.event_name}`, err);
        }
    }
}


function displayTimeFor(event: TimingRow): number {
    if (event.type === "once" || event.event_time > Date.now()) {
        return event.event_time;
    }
    return getNextOccurrence(event.event_time, event.type);
}


async function updateBoardMsg(client: Client, event: TimingRow): Promise<void> {
    const board_channel = await resolveSendable(client, event.board_channel_id!);
    if (!board_channel) return;

    const container = buildBoardContainer(event.event_name, displayTimeFor(event), event.type);

    if (event.board_msg_id) {
        try {
            const old_msg = await board_channel.messages.fetch(event.board_msg_id);
            if (old_msg.editable) {
                await old_msg.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
                return;
            }

            if (old_msg.deletable) await old_msg.delete().catch(() => {});
        } catch {
            
        }
    }

    const new_msg = await board_channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
    await db.run(`UPDATE timing SET board_msg_id = ? WHERE id = ?`, new_msg.id, event.id)
}


function isRecurring(type: TimingRow["type"]): boolean {
    return type === "daily" || type === "weekly" || type === "monthly";
}


function advanceToFuture(event_time_ms: number, type: TimingRow["type"]): number {
    if (!isRecurring(type)) return event_time_ms;

    const now = Date.now();
    let t = event_time_ms;
    let guard = 0;

    while (t <= now && guard < 100_000) {
        const next = getNextOccurrence(t, type);
        if (next <= t) break; 
        t = next;
        guard++;
    }

    return t;
}


// Advance one interval using UTC math so results don't drift with the host's
// local timezone / DST. Monthly clamps day-of-month so e.g. Jan 31 -> Feb 28
// instead of overflowing into March.
function getNextOccurrence(event_time_ms: number, type: TimingRow["type"]): number {
    const d = new Date(event_time_ms);
    switch (type) {
        case "daily":   d.setUTCDate(d.getUTCDate() + 1);  break;
        case "weekly":  d.setUTCDate(d.getUTCDate() + 7);  break;
        case "monthly": addUTCMonth(d);                    break;
        default:        return event_time_ms; 
    }
    return d.getTime();
}


function addUTCMonth(d: Date): void {
    const day = d.getUTCDate();
    d.setUTCDate(1); 
    d.setUTCMonth(d.getUTCMonth() + 1);

    const days_in_target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, days_in_target));
}


function msToHuman(ms: number): string {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}h ${m % 60}m`;
    if (m > 0) return `${m}m ${s % 60}s`;
    return `${s}s`;
}
