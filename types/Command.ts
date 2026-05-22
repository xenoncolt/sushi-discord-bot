import { ApplicationCommandOptionData, ApplicationCommandOptionType, AutocompleteInteraction, ButtonInteraction, ChatInputCommandInteraction, Client, Interaction, ModalSubmitInteraction, StringSelectMenuInteraction } from "discord.js";
import { ExtendedClient } from "./ExtendedClient.js";

export interface Command {
    name: string;
    description: string;
    options?: ApplicationCommandOptionData[];
    cooldown?: number;
    execute: (interaction: ChatInputCommandInteraction, client: ExtendedClient) => Promise<void>;
    autocomplete?: (interaction: AutocompleteInteraction, client: ExtendedClient) => Promise<void>;
    modalSubmit?: (interaction: ModalSubmitInteraction, client: ExtendedClient) => Promise<void>;
    buttonHandler?: (interaction: ButtonInteraction, client: ExtendedClient) => Promise<void>;
    selectMenuHandler?: (interaction: StringSelectMenuInteraction, client: ExtendedClient) => Promise<void>;
}