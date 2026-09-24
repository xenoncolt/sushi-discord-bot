import { Resvg, initWasm } from "@resvg/resvg-wasm";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Drawing an SVG and rasterising it with resvg compiled to WebAssembly is how
// every generated image in the bot is made (rank cards, welcome cards). WASM
// means no native binary that could clash with the server's glibc, and a
// render costs a few tens of milliseconds, which the old box shrugs off.

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const FONT_FILES = ["Poppins-Bold.ttf", "Poppins-SemiBold.ttf", "Poppins-Medium.ttf", "DejaVuSans-Bold.ttf"];

let ready: Promise<Uint8Array[]> | null = null;

function fontDir(): string {
    const candidates = [
        resolve(process.cwd(), "assets/fonts"),
        resolve(__dirname, "../assets/fonts"),
        resolve(__dirname, "../../assets/fonts")
    ];
    const found = candidates.find(dir => existsSync(resolve(dir, FONT_FILES[0])));
    if (!found) throw new Error(`Card fonts not found; looked in ${candidates.join(", ")}`);
    return found;
}

function init(): Promise<Uint8Array[]> {
    if (!ready) {
        ready = (async () => {
            await initWasm(readFileSync(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));
            const dir = fontDir();
            return FONT_FILES.map(f => new Uint8Array(readFileSync(resolve(dir, f))));
        })();
        // A failed start (missing font, say) should be retried next time.
        ready.catch(() => { ready = null; });
    }
    return ready;
}

export async function renderSvg(svg: string): Promise<Buffer> {
    const fonts = await init();
    const resvg = new Resvg(svg, {
        font: { fontBuffers: fonts, defaultFontFamily: "Poppins" },
        fitTo: { mode: "original" }
    });
    try {
        const image = resvg.render();
        try {
            return Buffer.from(image.asPng());
        } finally {
            image.free();
        }
    } finally {
        resvg.free();
    }
}

export function escapeXml(s: string): string {
    return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));
}

// Poppins averages a bit over half an em per glyph, so character count times
// the size is a good enough width to keep long names inside their column.
export function fitText(s: string, max_width: number, sizes: number[], ratio = 0.6): { text: string; size: number } {
    const chars = [...s];
    for (const size of sizes) {
        if (chars.length * size * ratio <= max_width) return { text: s, size };
    }
    const smallest = sizes[sizes.length - 1];
    const fit = Math.max(1, Math.floor(max_width / (smallest * ratio)) - 1);
    return { text: chars.slice(0, fit).join("") + "…", size: smallest };
}

// ---- remote images ---------------------------------------------------------

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const TYPES = ["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"];

// Backgrounds are the same handful of URLs over and over, so they are kept as
// ready-made data URIs rather than re-fetched on every single join. Avatars
// differ every time and are not worth a cache entry.
const CACHE_TTL = 15 * 60_000;
const CACHE_MAX = 40;
const cache = new Map<string, { data: string | null; at: number }>();

async function fetchImage(url: string): Promise<string | null> {
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
        if (!res.ok) return null;

        const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        if (type && !TYPES.includes(type)) return null;
        if (Number(res.headers.get("content-length")) > MAX_IMAGE_BYTES) return null;

        const buf = Buffer.from(await res.arrayBuffer());
        if (!buf.length || buf.length > MAX_IMAGE_BYTES) return null;
        return `data:${type || "image/png"};base64,${buf.toString("base64")}`;
    } catch {
        return null;
    }
}

// An image the renderer can inline. Anything that goes wrong — a dead link, a
// PDF behind an image URL, a slow host — comes back as null, and the caller
// draws its fallback instead of failing the whole card.
export async function imageData(url: string | null | undefined, cacheable = false): Promise<string | null> {
    if (!url || !/^https:\/\/\S+$/.test(url)) return null;
    if (!cacheable) return fetchImage(url);

    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < CACHE_TTL) return hit.data;

    const data = await fetchImage(url);
    // A miss is cached too, so a broken background doesn't mean a doomed
    // request on every join.
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(url, { data, at: Date.now() });
    return data;
}
