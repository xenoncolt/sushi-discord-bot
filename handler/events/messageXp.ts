import { Events, Message } from "discord.js";
import { takeChatCooldown } from "../../leveling/chatCooldown.js";
import { getSettings } from "../../leveling/settings.js";
import { recordMessage } from "../../leveling/stats.js";
import { grantActivityXp } from "../../leveling/xp.js";

// Chat XP. Lives in its own file so it runs whether or not the AI replies in
// messageCreate.ts are switched on.

export default {
    name: Events.MessageCreate,
    once: false,
    async execute(message: Message) {
        if (message.author.bot || message.system || message.webhookId) return;
        if (!message.inGuild()) return;

        const guild_id = message.guildId;
        recordMessage(guild_id, message.author.id, message.channelId);

        const settings = getSettings(guild_id).server;
        if (settings.chat_xp <= 0) return;

        if (!takeChatCooldown(guild_id, message.author.id, settings.chat_cooldown)) return;

        const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
        if (!member) return;

        const here = message.channel.isSendable() ? message.channel : null;
        await grantActivityXp(member, settings.chat_xp, "chat", here, message.channel)
            .catch(err => console.error(`Chat XP failed for ${message.author.id}:`, err));
    }
};
