import { Client } from "discord.js";
import { getSettings } from "./settings.js";
import { recordVoiceMinute } from "./stats.js";
import { getBotState, isConnected, setBotState } from "./uptime.js";
import { grantActivityXp } from "./xp.js";


// Voice XP is paid per 5 minutes in a channel. The ticker runs every minute
// and each member banks one minute (weighted by the mute rule) per tick, so
// joining 30 seconds before a payout doesn't earn a full block.
const BLOCK_MINUTES = 5;

interface Banked {
    minutes: number;
    weight: number;   // sum of per-minute factors, 1 = full XP, 0.5 = half
}

const banked = new Map<string, Banked>();

export async function voiceTick(client: Client): Promise<void> {
    // While Discord is unreachable the voice channel lists are frozen, and
    // paying from them would reward people who may have left long ago.
    if (!isConnected(client)) return;

    const seen = new Set<string>();

    for (const guild of client.guilds.cache.values()) {
        const settings = getSettings(guild.id).server;

        for (const state of guild.voiceStates.cache.values()) {
            const member = state.member;
            const channel = state.channel;
            if (!member || member.user.bot || !channel) continue;
            if (channel.id === guild.afkChannelId) continue;

            recordVoiceMinute(guild.id, member.id);
            if (settings.voice_xp <= 0) continue;

            if (settings.voice_require_company) {
                const humans = channel.members.filter(m => !m.user.bot).size;
                if (humans < 2) continue;
            }

            // Self mute/deafen only. A server mute is a moderator's call and
            // is deliberately not held against the member.
            let factor = 1;
            if (state.selfMute || state.selfDeaf) {
                if (settings.voice_mute_mode === "block") continue;
                if (settings.voice_mute_mode === "reduce") factor = 1 - settings.voice_mute_reduction / 100;
            }

            const key = `${guild.id}|${member.id}`;
            seen.add(key);
            const bank = banked.get(key) ?? { minutes: 0, weight: 0 };
            bank.minutes++;
            bank.weight += factor;

            if (bank.minutes >= BLOCK_MINUTES) {
                const avg = bank.weight / bank.minutes;
                banked.delete(key);
                const here = channel.isSendable() ? channel : null;
                await grantActivityXp(member, settings.voice_xp, "voice", here, channel, avg)
                    .catch(err => console.error(`Voice XP failed for ${member.id}:`, err));
            } else {
                banked.set(key, bank);
            }
        }
    }

    // Leaving (or becoming ineligible) forfeits the unfinished block.
    for (const key of banked.keys()) {
        if (!seen.has(key)) banked.delete(key);
    }
}

// A clean shutdown saves the unfinished blocks, so restarting for an update
// doesn't cost anyone the minutes they already sat through. Only a quick
// restart gets them back; after a longer stop people have moved on.
const RESTORE_WITHIN_MS = 10 * 60_000;

export function saveVoiceBank(): void {
    setBotState("voice_bank", JSON.stringify({ at: Date.now(), bank: [...banked] }));
}

export function restoreVoiceBank(): void {
    const raw = getBotState("voice_bank");
    if (!raw) return;
    setBotState("voice_bank", null);
    try {
        const saved = JSON.parse(raw) as { at: number; bank: [string, Banked][] };
        if (Date.now() - saved.at > RESTORE_WITHIN_MS) return;
        // Anyone no longer in a channel is dropped by the next tick.
        for (const [key, bank] of saved.bank) banked.set(key, bank);
    } catch {
        // A damaged snapshot only costs a few voice minutes.
    }
}
