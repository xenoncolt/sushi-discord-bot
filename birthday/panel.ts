import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, ContainerBuilder, Guild, MessageFlags } from "discord.js";
import { buildTemplate, resolveChannel } from "../leveling/notify.js";
import { getSettings, getState, setState } from "../leveling/settings.js";
import { countBirthdays } from "./store.js";


// The panel is the message with the "set my birthday" button. It is meant to
// live at the bottom of its channel, so whenever anything is posted under it
// (a birthday announcement above all) it is taken down and posted again.
//
// Which message that is lives in guild_state, not in memory: if the bot stops
// between posting a new panel and deleting the old one, the next start still
// knows which message to clean up instead of leaving a column of dead panels.
const STATE_KEY = "bd_panel";

// How long to wait after a message before moving the panel. Long enough that a
// burst of chatter costs one repost rather than twenty.
const STICKY_DELAY = 8_000;

function stored(guild_id: string): { channel_id: string | null; message_id: string | null } {
    const raw = getState(guild_id, STATE_KEY);
    if (!raw) return { channel_id: null, message_id: null };
    const [channel_id, message_id] = raw.split(":");
    return { channel_id: channel_id || null, message_id: message_id || null };
}

export function buildPanel(guild: Guild): ContainerBuilder {
    const settings = getSettings(guild.id).birthday;
    const container = buildTemplate(
        settings.templates.panel,
        { server: guild.name, count: countBirthdays(guild.id) },
        guild.iconURL({ extension: "png", size: 256 })
    );

    return container.addActionRowComponents(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId("birthday:set").setStyle(ButtonStyle.Primary).setLabel(settings.set_label),
            new ButtonBuilder().setCustomId("birthday:remove").setStyle(ButtonStyle.Secondary).setLabel(settings.remove_label),
            new ButtonBuilder().setCustomId("birthday:list").setStyle(ButtonStyle.Secondary).setLabel(settings.list_label)
        )
    );
}

// "sync" rewrites the panel wherever it is (settings changed, start-up).
// "sticky" only moves it when something was posted underneath.
export type PanelMode = "sync" | "sticky";

const working = new Set<string>();

export async function refreshPanel(client: Client, guild: Guild, mode: PanelMode = "sync"): Promise<void> {
    if (working.has(guild.id)) return;
    working.add(guild.id);
    try {
        const settings = getSettings(guild.id).birthday;
        const target = settings.enabled ? settings.panel_channel : null;
        let { channel_id, message_id } = stored(guild.id);

        // Panel moved to another channel, or switched off: take the old one
        // down first so it can't be clicked any more.
        if (channel_id && channel_id !== target) {
            const old = await resolveChannel(client, channel_id);
            if (old && "messages" in old && message_id) await old.messages.delete(message_id).catch(() => {});
            setState(guild.id, STATE_KEY, null);
            channel_id = null;
            message_id = null;
        }
        if (!target) return;

        const channel = await resolveChannel(client, target);
        if (!channel || !("messages" in channel)) return;

        if (channel_id === target && message_id) {
            // Already the newest message in the channel, or stickiness is off:
            // edit it where it is instead of making everyone scroll past a
            // brand new copy.
            if (!settings.panel_sticky || channel.lastMessageId === message_id) {
                if (mode === "sticky") return;
                const edited = await channel.messages.edit(message_id, {
                    components: [buildPanel(guild)],
                    allowedMentions: { parse: [] }
                }).catch(() => null);
                if (edited) return;
                // Falls through when the message was deleted by hand.
            } else {
                await channel.messages.delete(message_id).catch(() => {});
            }
        }

        const sent = await channel.send({
            components: [buildPanel(guild)],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] }
        }).catch(err => {
            console.error(`Could not post the birthday panel in ${target}:`, err.message ?? err);
            return null;
        });

        // Stored before anything else can happen to it, so a crash right here
        // still leaves the next start able to find this message.
        if (sent) setState(guild.id, STATE_KEY, `${target}:${sent.id}`);
    } finally {
        working.delete(guild.id);
    }
}

export async function syncPanels(client: Client, only_guild?: string): Promise<void> {
    for (const guild of client.guilds.cache.values()) {
        if (only_guild && guild.id !== only_guild) continue;
        await refreshPanel(client, guild, "sync").catch(err => console.error(`Birthday panel sync failed for ${guild.id}:`, err));
    }
}

// Is this the channel the panel sits in? Called for every message in every
// server, so it stays a couple of map lookups.
export function isPanelChannel(guild_id: string, channel_id: string): boolean {
    const settings = getSettings(guild_id).birthday;
    return settings.enabled && settings.panel_sticky && settings.panel_channel === channel_id;
}

const pending = new Map<string, ReturnType<typeof setTimeout>>();

// Something was posted in the panel's channel. The first message of a burst
// starts the clock; everything posted while it runs rides along with it.
export function touchPanel(client: Client, guild: Guild): void {
    if (pending.has(guild.id)) return;
    pending.set(guild.id, setTimeout(() => {
        pending.delete(guild.id);
        refreshPanel(client, guild, "sticky").catch(err => console.error(`Birthday panel repost failed for ${guild.id}:`, err));
    }, STICKY_DELAY));
}
