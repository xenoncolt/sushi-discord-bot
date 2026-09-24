import { Client, Events } from "discord.js";
import { birthdayTick } from "../../birthday/announce.js";
import { syncPanels } from "../../birthday/panel.js";
import { startDashboard } from "../../dashboard/server.js";
import { resyncRecoveredRoles } from "../../games/common.js";
import { pruneActivity } from "../../leveling/activity.js";
import { restoreChatCooldowns, saveChatCooldowns } from "../../leveling/chatCooldown.js";
import { loanTick, startLoans } from "../../leveling/loans.js";
import { updateChannelBoards } from "../../leveling/leaderboard.js";
import { seasonTick } from "../../leveling/season.js";
import { pruneExpiredBoosts } from "../../leveling/settings.js";
import { expireTimedRoles } from "../../leveling/shop.js";
import { flushStats, pruneStats, recordMemberCount } from "../../leveling/stats.js";
import { finalHeartbeat, heartbeat } from "../../leveling/uptime.js";
import { restoreVoiceBank, saveVoiceBank, voiceTick } from "../../leveling/voice.js";

// Background jobs for the leveling system. Each runs on its own timer and
// never overlaps itself, so a slow Discord API call can't pile up work.
function every(ms: number, name: string, job: () => Promise<void> | void): void {
    let running = false;
    setInterval(async () => {
        if (running) return;
        running = true;
        try {
            await job();
        } catch (err) {
            console.error(`Background job "${name}" failed:`, err);
        } finally {
            running = false;
        }
    }, ms);
}

export default {
    name: Events.ClientReady,
    once: true,
    async execute(client: Client) {
        // Before anything else (and before any queued command runs): note how
        // long the bot was away, so a /daily right after start-up already
        // knows which days were lost to downtime.
        heartbeat(client);
        restoreVoiceBank();
        restoreChatCooldowns();

        // Nicknames on the leaderboards, voice channel members and level sync
        // all read the member cache, so fill it once up front.
        for (const guild of client.guilds.cache.values()) {
            await guild.members.fetch().catch(err => console.error(`Could not load members of ${guild.name}:`, err.message ?? err));
        }
        await resyncRecoveredRoles(client);
        startLoans(client);

        every(60_000, "heartbeat", () => void heartbeat(client));
        every(60_000, "voice xp", () => voiceTick(client));
        every(60_000, "stats flush", () => {
            for (const guild of client.guilds.cache.values()) recordMemberCount(guild.id, guild.memberCount);
            flushStats();
        });
        every(60_000, "season", () => seasonTick(client));
        // Announcements the bot was offline for still go out, as long as it is
        // back before the day is over. Also puts yesterday's birthday role away.
        every(60_000, "birthdays", () => birthdayTick(client));
        every(60_000, "shop expiry", () => expireTimedRoles(client));
        // Loans are collected on their due time, so this runs more often.
        every(15_000, "loans", () => loanTick(client));
        every(6 * 60 * 60_000, "cleanup", () => {
            pruneActivity();
            pruneStats();
            for (const id of client.guilds.cache.keys()) pruneExpiredBoosts(id);
        });

        // Whatever happened while the bot was away, the panel belongs at the
        // bottom of its channel: this reposts it and clears up the old one.
        setTimeout(() => syncPanels(client).catch(err => console.error("Birthday panel sync failed:", err)), 15_000);

        // Leaderboard posts refresh on the hour, every hour (and once shortly
        // after start-up so a restart doesn't leave them stale).
        setTimeout(() => updateChannelBoards(client).catch(err => console.error("Leaderboard update failed:", err)), 30_000);
        const to_next_hour = 3_600_000 - (Date.now() % 3_600_000) + 5_000;
        setTimeout(() => {
            updateChannelBoards(client).catch(err => console.error("Leaderboard update failed:", err));
            every(60 * 60_000, "leaderboard channels", () => updateChannelBoards(client));
        }, to_next_hour);

        // A clean stop (Ctrl+C, pm2/systemd restart) saves what only lives in
        // memory: stats not yet flushed, unfinished voice minutes and chat
        // cooldowns. XP, dailies, streaks and bets are in the database already.
        for (const signal of ["SIGINT", "SIGTERM"] as const) {
            process.once(signal, () => {
                const steps = [flushStats, saveVoiceBank, saveChatCooldowns, () => finalHeartbeat(client)];
                for (const step of steps) {
                    try {
                        step();
                    } catch (err) {
                        console.error("Shutdown save failed:", err);
                    }
                }
                process.exit(0);
            });
        }

        startDashboard(client);
    }
};
