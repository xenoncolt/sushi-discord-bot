import { IncomingMessage, ServerResponse } from "node:http";

export class HttpError extends Error {
    constructor(public status: number, message: string) {
        super(message);
    }
}

export function parseCookies(req: IncomingMessage): Record<string, string> {
    const out: Record<string, string> = {};
    for (const part of (req.headers.cookie ?? "").split(";")) {
        const at = part.indexOf("=");
        if (at < 0) continue;
        const key = part.slice(0, at).trim();
        if (key) {
            try {
                out[key] = decodeURIComponent(part.slice(at + 1).trim());
            } catch {
                // A mangled cookie is just ignored.
            }
        }
    }
    return out;
}

export function cookie(name: string, value: string, opts: { maxAge?: number; secure: boolean; path?: string }): string {
    return [
        `${name}=${encodeURIComponent(value)}`,
        `Path=${opts.path ?? "/"}`,
        "HttpOnly",
        "SameSite=Lax",
        opts.secure ? "Secure" : "",
        opts.maxAge !== undefined ? `Max-Age=${opts.maxAge}` : ""
    ].filter(Boolean).join("; ");
}

export function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}): void {
    const data = JSON.stringify(body);
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Length": Buffer.byteLength(data),
        ...headers
    });
    res.end(data);
}

export function redirect(res: ServerResponse, location: string, headers: Record<string, string | string[]> = {}): void {
    res.writeHead(302, { Location: location, "Cache-Control": "no-store", ...headers });
    res.end();
}

const MAX_BODY = 256 * 1024;

export async function readJson(req: IncomingMessage): Promise<unknown> {
    const type = req.headers["content-type"] ?? "";
    // Requiring JSON also forces a CORS preflight on any cross-site attempt,
    // which is half of the CSRF protection (the Origin check is the other).
    if (!type.includes("application/json")) throw new HttpError(415, "Expected a JSON body.");

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) throw new HttpError(413, "Request body is too large.");
        chunks.push(chunk as Buffer);
    }
    if (!size) return {};
    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
        throw new HttpError(400, "Body is not valid JSON.");
    }
}
