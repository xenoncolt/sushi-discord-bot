import { Client, Events, Message } from "discord.js";
import { isPanelChannel, touchPanel } from "../../birthday/panel.js";

// Keeps the birthday panel at the bottom of its channel. Its own messages are
// not filtered out on purpose: a birthday announcement is exactly the thing
// that pushes the panel up, and a repost triggered by the panel itself costs
// nothing because the sticky pass stops as soon as it sees the panel already
// sitting at the bottom.

export default {
    name: Events.MessageCreate,
    once: false,
    async execute(message: Message, client: Client) {
        if (!message.inGuild()) return;
        if (!isPanelChannel(message.guildId, message.channelId)) return;
        touchPanel(client, message.guild);
    }
};
