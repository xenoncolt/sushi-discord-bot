import { Client } from "discord.js";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { handleApi } from "./api.js";
import { finishLogin, startLogin } from "./auth.js";
import { HttpError, json } from "./http.js";

// The dashboard runs inside the bot process: one Node process instead of two,
// and the API reads settings, channels, roles and nicknames straight from the
// bot's memory rather than asking Discord for them again.

const __dirname = dirname(fileURLToPath(import.meta.url));

const MIME: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".webp": "image/webp",
    ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8",
    ".webmanifest": "application/manifest+json"
};

function webRoot(): string | null {
    const candidates = [
        process.env.DASHBOARD_WEB_DIR ? resolve(process.env.DASHBOARD_WEB_DIR) : "",
        resolve(process.cwd(), "web/build"),
        resolve(__dirname, "../web/build"),
        resolve(__dirname, "../../web/build")
    ].filter(Boolean);
    return candidates.find(dir => existsSync(join(dir, "index.html"))) ?? null;
}

function sendFile(req: IncomingMessage, res: ServerResponse, file: string, immutable: boolean): void {
    const type = MIME[extname(file)] ?? "application/octet-stream";
    const accept = String(req.headers["accept-encoding"] ?? "");

    // SvelteKit's precompress step leaves .br and .gz copies next to each
    // file, so compression costs nothing at request time.
    let path = file;
    let encoding: string | null = null;
    if (accept.includes("br") && existsSync(`${file}.br`)) {
        path = `${file}.br`;
        encoding = "br";
    } else if (accept.includes("gzip") && existsSync(`${file}.gz`)) {
        path = `${file}.gz`;
        encoding = "gzip";
    }

    const headers: Record<string, string | number> = {
        "Content-Type": type,
        "Content-Length": statSync(path).size,
        "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "same-origin",
        Vary: "Accept-Encoding"
    };
    if (encoding) headers["Content-Encoding"] = encoding;
    if (type.startsWith("text/html")) headers["X-Frame-Options"] = "DENY";

    res.writeHead(200, headers);
    if (req.method === "HEAD") {
        res.end();
        return;
    }
    createReadStream(path).pipe(res);
}

function serveStatic(req: IncomingMessage, res: ServerResponse, root: string, pathname: string): void {
    let decoded: string;
    try {
        decoded = decodeURIComponent(pathname);
    } catch {
        decoded = "/";
    }
    const file = normalize(join(root, decoded));

    // Never serve anything outside the build folder.
    if (file.startsWith(root + sep) && existsSync(file) && statSync(file).isFile()) {
        sendFile(req, res, file, decoded.startsWith("/_app/immutable/"));
        return;
    }

    // Unknown asset: a real 404. Anything else is a page route, which the
    // single-page app resolves itself.
    if (extname(decoded)) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
    }
    sendFile(req, res, join(root, "index.html"), false);
}

export function startDashboard(client: Client): void {
    if (process.env.DASHBOARD_ENABLED === "false") return;

    const port = Number(process.env.DASHBOARD_PORT ?? 3000);
    const host = process.env.DASHBOARD_HOST ?? "0.0.0.0";
    const root = webRoot();
    if (!root) {
        console.warn("Dashboard: web/build not found, serving the API only. Run `npm run build:web` to build the website.");
    }

    const server = createServer(async (req, res) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        try {
            if (url.pathname === "/api/auth/login") {
                startLogin(client, res, url.searchParams.get("next"));
                return;
            }
            if (url.pathname === "/api/auth/callback") {
                // A browser lands here, so failures go back to the site as a
                // readable message rather than a raw JSON error.
                await finishLogin(client, req, res, url.searchParams).catch(err => {
                    if (!(err instanceof HttpError)) console.error("Dashboard login failed:", err);
                    const message = err instanceof HttpError ? err.message : "Login failed.";
                    res.writeHead(302, { Location: `/?error=${encodeURIComponent(message)}` });
                    res.end();
                });
                return;
            }
            if (url.pathname.startsWith("/api/")) {
                await handleApi(client, req, res, url);
                return;
            }
            if (req.method !== "GET" && req.method !== "HEAD") {
                res.writeHead(405);
                res.end();
                return;
            }
            if (!root) {
                res.writeHead(503, { "Content-Type": "text/plain" });
                res.end("The dashboard website hasn't been built yet.");
                return;
            }
            serveStatic(req, res, root, url.pathname);
        } catch (err) {
            if (res.headersSent) {
                res.end();
                return;
            }
            if (err instanceof HttpError) {
                json(res, err.status, { error: err.message });
            } else {
                console.error("Dashboard request failed:", err);
                json(res, 500, { error: "Internal error." });
            }
        }
    });

    server.on("error", err => console.error("Dashboard server error:", err));
    server.listen(port, host, () => {
        console.log(`Dashboard listening on http://${host}:${port}${process.env.DASHBOARD_URL ? ` (public URL ${process.env.DASHBOARD_URL})` : ""}`);
    });
}
