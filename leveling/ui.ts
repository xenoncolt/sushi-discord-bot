import { ActionRowBuilder, APIMessageComponentEmoji, ButtonBuilder, ButtonStyle, ContainerBuilder, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder } from "discord.js";


export const COLOR = {
    brand: 0xd6336c,
    win: 0x2f9e44,
    lose: 0xe03131,
    push: 0x868e96,
    gold: 0xf59f00,
    info: 0x4dabf7,
    pending: 0x7048e8
} as const;

export function fmt(n: number): string {
    return Math.round(n).toLocaleString("en-US");
}

export function signed(n: number): string {
    return `${n >= 0 ? "+" : "-"}${fmt(Math.abs(n))}`;
}

export function hexToInt(hex: string): number {
    return parseInt(hex.replace("#", ""), 16) || COLOR.brand;
}

export function progressBar(current: number, total: number, width = 12): string {
    const ratio = total > 0 ? Math.min(1, Math.max(0, current / total)) : 0;
    const filled = Math.round(ratio * width);
    return "▰".repeat(filled) + "▱".repeat(width - filled);
}

export function text(content: string): TextDisplayBuilder {
    return new TextDisplayBuilder().setContent(content);
}

export function sep(divider = true, large = false): SeparatorBuilder {
    return new SeparatorBuilder()
        .setDivider(divider)
        .setSpacing(large ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small);
}

export function box(color: number, ...lines: string[]): ContainerBuilder {
    return new ContainerBuilder()
        .setAccentColor(color)
        .addTextDisplayComponents(text(lines.join("\n")));
}

export function linkRow(...links: { label: string; url: string; emoji?: string }[]): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        links.map(l => {
            const b = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(l.label).setURL(l.url);
            if (l.emoji) b.setEmoji(l.emoji);
            return b;
        })
    );
}

// Where the dashboard is reachable from the outside, without a trailing slash.
export function dashboardUrl(): string | null {
    const url = process.env.DASHBOARD_URL?.trim();
    return url ? url.replace(/\/+$/, "") : null;
}


// Discord turns down the whole message over one emoji it doesn't recognise,
// and discord.js hands anything at all straight through as a name, so what
// somebody typed has to be checked here: either the <:name:id> form of a
// custom emoji, or something that really is a unicode emoji.
const CUSTOM_EMOJI = /^<(a)?:(\w{2,32}):(\d{15,21})>$/;
const EMOJI_PARTS = /^[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\u200d\ufe0f\u20e3\d#*]{1,20}$/u;
// Digits and modifiers alone are not an emoji; one of these has to be in there.
const EMOJI_CORE = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u;

export function resolveEmoji(raw: string): APIMessageComponentEmoji | null {
    const emoji = raw.trim();
    if (!emoji) return null;

    const custom = CUSTOM_EMOJI.exec(emoji);
    if (custom) return { id: custom[3], name: custom[2], animated: Boolean(custom[1]) };

    return EMOJI_PARTS.test(emoji) && EMOJI_CORE.test(emoji) ? { name: emoji } : null;
}
