import { renderTemplate } from "../leveling/notify.js";
import { WelcomeCard } from "../leveling/settings.js";
import { escapeXml, fitText, imageData, renderSvg } from "../utils/svg.js";

// The image posted with the welcome message: the member's avatar and name over
// whatever background the server picked. Everything about it comes from the
// dashboard, so this file only decides where things sit, never what they say.

const W = 1000, H = 350;

// Space between the three lines of text.
const GAP = 16;

export interface WelcomeCardData {
    name: string;
    username: string;
    avatar_url: string | null;
    server: string;
    count: number;
}

// "1st", "22nd", "113th" — used by both the card and the message.
export function ordinal(n: number): string {
    const teens = n % 100;
    if (teens >= 11 && teens <= 13) return `${n}th`;
    return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

export function cardVars(d: WelcomeCardData): Record<string, string | number> {
    return {
        name: d.name,
        user: d.name,
        username: d.username,
        server: d.server,
        count: d.count,
        ordinal: ordinal(d.count)
    };
}

// The clip path and the ring have to trace the same outline, so both come
// from here; `extra` is spliced in before the tag closes.
function shape(kind: WelcomeCard["avatar_shape"], cx: number, cy: number, r: number, extra = ""): string {
    const attrs = kind === "circle"
        ? `<circle cx="${cx}" cy="${cy}" r="${r}"`
        : `<rect x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" rx="${kind === "rounded" ? Math.round(r * 0.34) : 0}"`;
    return `${attrs}${extra}/>`;
}

function line(x: number, y: number, s: string, size: number, weight: number, fill: string, anchor: string, spacing = 0): string {
    if (!s) return "";
    return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="Poppins, 'DejaVu Sans'" font-weight="${weight}"`
        + ` font-size="${size}" fill="${fill}"${spacing ? ` letter-spacing="${spacing}"` : ""}>${escapeXml(s)}</text>`;
}

export function welcomeCardSvg(card: WelcomeCard, d: WelcomeCardData, avatar: string | null, background: string | null): string {
    const vars = cardVars(d);
    const centred = card.layout === "center";

    // Centred, the text sits under the avatar and has far less height to work
    // with, so it starts from a smaller ladder of sizes.
    const r = centred ? 62 : 82;
    const av_x = centred ? W / 2 : 130;
    const av_y = centred ? 100 : H / 2;
    const text_x = centred ? W / 2 : av_x + r + 58;
    const max_text = centred ? 880 : W - text_x - 56;
    const anchor = centred ? "middle" : "start";

    const rows = [
        { text: card.title, sizes: centred ? [46, 42, 36, 32, 28] : [54, 48, 42, 36, 30], ratio: 0.62, weight: 700, fill: card.text_color, spacing: centred ? 1.5 : 0 },
        { text: card.subtitle, sizes: centred ? [28, 25, 22, 19] : [32, 28, 24, 20], ratio: 0.58, weight: 600, fill: card.sub_color, spacing: 0 },
        { text: card.footer, sizes: centred ? [19, 17, 15] : [21, 19, 17], ratio: 0.56, weight: 500, fill: card.sub_color, spacing: 0 }
    ]
        .map(row => ({ ...row, fitted: fitText(renderTemplate(row.text, vars).trim(), max_text, row.sizes, row.ratio) }))
        // A card with no footer shouldn't leave a hole where one would go.
        .filter(row => row.fitted.text);

    // Centred: the block is centred in whatever is left below the avatar.
    // Alongside: centred against the avatar itself.
    const area_top = centred ? av_y + r + 24 : 0;
    const height = rows.reduce((h, row) => h + row.fitted.size * 1.15, 0) + GAP * Math.max(0, rows.length - 1);
    let y = area_top + (H - area_top) / 2 - height / 2;

    const drawn = rows.map(row => {
        // The baseline sits about seven eighths of the way down a line box.
        y += row.fitted.size * 0.88;
        const svg = line(text_x, Math.round(y), row.fitted.text, row.fitted.size, row.weight, row.fill, anchor, row.spacing);
        y += row.fitted.size * 0.27 + GAP;
        return svg;
    });

    const initial = escapeXml([...d.name.trim()][0]?.toUpperCase() ?? "?");

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
        <clipPath id="avatar">${shape(card.avatar_shape, av_x, av_y, r)}</clipPath>
        <radialGradient id="glow">
            <stop offset="0" stop-color="${card.accent}" stop-opacity="0.5"/>
            <stop offset="1" stop-color="${card.accent}" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#000" stop-opacity="0.1"/>
            <stop offset="0.55" stop-color="#000" stop-opacity="0.3"/>
            <stop offset="1" stop-color="#000" stop-opacity="0.66"/>
        </linearGradient>
    </defs>

    <rect width="${W}" height="${H}" fill="${card.background_color}"/>
    ${background ? `<image href="${background}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>` : ""}
    ${/* The dimming exists to keep text readable over a photo, so a server
          that picked a flat colour gets exactly the colour it picked. */ ""}
    ${background && card.overlay > 0 ? `<rect width="${W}" height="${H}" fill="#000" opacity="${card.overlay / 100}"/>` : ""}
    ${background ? `<rect width="${W}" height="${H}" fill="url(#scrim)"/>` : ""}

    <circle cx="${av_x}" cy="${av_y}" r="${Math.round(r * 2.1)}" fill="url(#glow)"/>
    ${avatar
        ? `<image href="${avatar}" x="${av_x - r}" y="${av_y - r}" width="${r * 2}" height="${r * 2}" clip-path="url(#avatar)" preserveAspectRatio="xMidYMid slice"/>`
        : shape(card.avatar_shape, av_x, av_y, r, ` fill="${card.accent}"`)
          + line(av_x, av_y + r * 0.36, initial, Math.round(r * 1.05), 700, "#ffffff", "middle")}
    ${card.avatar_ring
        // A dark ring under the accent one lifts the avatar off a light photo.
        ? shape(card.avatar_shape, av_x, av_y, r + 7, ` fill="none" stroke="#000000" stroke-width="10" opacity="0.28"`)
          + shape(card.avatar_shape, av_x, av_y, r + 6, ` fill="none" stroke="${card.accent}" stroke-width="6"`)
        : ""}

    ${drawn.join("\n    ")}
</svg>`;
}

export async function renderWelcomeCard(card: WelcomeCard, d: WelcomeCardData): Promise<Buffer> {
    // The background is the same URL on every join, so it is cached; the
    // avatar is a different person every time and is not worth an entry.
    const [avatar, background] = await Promise.all([
        imageData(d.avatar_url),
        imageData(card.background, true)
    ]);
    return renderSvg(welcomeCardSvg(card, d, avatar, background));
}
