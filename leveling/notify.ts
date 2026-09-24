import { Client, ContainerBuilder, GuildMember, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags, SectionBuilder, SendableChannels, ThumbnailBuilder } from "discord.js";
import { stripPrefix } from "./prefix.js";
import { MessageTemplate } from "./settings.js";
import { hexToInt, sep, text } from "./ui.js";


export type TemplateVars = Record<string, string | number>;

// {mention}, {level} and friends. Unknown placeholders are left as typed so a
// typo shows up in the message rather than silently vanishing.
export function renderTemplate(input: string, vars: TemplateVars): string {
    return input.replace(/\{(\w+)\}/g, (whole, key: string) =>
        Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : whole
    );
}

export function memberVars(member: GuildMember, xp_name: string): TemplateVars {
    const name = stripPrefix(member.guild.id, member.displayName);
    return {
        name,
        user: name,
        username: member.user.username,
        mention: `<@${member.id}>`,
        server: member.guild.name,
        xp_name
    };
}

export function buildTemplate(tpl: MessageTemplate, vars: TemplateVars, avatar_url: string | null): ContainerBuilder {
    const container = new ContainerBuilder().setAccentColor(hexToInt(tpl.color));

    const title = renderTemplate(tpl.title, vars).trim();
    const body = renderTemplate(tpl.body, vars).trim();
    const content = [title ? `### ${title}` : "", body].filter(Boolean).join("\n") || "​";

    if (tpl.thumbnail && avatar_url) {
        container.addSectionComponents(
            new SectionBuilder()
                .addTextDisplayComponents(text(content))
                .setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar_url))
        );
    } else {
        container.addTextDisplayComponents(text(content));
    }

    const image = renderTemplate(tpl.image, vars).trim();
    if (/^https:\/\/\S+$/.test(image)) {
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(image))
        );
    }

    const footer = renderTemplate(tpl.footer, vars).trim();
    if (footer) {
        container.addSeparatorComponents(sep());
        container.addTextDisplayComponents(text(`-# ${footer}`));
    }

    return container;
}

export async function resolveChannel(client: Client, channel_id: string | null | undefined): Promise<SendableChannels | null> {
    if (!channel_id) return null;
    const channel = client.channels.cache.get(channel_id)
        ?? await client.channels.fetch(channel_id).catch(() => null);
    return channel && channel.isSendable() ? channel : null;
}

// Components V2 message that may ping exactly the listed users and nobody else.
export async function sendContainer(channel: SendableChannels, container: ContainerBuilder, ping: string[] = []): Promise<boolean> {
    try {
        await channel.send({
            components: [container],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [], users: ping }
        });
        return true;
    } catch (err) {
        console.error(`Failed to send to channel ${channel.id}:`, err);
        return false;
    }
}
