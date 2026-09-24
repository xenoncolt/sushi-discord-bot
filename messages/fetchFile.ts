import { Guild, GuildPremiumTier } from "discord.js";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// Downloading the files a message wants to upload.
//
// The URLs come from the dashboard, which only admins and managers can reach,
// but "somebody I trust typed it" is not the same as "safe to fetch": a URL
// pointing at 127.0.0.1 or a cloud metadata endpoint would have the bot read
// something off its own host and post it into a Discord channel. So every hop
// is resolved and checked before a single byte is asked for.

// Generous enough for a picture or a short clip, small enough that a handful
// of them at once can't push the bot's box into swap. Servers with a higher
// Discord limit can go further, up to this ceiling.
const MAX_BYTES = 25 * 1024 * 1024;
const TIMEOUT = 15_000;
const MAX_REDIRECTS = 3;

// What Discord itself will accept from this server.
export function uploadLimit(guild: Guild): number {
    const by_tier: Record<number, number> = {
        [GuildPremiumTier.None]: 10,
        [GuildPremiumTier.Tier1]: 10,
        [GuildPremiumTier.Tier2]: 50,
        [GuildPremiumTier.Tier3]: 100
    };
    return Math.min((by_tier[guild.premiumTier] ?? 10) * 1024 * 1024, MAX_BYTES);
}


// ---- where a URL is allowed to point --------------------------------------

function privateV4(ip: string): boolean {
    const p = ip.split(".").map(Number);
    if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = p;
    return (
        a === 0 ||                          // "this network"
        a === 10 ||                         // private
        a === 127 ||                        // loopback
        (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
        (a === 169 && b === 254) ||         // link-local, which is where cloud metadata lives
        (a === 172 && b >= 16 && b <= 31) || // private
        (a === 192 && b === 0) ||           // IETF protocol assignments
        (a === 192 && b === 168) ||         // private
        (a === 198 && b >= 18 && b <= 19) || // benchmarking
        a >= 224                            // multicast and reserved
    );
}

function privateV6(ip: string): boolean {
    const addr = ip.toLowerCase().split("%")[0];
    if (addr === "::" || addr === "::1") return true;
    // An IPv4 address wearing an IPv6 hat.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
    if (mapped) return privateV4(mapped[1]);
    const head = addr.split(":")[0];
    // fc00::/7 unique-local, fe80::/10 link-local.
    return /^f[cd]/.test(head) || /^fe[89ab]/.test(head);
}

function privateAddress(ip: string): boolean {
    const kind = isIP(ip);
    if (kind === 4) return privateV4(ip);
    if (kind === 6) return privateV6(ip);
    return true;
}

// Resolves the host and refuses anything that lands somewhere off the public
// internet. This is a check before the request rather than during it, so a
// host that answers differently a moment later could still slip through —
// closing that hole properly needs a custom connect handler, which is more
// machinery than a picture upload deserves.
async function reachable(target: URL): Promise<boolean> {
    if (target.protocol !== "https:" && target.protocol !== "http:") return false;

    const host = target.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host)) return !privateAddress(host);

    try {
        const addresses = await lookup(host, { all: true });
        return addresses.length > 0 && addresses.every(a => !privateAddress(a.address));
    } catch {
        return false;
    }
}


// ---- the download ---------------------------------------------------------

const EXTENSIONS: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/avif": ".avif",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg",
    "application/pdf": ".pdf",
    "text/plain": ".txt",
    "application/zip": ".zip"
};

// Discord shows a preview based on the extension, so a URL that ends in
// nothing useful gets one from the content type.
function fileName(target: URL, type: string): string {
    const raw = decodeURIComponent(target.pathname.split("/").pop() ?? "");
    let name = raw.replace(/[^\w.-]+/g, "_").replace(/^[_.]+/, "").slice(0, 60);
    if (!name) name = "file";
    if (!/\.[a-z0-9]{2,5}$/i.test(name)) name += EXTENSIONS[type] ?? ".bin";
    return name;
}

export interface FetchedFile {
    buffer: Buffer;
    name: string;
}

// Follows redirects by hand so every hop is checked, not just the first.
export async function fetchAttachment(url: string, max_bytes: number): Promise<FetchedFile | null> {
    const cap = Math.min(max_bytes, MAX_BYTES);
    let target: URL;
    try {
        target = new URL(url);
    } catch {
        return null;
    }

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        if (!await reachable(target)) return null;

        let res: Response;
        try {
            res = await fetch(target, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT) });
        } catch {
            return null;
        }

        if (res.status >= 300 && res.status < 400) {
            const next = res.headers.get("location");
            if (!next) return null;
            try {
                target = new URL(next, target);
            } catch {
                return null;
            }
            continue;
        }

        if (!res.ok || !res.body) return null;
        // The header is a hint rather than a promise, so the real size is
        // checked while the body arrives as well.
        if (Number(res.headers.get("content-length")) > cap) return null;

        const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        const chunks: Buffer[] = [];
        let size = 0;
        try {
            for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
                size += chunk.length;
                if (size > cap) return null;
                chunks.push(Buffer.from(chunk));
            }
        } catch {
            return null;
        }

        if (!size) return null;
        return { buffer: Buffer.concat(chunks), name: fileName(target, type) };
    }

    return null;
}
