import { Client, ContainerBuilder, MessageFlags, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder } from "discord.js";
import { createTimingTable } from "../schema/timingDB";
import { TimingRow } from "../types/TimingRow.js";


const db = await createTimingTable();




export function scheduleEvent(client: Client, event: TimingRow) {
    const delay = event.event_time - Date.now();

    if (delay <= 0) {
        if (event.type === 'once') {
            db.run(`DELETE FROM timing WHERE id = ?`, event.id).catch(console.error);
            return;
        }

        const next_time = advanceToFuture(event.event_time, event.type);
        db.run(`UPDATE timing SET event_time = ? WHERE id = ?`, next_time, event.id).catch(console.error);
        scheduleEvent(client, {...event, event_time: next_time});
        return
    }

    if (event.board_channel_id) {
        updateBoardMsg(client, event).catch(console.error);
    }

    setTimeout(async () => {
        const re_event = await db.get<TimingRow>(`SELECT * FROM timing WHERE id = ?`, event.id) ?? event;
        await fireEvent(client, re_event);
        
        if (event.type === "once") {
            await db.run(`DELETE FROM timing WHERE id = ?`, event.id);
            console.log(`${event.event_name} Onetime event works`)
        } else {
            const next_time = getNextOccurrence(event.event_time, event.type);
            
            await db.run(`UPDATE timing SET event_time = ? WHERE id = ?`, next_time, event.id);
            
            const updated = await db.get<TimingRow>(`SELECT * FROM timing WHERE id = ?`, event.id);

            if (updated) scheduleEvent(client, updated);
        }
    }, delay);
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



async function fireEvent(client: Client, event: TimingRow): Promise<void> {
    const channel = client.channels.cache.get(event.channel_id);

    if (channel?.isTextBased() && channel.isSendable()) {
        try {
            const container = new ContainerBuilder();
            container.addTextDisplayComponents(
                new TextDisplayBuilder()
                    .setContent(`${event.msg}\nStart: <t:${Math.floor(event.event_time / 1000)}:R>`)
            )

            await channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (err) {
            console.error(`Failed to send announcement for ${event.event_name}`, err);
        }
    } else {
        console.warn(`Announcement channel ${event.channel_id} not available for ${event.event_name}`);
    }

    if (event.board_channel_id) {
        await updateBoardMsg(client, event);
    }
}


async function updateBoardMsg(client: Client, event: TimingRow): Promise<void> {
    const board_channel = client.channels.cache.get(event.board_channel_id!);
    if (!board_channel?.isTextBased() || !board_channel.isSendable()) return;

    // const display_time = event.type === "once" ? event.event_time : getNextOccurrence(event.event_time, event.type);

    const container = buildBoardContainer(event.event_name, event.event_time, event.type);

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



function advanceToFuture(event_time_ms: number, type: TimingRow["type"]): number {
    let t = event_time_ms;
    while (t <= Date.now()) {
        t = getNextOccurrence(t, type);
    }
    return t;
}


function getNextOccurrence(event_time_ms: number, type: TimingRow["type"]): number {
    const d = new Date(event_time_ms);
    switch (type) {
        case "daily":   d.setDate(d.getDate() + 1);      break;
        case "weekly":  d.setDate(d.getDate() + 7);      break;
        case "monthly": d.setMonth(d.getMonth() + 1);    break;
    }
    return d.getTime();
}

function msToHuman(ms: number): string {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}h ${m % 60}m`;
    if (m > 0) return `${m}m ${s % 60}s`;
    return `${s}s`;
}