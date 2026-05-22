import { Client, Collection, GatewayIntentBits, Partials } from "discord.js";
import "dotenv/config";
import { loadCommands } from "./handler/slashCommandHandler.js";
import { loadEvents } from "./handler/eventHandler.js";
import { ExtendedClient } from "./types/ExtendedClient.js";
import { Command } from "./types/Command.js";



const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
}) as ExtendedClient;

client.commands = new Collection<string, Command>();

// Load commands and events from their respective folders
loadCommands(client);
loadEvents(client);



client.login(process.env.TOKEN);