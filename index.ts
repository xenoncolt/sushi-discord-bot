import { Client, Collection, Events, GatewayIntentBits, Partials } from "discord.js";
import "dotenv/config";
import { recoverStakes } from "./games/common.js";
import { loadCommands } from "./handler/slashCommandHandler.js";
import { loadEvents } from "./handler/eventHandler.js";
import { ExtendedClient } from "./types/ExtendedClient.js";
import { Command } from "./types/Command.js";



const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        // Privileged - has to be switched on in the developer portal too, or
        // login fails with "Used disallowed intents". The AI replies need it to
        // hear her name without a ping and to read the chat leading up to it.
        GatewayIntentBits.MessageContent,
        // Voice XP reads who is sitting in which voice channel.
        GatewayIntentBits.GuildVoiceStates,
        // Privileged, like MessageContent. Leaderboards show server nicknames,
        // /levelsync walks every member, and "reset XP of left users" needs
        // to hear when someone leaves.
        GatewayIntentBits.GuildMembers
    ],
    // So a member who leaves before they were ever cached still fires the
    // leave event.
    partials: [Partials.GuildMember],
    // Re-uploading a batch of application screenshots takes longer than the 15
    // second default, and hitting that aborts the whole review post.
    rest: { timeout: 60_000 }
}) as ExtendedClient;

client.commands = new Collection<string, Command>();

// Load commands and events from their respective folders
loadCommands(client);
loadEvents(client);

// One failed promise or a gateway hiccup somewhere shouldn't take the whole
// bot offline: log it and keep running.
process.on("unhandledRejection", err => console.error("Unhandled promise rejection:", err));
client.on(Events.Error, err => console.error("Discord client error:", err));

// Games keep their state in memory, so a crash or restart mid-game would eat
// the bets of everyone playing. Hand those back before anyone can start a
// new game.
recoverStakes();

client.login(process.env.TOKEN);