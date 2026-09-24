import { createLevelingTable } from "../schema/levelingDB.js";
import { emptyDoc, MsgButton, MsgNode, MsgRow, MsgSelect, sanitizeDoc, sanitizeName, SavedMessage } from "./schema.js";

const db = createLevelingTable();

// How many drafts one server may keep. High enough that nobody sensible ever
// meets it, low enough that a runaway script can't fill the disk.
const PER_GUILD_MAX = 100;

interface Row {
    id: number;
    guild_id: string;
    name: string;
    data: string;
    channel_id: string | null;
    message_id: string | null;
    created_at: number;
    updated_at: number;
}

function hydrate(row: Row): SavedMessage {
    let parsed: unknown;
    try {
        parsed = JSON.parse(row.data);
    } catch (err) {
        console.error(`Custom message ${row.id} is unreadable, falling back to an empty one:`, err);
        parsed = undefined;
    }
    // Run through the sanitiser on the way out as well as in: a document saved
    // before a field existed gets it filled in here rather than crashing the
    // build step much later.
    return {
        id: row.id,
        guild_id: row.guild_id,
        name: row.name,
        doc: parsed === undefined ? emptyDoc() : sanitizeDoc(parsed),
        channel_id: row.channel_id,
        message_id: row.message_id,
        created_at: row.created_at,
        updated_at: row.updated_at
    };
}

export function listMessages(guild_id: string): SavedMessage[] {
    return db
        .all<Row[]>(`SELECT * FROM custom_messages WHERE guild_id = ? ORDER BY id DESC`, guild_id)
        .map(hydrate);
}

export function getMessage(guild_id: string, id: number): SavedMessage | null {
    const row = db.get<Row>(`SELECT * FROM custom_messages WHERE guild_id = ? AND id = ?`, guild_id, id);
    return row ? hydrate(row) : null;
}

export function countMessages(guild_id: string): number {
    return db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM custom_messages WHERE guild_id = ?`, guild_id)?.n ?? 0;
}

export function createMessage(guild_id: string, name: unknown, doc: unknown): SavedMessage {
    if (countMessages(guild_id) >= PER_GUILD_MAX) {
        throw new Error(`This server already has ${PER_GUILD_MAX} saved messages. Delete one before making another.`);
    }
    const now = Date.now();
    const clean = sanitizeDoc(doc);
    const result = db.run(
        `INSERT INTO custom_messages (guild_id, name, data, channel_id, message_id, created_at, updated_at)
         VALUES (?, ?, ?, NULL, NULL, ?, ?)`,
        guild_id,
        sanitizeName(name),
        JSON.stringify(clean),
        now,
        now
    );
    return getMessage(guild_id, result.lastID)!;
}

export function updateMessage(guild_id: string, id: number, patch: { name?: unknown; doc?: unknown }): SavedMessage | null {
    const current = getMessage(guild_id, id);
    if (!current) return null;

    const name = patch.name === undefined ? current.name : sanitizeName(patch.name, current.name);
    const doc = patch.doc === undefined ? current.doc : sanitizeDoc(patch.doc);

    db.run(
        `UPDATE custom_messages SET name = ?, data = ?, updated_at = ? WHERE guild_id = ? AND id = ?`,
        name,
        JSON.stringify(doc),
        Date.now(),
        guild_id,
        id
    );
    return getMessage(guild_id, id);
}

export function deleteMessage(guild_id: string, id: number): boolean {
    return db.run(`DELETE FROM custom_messages WHERE guild_id = ? AND id = ?`, guild_id, id).changes > 0;
}

// Remembered after a successful Send so the same draft can be edited in place
// afterwards. Cleared (both null) when the posted message has gone.
export function rememberPost(guild_id: string, id: number, channel_id: string | null, message_id: string | null): void {
    db.run(
        `UPDATE custom_messages SET channel_id = ?, message_id = ?, updated_at = ? WHERE guild_id = ? AND id = ?`,
        channel_id,
        message_id,
        Date.now(),
        guild_id,
        id
    );
}


// ---- looking up a live component ------------------------------------------
// Every component the bot answers carries its saved message's row id in its
// custom id, because what it actually does — a list of roles, a reply, what
// the button turns into afterwards — is far too much to fit in the hundred
// characters Discord allows. Looking it up also means an edit on the dashboard
// reaches components that were posted days ago.

function walk(nodes: MsgNode[], visit: (node: MsgNode) => void): void {
    for (const node of nodes) {
        visit(node);
        if (node.type === "container") walk(node.children, visit);
    }
}

// Every action row in a document, wherever it sits.
function rowsIn(saved: SavedMessage): MsgRow[] {
    const out: MsgRow[] = [...saved.doc.rows];
    walk(saved.doc.nodes, node => {
        if (node.type === "row") out.push(node.row);
    });
    return out;
}

export function findSelect(guild_id: string, message_row_id: number, select_id: string): MsgSelect | null {
    const saved = getMessage(guild_id, message_row_id);
    if (!saved) return null;
    return rowsIn(saved).map(r => r.select).find(s => s.id === select_id) ?? null;
}

export function findButton(guild_id: string, message_row_id: number, button_id: string): MsgButton | null {
    const saved = getMessage(guild_id, message_row_id);
    if (!saved) return null;

    for (const row of rowsIn(saved)) {
        const hit = row.buttons.find(b => b.id === button_id);
        if (hit) return hit;
    }
    // A button can also be the thing sitting down the right of a section.
    let accessory: MsgButton | null = null;
    walk(saved.doc.nodes, node => {
        if (node.type === "section" && node.accessory === "button" && node.button.id === button_id) accessory = node.button;
    });
    return accessory;
}
