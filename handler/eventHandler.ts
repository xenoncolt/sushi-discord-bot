import { Client, Events } from "discord.js";
import { readdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function loadEvents(client: Client) {
    const events_path = resolve(__dirname, './events');
    const events_files = readdirSync(events_path).filter(file => file.endsWith('.ts') || file.endsWith('.js'));

    for (const file of events_files) {
        const file_path = join(events_path, file);
        console.log(`Loading event from: ${file_path}`);

        import(pathToFileURL(file_path).toString()).then(event_module => {
            const event = event_module.default;

            // Support array of events in a single file
            if (Array.isArray(event)) {
                for (const e of event) {
                    registerEvent(client, e);
                }
            } else {
                registerEvent(client, event);
            }
        }).catch((e) => {
            console.error(`Failed to load event file ${file}:`, e);
        });
    }
}

function registerEvent(client: Client, event: { name: string; once?: boolean; execute: (...args: unknown[]) => void }) {
    if (event.once) {
        client.once(event.name as keyof typeof Events, (...args) => event.execute(...args, client));
    } else {
        client.on(event.name as keyof typeof Events, (...args) => event.execute(...args, client));
    }
}