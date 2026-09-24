import { getBotState, setBotState } from "./uptime.js";

// Chat XP pays at most once per cooldown. A clean shutdown saves the last
// payouts, so a restart doesn't hand everyone who just chatted a second one.

// The longest cooldown the dashboard allows.
const MAX_MS = 60 * 60 * 1000;

const last_award = new Map<string, number>();

// Entries only matter for as long as the cooldown lasts.
setInterval(() => {
    const cutoff = Date.now() - MAX_MS;
    for (const [key, at] of last_award) {
        if (at < cutoff) last_award.delete(key);
    }
}, 10 * 60 * 1000).unref();

// True (and the clock restarts) when the member may earn chat XP again.
export function takeChatCooldown(guild_id: string, user_id: string, seconds: number): boolean {
    if (seconds <= 0) return true;
    const key = `${guild_id}|${user_id}`;
    const now = Date.now();
    if (now - (last_award.get(key) ?? 0) < seconds * 1000) return false;
    last_award.set(key, now);
    return true;
}

export function saveChatCooldowns(): void {
    const cutoff = Date.now() - MAX_MS;
    setBotState("chat_cooldowns", JSON.stringify([...last_award].filter(([, at]) => at >= cutoff)));
}

export function restoreChatCooldowns(): void {
    const raw = getBotState("chat_cooldowns");
    if (!raw) return;
    setBotState("chat_cooldowns", null);
    try {
        for (const [key, at] of JSON.parse(raw) as [string, number][]) {
            if (at > (last_award.get(key) ?? 0)) last_award.set(key, at);
        }
    } catch {
        // Worst case somebody gets one message's XP early.
    }
}
