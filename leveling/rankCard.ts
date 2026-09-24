import { escapeXml, fitText, imageData, renderSvg } from "../utils/svg.js";
import { fmt } from "./ui.js";

// The /level card, in the style of the Amari rank card: an SVG drawn here and
// rasterised by utils/svg.ts.

export interface RankCardData {
    name: string;
    avatar_url: string | null;
    level: number;
    xp: number;
    next_at: number;
    progress: number;       // 0..1 through the current level
    server_rank: number;
    month_rank: number;
    month_xp: number;
    xp_name: string;
}

function statColumn(x: number, top: string, bottom: string, value: string): string {
    return `
        <text x="${x}" y="168" class="label">${top}</text>
        <text x="${x}" y="186" class="label">${bottom}</text>
        <text x="${x}" y="230" class="stat">${escapeXml(value)}</text>`;
}

export function rankCardSvg(d: RankCardData, avatar: string | null): string {
    const W = 1000, H = 300;
    const name = fitText(d.name, 440, [42, 38, 34, 30]);
    const bar = Math.round(700 * Math.min(1, Math.max(0, d.progress)));
    const initial = escapeXml([...d.name.trim()][0]?.toUpperCase() ?? "?");

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
        <clipPath id="av"><circle cx="128" cy="130" r="78"/></clipPath>
        <linearGradient id="gold" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#f7d774"/>
            <stop offset="1" stop-color="#e8b53c"/>
        </linearGradient>
        <style>
            .label { font-family: Poppins, 'DejaVu Sans'; font-weight: 500; font-size: 15px; fill: #949ba4; letter-spacing: 1.2px; }
            .stat { font-family: Poppins, 'DejaVu Sans'; font-weight: 700; font-size: 34px; fill: #f2d27a; }
            .boxlabel { font-family: Poppins, 'DejaVu Sans'; font-weight: 600; font-size: 15px; fill: #949ba4; letter-spacing: 1.5px; }
            .boxvalue { font-family: Poppins, 'DejaVu Sans'; font-weight: 700; font-size: 30px; fill: #f2f3f5; }
            .boxsub { font-family: Poppins, 'DejaVu Sans'; font-weight: 600; font-size: 20px; fill: #949ba4; }
        </style>
    </defs>

    <rect x="0" y="0" width="700" height="260" rx="20" fill="#2b2d31"/>
    <circle cx="128" cy="130" r="84" fill="#1e1f22"/>
    ${avatar
        ? `<image href="${avatar}" x="50" y="52" width="156" height="156" clip-path="url(#av)" preserveAspectRatio="xMidYMid slice"/>`
        : `<circle cx="128" cy="130" r="78" fill="#5865f2"/><text x="128" y="152" text-anchor="middle" font-family="Poppins" font-weight="700" font-size="64" fill="#fff">${initial}</text>`}

    <text x="238" y="${name.size >= 38 ? 104 : 100}" font-family="Poppins, 'DejaVu Sans'" font-weight="700" font-size="${name.size}" fill="url(#gold)">${escapeXml(name.text)}</text>
    ${statColumn(238, "SERVER", "RANK", `#${fmt(d.server_rank)}`)}
    ${statColumn(398, "MONTHLY", "RANK", `#${fmt(d.month_rank)}`)}
    ${statColumn(558, "MONTHLY", d.xp_name.toUpperCase().slice(0, 10), fmt(d.month_xp))}

    <rect x="0" y="274" width="700" height="12" rx="6" fill="#2b2d31"/>
    ${bar > 0 ? `<rect x="0" y="274" width="${Math.max(12, bar)}" height="12" rx="6" fill="url(#gold)"/>` : ""}

    <rect x="716" y="0" width="284" height="124" rx="20" fill="#2b2d31"/>
    <text x="858" y="36" text-anchor="middle" class="boxlabel">LEVEL</text>
    <rect x="736" y="52" width="244" height="56" rx="12" fill="#1e1f22"/>
    <text x="858" y="92" text-anchor="middle" class="boxvalue">${fmt(d.level)}</text>

    <rect x="716" y="136" width="284" height="124" rx="20" fill="#2b2d31"/>
    <text x="858" y="172" text-anchor="middle" class="boxlabel">${escapeXml(d.xp_name.toUpperCase().slice(0, 12))}</text>
    <rect x="736" y="188" width="244" height="56" rx="12" fill="#1e1f22"/>
    <text x="858" y="228" text-anchor="middle"><tspan class="boxvalue" font-size="26">${fmt(d.xp)}</tspan><tspan class="boxsub"> / ${fmt(d.next_at)}</tspan></text>
</svg>`;
}

export async function renderRankCard(d: RankCardData): Promise<Buffer> {
    return renderSvg(rankCardSvg(d, await imageData(d.avatar_url)));
}
