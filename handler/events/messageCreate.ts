import { AttachmentBuilder, ChannelType, Client, Events, GuildMember, Message, MessageFlags } from "discord.js";


export default {
    name: Events.MessageCreate,
    once: false,
    async execute(msg: Message, client: Client) {
        if (msg.author.bot) return;

        // Bot mention handling
        if (msg.mentions.has(client.user!) && (msg.content.replace(/<@!?[0-9]+>/, '') === '')) {
            await msg.reply('Did you just mention me?\nSo, Anything you need?');
        }
    }
}
