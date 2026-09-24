import { createApplicationTable } from "../schema/applicationDB.js";
import { ApplicationConfigRow, QuestionRole, QuestionRow, QuestionType, QuestionVisibility } from "../types/Application.js";
import { ChoiceOption } from "./applicationData.js";
import { MAX_MODAL_COMPONENTS, MAX_UPLOADS, loadQuestions, questionOptions } from "./applicationQuestions.js";


const db = createApplicationTable();

// Thrown for anything the person editing did wrong, as opposed to a bug. The
// API turns these into a 400 with the message shown in the dashboard.
export class ApplicationEditError extends Error {}

const TYPES: QuestionType[] = ["text", "select", "radio", "checkbox", "file"];
const VISIBILITIES: QuestionVisibility[] = ["always", "gvg", "gve"];
const ROLES: QuestionRole[] = ["ign", "content", "activity"];

const MAX_LABEL = 45;
const MAX_DESCRIPTION = 100;
const MAX_PLACEHOLDER = 100;

// How many options each component will take, straight from Discord's limits.
const OPTION_LIMITS: Record<QuestionType, { min: number; max: number }> = {
    text: { min: 0, max: 0 },
    select: { min: 1, max: 25 },
    radio: { min: 2, max: 10 },
    checkbox: { min: 1, max: 10 },
    file: { min: 0, max: 0 }
};


function str(body: Record<string, unknown>, key: string, max: number, fallback = ""): string {
    const value = body[key];
    if (value === undefined || value === null) return fallback;
    if (typeof value !== "string") throw new ApplicationEditError(`${key} must be text.`);

    const trimmed = value.trim();
    if (trimmed.length > max) throw new ApplicationEditError(`${key} has to be ${max} characters or fewer.`);
    return trimmed;
}

function int(body: Record<string, unknown>, key: string, fallback: number | null): number | null {
    const value = body[key];
    if (value === undefined || value === null || value === "") return fallback;

    const n = Number(value);
    if (!Number.isFinite(n)) throw new ApplicationEditError(`${key} must be a number.`);
    return Math.trunc(n);
}

function bool(body: Record<string, unknown>, key: string, fallback: boolean): boolean {
    const value = body[key];
    if (value === undefined || value === null) return fallback;
    return value === true || value === 1 || value === "1" || value === "true";
}

function readOptions(body: Record<string, unknown>, type: QuestionType): ChoiceOption[] {
    const raw = body.options;
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) throw new ApplicationEditError("Options must be a list.");

    const seen = new Set<string>();

    return raw.map((entry, i) => {
        if (!entry || typeof entry !== "object") throw new ApplicationEditError(`Option ${i + 1} is not filled in.`);
        const row = entry as Record<string, unknown>;

        const label = str(row, "label", 100);
        if (!label) throw new ApplicationEditError(`Option ${i + 1} needs a label.`);

        // The value is what gets stored on an application, so it has to stay
        // put even if the label is reworded later.
        const value = (str(row, "value", 100) || label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")).slice(0, 100);
        if (!value) throw new ApplicationEditError(`Option ${i + 1} needs a value.`);
        if (seen.has(value)) throw new ApplicationEditError(`Two options share the value "${value}".`);
        seen.add(value);

        const description = str(row, "description", 100);

        // Only select and radio show a description; a checkbox group does too,
        // but text and file have no options at all.
        return description && type !== "checkbox" ? { label, value, description } : { label, value };
    });
}

function validate(question: Omit<QuestionRow, "id" | "guild_id">, options: ChoiceOption[]): void {
    if (!TYPES.includes(question.type)) throw new ApplicationEditError("Pick a question type.");
    if (!VISIBILITIES.includes(question.shown_when)) throw new ApplicationEditError("Pick who sees the question.");
    if (question.role !== null && !ROLES.includes(question.role)) throw new ApplicationEditError("Unknown question role.");
    if (!question.label) throw new ApplicationEditError("The question needs a label.");
    if (!/^[a-z0-9_]{2,60}$/.test(question.field_id)) throw new ApplicationEditError("The field id can only use lowercase letters, numbers and underscores.");

    const limits = OPTION_LIMITS[question.type];

    if (limits.max === 0 && options.length > 0) {
        throw new ApplicationEditError(`A ${question.type} question does not take options.`);
    }

    if (limits.max > 0) {
        if (options.length < limits.min) throw new ApplicationEditError(`A ${question.type} question needs at least ${limits.min} option${limits.min === 1 ? "" : "s"}.`);
        if (options.length > limits.max) throw new ApplicationEditError(`A ${question.type} question takes at most ${limits.max} options.`);
    }

    if (question.type === "text") {
        const min = question.min_length ?? 0;
        const max = question.max_length ?? 4000;
        if (min < 0 || max > 4000) throw new ApplicationEditError("Text length has to sit between 0 and 4000.");
        if (min > max) throw new ApplicationEditError("The shortest answer cannot be longer than the longest.");
    }

    if (question.type === "file") {
        const max = question.max_values ?? MAX_UPLOADS;
        if (max < 1 || max > MAX_UPLOADS) throw new ApplicationEditError(`Uploads have to allow between 1 and ${MAX_UPLOADS} files.`);
    }

    if (question.type === "select" || question.type === "checkbox") {
        const min = question.min_values ?? 1;
        const max = question.max_values ?? options.length;
        if (min < 0) throw new ApplicationEditError("The fewest picks cannot be negative.");
        if (max > options.length) throw new ApplicationEditError("The most picks cannot be more than the number of options.");
        if (min > max) throw new ApplicationEditError("The fewest picks cannot be more than the most.");
    }

    // The first modal is asked before anyone has said what they are applying
    // for, so nothing in it can depend on that answer.
    if (question.stage === 0 && question.shown_when !== "always") {
        throw new ApplicationEditError("A question in the first part is asked before we know what they are applying for, so it has to be shown to everyone.");
    }

    if (question.role === "content" && question.type !== "checkbox" && question.type !== "select" && question.type !== "radio") {
        throw new ApplicationEditError("The question that decides GvG or GvE has to be a choice question.");
    }
}


function fromBody(guild_id: string, body: Record<string, unknown>, existing?: QuestionRow): Omit<QuestionRow, "id" | "guild_id"> & { options_json: string | null } {
    const type = (body.type ?? existing?.type) as QuestionType;
    const options = body.options === undefined && existing ? questionOptions(existing) : readOptions(body, type);

    const question = {
        stage: int(body, "stage", existing?.stage ?? 1) === 0 ? 0 : 1,
        position: int(body, "position", existing?.position ?? 0) ?? 0,
        field_id: str(body, "field_id", 60, existing?.field_id ?? "").toLowerCase(),
        type,
        label: str(body, "label", MAX_LABEL, existing?.label ?? ""),
        description: str(body, "description", MAX_DESCRIPTION, existing?.description ?? "") || null,
        placeholder: str(body, "placeholder", MAX_PLACEHOLDER, existing?.placeholder ?? "") || null,
        required: bool(body, "required", existing ? existing.required === 1 : true) ? 1 : 0,
        paragraph: bool(body, "paragraph", existing ? existing.paragraph === 1 : false) ? 1 : 0,
        min_values: int(body, "min_values", existing?.min_values ?? null),
        max_values: int(body, "max_values", existing?.max_values ?? null),
        min_length: int(body, "min_length", existing?.min_length ?? null),
        max_length: int(body, "max_length", existing?.max_length ?? null),
        options: null as string | null,
        shown_when: (body.shown_when ?? existing?.shown_when ?? "always") as QuestionVisibility,
        role: ((body.role === "" ? null : body.role) ?? existing?.role ?? null) as QuestionRole | null,
        enabled: bool(body, "enabled", existing ? existing.enabled === 1 : true) ? 1 : 0
    };

    validate(question, options);

    // A role means something to the bot, so only one question can hold each.
    if (question.role) {
        const clash = db.get<QuestionRow>(
            `SELECT * FROM application_questions WHERE guild_id = ? AND role = ? AND id != ?`,
            guild_id, question.role, existing?.id ?? -1
        );
        if (clash) throw new ApplicationEditError(`"${clash.label}" is already the ${question.role} question.`);
    }

    return { ...question, options_json: options.length > 0 ? JSON.stringify(options) : null };
}


export function listQuestions(guild_id: string): QuestionRow[] {
    loadQuestions(guild_id);
    return db.all<QuestionRow[]>(`SELECT * FROM application_questions WHERE guild_id = ? ORDER BY stage, position, id`, guild_id);
}

export function createQuestion(guild_id: string, body: Record<string, unknown>): QuestionRow {
    listQuestions(guild_id);
    const q = fromBody(guild_id, body);

    if (db.get(`SELECT 1 FROM application_questions WHERE guild_id = ? AND field_id = ?`, guild_id, q.field_id)) {
        throw new ApplicationEditError(`A question with the id "${q.field_id}" already exists.`);
    }

    if (q.stage === 0 && countStage(guild_id, 0) >= MAX_MODAL_COMPONENTS) {
        throw new ApplicationEditError(`The first part already has ${MAX_MODAL_COMPONENTS} questions, which is all Discord allows in one form.`);
    }

    const next = db.get<{ n: number }>(`SELECT COALESCE(MAX(position), -1) + 1 AS n FROM application_questions WHERE guild_id = ? AND stage = ?`, guild_id, q.stage);

    const result = db.run(
        `INSERT INTO application_questions (guild_id, stage, position, field_id, type, label, description, placeholder, required, paragraph, min_values, max_values, min_length, max_length, options, shown_when, role, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        guild_id, q.stage, next?.n ?? 0, q.field_id, q.type, q.label, q.description, q.placeholder,
        q.required, q.paragraph, q.min_values, q.max_values, q.min_length, q.max_length,
        q.options_json, q.shown_when, q.role, q.enabled
    );

    return db.get<QuestionRow>(`SELECT * FROM application_questions WHERE id = ?`, result.lastID)!;
}

export function updateQuestion(guild_id: string, id: number, body: Record<string, unknown>): QuestionRow {
    const existing = db.get<QuestionRow>(`SELECT * FROM application_questions WHERE id = ? AND guild_id = ?`, id, guild_id);
    if (!existing) throw new ApplicationEditError("That question is gone.");

    const q = fromBody(guild_id, body, existing);

    if (q.field_id !== existing.field_id && db.get(`SELECT 1 FROM application_questions WHERE guild_id = ? AND field_id = ?`, guild_id, q.field_id)) {
        throw new ApplicationEditError(`A question with the id "${q.field_id}" already exists.`);
    }

    if (q.stage === 0 && existing.stage !== 0 && countStage(guild_id, 0) >= MAX_MODAL_COMPONENTS) {
        throw new ApplicationEditError(`The first part already has ${MAX_MODAL_COMPONENTS} questions.`);
    }

    db.run(
        `UPDATE application_questions SET stage = ?, field_id = ?, type = ?, label = ?, description = ?, placeholder = ?, required = ?, paragraph = ?, min_values = ?, max_values = ?, min_length = ?, max_length = ?, options = ?, shown_when = ?, role = ?, enabled = ? WHERE id = ? AND guild_id = ?`,
        q.stage, q.field_id, q.type, q.label, q.description, q.placeholder, q.required, q.paragraph,
        q.min_values, q.max_values, q.min_length, q.max_length, q.options_json, q.shown_when, q.role,
        q.enabled, id, guild_id
    );

    return db.get<QuestionRow>(`SELECT * FROM application_questions WHERE id = ?`, id)!;
}

export function deleteQuestion(guild_id: string, id: number): void {
    const existing = db.get<QuestionRow>(`SELECT * FROM application_questions WHERE id = ? AND guild_id = ?`, id, guild_id);
    if (!existing) return;

    // Losing the question that decides GvG or GvE would leave the conditional
    // questions with nothing to check against.
    if (existing.role === "content") {
        const dependants = db.get<{ n: number }>(
            `SELECT COUNT(*) AS n FROM application_questions WHERE guild_id = ? AND shown_when != 'always' AND id != ?`,
            guild_id, id
        );

        if ((dependants?.n ?? 0) > 0) {
            throw new ApplicationEditError(`${dependants!.n} question(s) only show for GvG or GvE applicants, and this is the question that decides which they are. Change those to "everyone" first.`);
        }
    }

    db.run(`DELETE FROM application_questions WHERE id = ? AND guild_id = ?`, id, guild_id);
}

export function reorderQuestions(guild_id: string, order: { id: number; stage: number }[]): QuestionRow[] {
    const rows = listQuestions(guild_id);
    const known = new Map(rows.map(row => [row.id, row]));

    const first = order.filter(entry => entry.stage === 0);
    if (first.length > MAX_MODAL_COMPONENTS) {
        throw new ApplicationEditError(`The first part takes at most ${MAX_MODAL_COMPONENTS} questions.`);
    }

    for (const entry of first) {
        const row = known.get(entry.id);
        if (row && row.shown_when !== "always") {
            throw new ApplicationEditError(`"${row.label}" only shows for some applicants, so it cannot go in the first part.`);
        }
    }

    db.transaction(() => {
        const counters = new Map<number, number>();

        for (const entry of order) {
            if (!known.has(entry.id)) continue;

            const stage = entry.stage === 0 ? 0 : 1;
            const position = counters.get(stage) ?? 0;
            counters.set(stage, position + 1);

            db.run(`UPDATE application_questions SET stage = ?, position = ? WHERE id = ? AND guild_id = ?`, stage, position, entry.id, guild_id);
        }
    });

    return listQuestions(guild_id);
}

function countStage(guild_id: string, stage: number): number {
    return db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM application_questions WHERE guild_id = ? AND stage = ?`, guild_id, stage)?.n ?? 0;
}


export function getApplicationSettings(guild_id: string): ApplicationConfigRow | undefined {
    return db.get<ApplicationConfigRow>(`SELECT * FROM application_config WHERE guild_id = ?`, guild_id);
}

export function saveApplicationSettings(guild_id: string, body: Record<string, unknown>): ApplicationConfigRow {
    const existing = getApplicationSettings(guild_id);

    const panel_channel_id = str(body, "panel_channel_id", 30, existing?.panel_channel_id ?? "");
    const review_channel_id = str(body, "review_channel_id", 30, existing?.review_channel_id ?? "");

    if (!panel_channel_id) throw new ApplicationEditError("Pick the channel the form button sits in.");
    if (!review_channel_id) throw new ApplicationEditError("Pick the channel applications are posted to.");

    const reviewer_role_id = str(body, "reviewer_role_id", 30, existing?.reviewer_role_id ?? "") || null;
    const accepted_role_id = str(body, "accepted_role_id", 30, existing?.accepted_role_id ?? "") || null;
    const panel_title = str(body, "panel_title", 200, existing?.panel_title ?? "") || null;
    const panel_body = str(body, "panel_body", 2000, existing?.panel_body ?? "") || null;
    const panel_button = str(body, "panel_button", 80, existing?.panel_button ?? "") || null;
    const panel_note = str(body, "panel_note", 1000, existing?.panel_note ?? "") || null;

    // Moving the panel to another channel leaves the old message behind, so the
    // stored id is dropped and a new panel goes up on the next sync.
    const moved = existing && existing.panel_channel_id !== panel_channel_id;

    db.run(
        `INSERT INTO application_config (guild_id, panel_channel_id, panel_msg_id, review_channel_id, reviewer_role_id, accepted_role_id, panel_title, panel_body, panel_button, panel_note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET
            panel_channel_id = excluded.panel_channel_id,
            panel_msg_id = excluded.panel_msg_id,
            review_channel_id = excluded.review_channel_id,
            reviewer_role_id = excluded.reviewer_role_id,
            accepted_role_id = excluded.accepted_role_id,
            panel_title = excluded.panel_title,
            panel_body = excluded.panel_body,
            panel_button = excluded.panel_button,
            panel_note = excluded.panel_note`,
        guild_id, panel_channel_id, moved ? null : existing?.panel_msg_id ?? null, review_channel_id,
        reviewer_role_id, accepted_role_id, panel_title, panel_body, panel_button, panel_note
    );

    return getApplicationSettings(guild_id)!;
}

export function rememberPanelMessage(guild_id: string, message_id: string | null): void {
    db.run(`UPDATE application_config SET panel_msg_id = ? WHERE guild_id = ?`, message_id, guild_id);
}
