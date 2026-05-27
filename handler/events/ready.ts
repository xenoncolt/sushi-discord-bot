import { Client, Events } from "discord.js";
import { registerSlashCommands } from "../slashCommandHandler.js";
import { ExtendedClient } from "../../types/ExtendedClient.js";
import { dailyReminder, guildShowdownMention, guildShowdownReminder, guildPartyReminder, guildWarReminder, breakingArmyReminder, guildBreakingArmyMention, weeklyReminder } from "../../utils/wwm-reminders.js";
import { startEventScheduler } from "../../utils/eventScheduler.js";

export default {
    name: Events.ClientReady,
    once: true,
    async execute(client: Client) {
        console.log(`Ready! Logged in as ${client.user?.tag}`);

        // Register slash commands
        console.log(`Loading slash cmds for ${client.user?.tag}`);
        await registerSlashCommands(client as ExtendedClient);

        // reminders
        await startEventScheduler(client);
        
        // setInterval(async () => {
        //     await checkGuildWarAttendance(client);
        // }, 30 * 1000);

        // setInterval(async () => {
        //     await cleanupExpiredGuildWars(client);
        // }, 5 * 60 * 1000);

        // Status rotation
        let status_index = 0;
        setInterval(() => {
            const sts = [
                { name: `custom`, type: 4, state: `😗 I love myself(sushi)` as const},
                { name: `custom`, type: 4, state: `🍴 Wanna eat me?` as const},
                { name: `custom`, type: 4, state: `👌 I(sushi) am perfect` as const},
            ];
            client.user?.setPresence({
                activities: [sts[status_index]],
                status: 'idle'
            });

            status_index = (status_index + 1) % sts.length;
        }, 1 * 60 * 1000);
    }
}