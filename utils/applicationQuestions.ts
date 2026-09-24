import { CheckboxGroupBuilder, FileUploadBuilder, LabelBuilder, ModalSubmitInteraction, RadioGroupBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { createApplicationTable } from "../schema/applicationDB.js";
import { AnswerEntry, ApplicationShot, QuestionRow, QuestionType, QuestionVisibility } from "../types/Application.js";
import { ACTIVITY_ANSWERS, ChoiceOption, CONTENT_TYPES, PATH_BUILDS, PLAYER_TYPES, WEAPONS } from "./applicationData.js";


const db = createApplicationTable();

// Discord's own ceilings. A label is 45 characters, its description 100, a
// radio group takes 2 to 10 options and everything else tops out at 25.
export const MAX_MODAL_COMPONENTS = 5;
export const MAX_UPLOADS = 10;
const MAX_LABEL = 45;
const MAX_DESCRIPTION = 100;


type SeedQuestion = Omit<QuestionRow, "id" | "guild_id"> & { options_data?: ChoiceOption[] };

function seed(q: Partial<SeedQuestion> & Pick<SeedQuestion, "field_id" | "type" | "label">): SeedQuestion {
    return {
        stage: 1,
        position: 0,
        description: null,
        placeholder: null,
        required: 1,
        paragraph: 0,
        min_values: null,
        max_values: null,
        min_length: null,
        max_length: null,
        options: null,
        shown_when: "always",
        role: null,
        enabled: 1,
        ...q
    };
}

// The form as it was written in code, now as the starting rows for a guild
// that has never edited anything. Changing these only affects new servers.
const DEFAULT_QUESTIONS: SeedQuestion[] = [
    seed({
        stage: 0, position: 0, field_id: "app_player_type", type: "radio",
        label: "What kind of player are you?",
        description: "Pick the one that honestly matches how you play day to day.",
        options_data: PLAYER_TYPES
    }),
    seed({
        stage: 0, position: 1, field_id: "app_content", type: "checkbox",
        label: "What are you applying for?",
        description: "Tick one or both. Ticking both means you answer the GvG and the GvE questions.",
        min_values: 1, max_values: 2, role: "content",
        options_data: CONTENT_TYPES
    }),
    seed({
        stage: 0, position: 2, field_id: "app_ign", type: "text",
        label: "Your in-game name",
        description: "Type it exactly as it appears in game so we can find you on the roster.",
        placeholder: "e.g. LittleVillain",
        min_length: 2, max_length: 50, role: "ign"
    }),
    seed({
        stage: 0, position: 3, field_id: "app_previous_guild", type: "text",
        label: "Which guilds were you in before?",
        description: "Name them and say why you left. Write None if this is your first guild.",
        placeholder: "e.g. Redmoon for 6 months, left when the guild went inactive",
        paragraph: 1, max_length: 500
    }),
    seed({
        stage: 0, position: 4, field_id: "app_activity", type: "radio",
        label: "Can you hit 3k activity weekly?",
        description: "Be honest. Falling short after you join means an immediate kick and ban.",
        role: "activity",
        options_data: ACTIVITY_ANSWERS
    }),

    seed({
        stage: 1, position: 0, field_id: "app_about", type: "text",
        label: "Tell us about yourself",
        description: "Your timezone, when you usually play, and what you want out of this guild.",
        placeholder: "Who are you, how long have you played, and why do you want to join?",
        paragraph: 1, min_length: 40, max_length: 1000
    }),
    seed({
        stage: 1, position: 1, field_id: "app_path", type: "select",
        label: "Which path builds do you run?",
        description: "Pick every build you actually play in PvE, however many that is.",
        placeholder: "Select your path builds",
        shown_when: "gve", min_values: 1, max_values: PATH_BUILDS.length,
        options_data: PATH_BUILDS
    }),
    seed({
        stage: 1, position: 2, field_id: "app_pve_rank", type: "text",
        label: "PvE speedrun leaderboard ranks",
        description: "Name any boards you are ranked on and your place on them. Write None if you are not ranked.",
        placeholder: "e.g. Ashen Keep - rank 12 global, Jade Hollow - rank 4 server",
        shown_when: "gve", paragraph: 1, max_length: 600
    }),
    seed({
        stage: 1, position: 3, field_id: "app_weapons", type: "select",
        label: "Which weapons do you run?",
        description: "Pick every weapon you run in GvG, however many that is.",
        placeholder: "Select your weapons",
        shown_when: "gvg", min_values: 1, max_values: WEAPONS.length,
        options_data: WEAPONS
    }),
    seed({
        stage: 1, position: 4, field_id: "app_arena_img", type: "file",
        label: "Arena rank - history screenshot",
        description: "Show your historical arena performance, including the peak rank you reached.",
        shown_when: "gvg", min_values: 1, max_values: MAX_UPLOADS
    }),
    seed({
        stage: 1, position: 5, field_id: "app_gvg_img", type: "file",
        label: "Your GvG stats screenshot",
        description: "Optional. Your guild war damage, kills and how often you take part.",
        shown_when: "gvg", required: 0, min_values: 0, max_values: MAX_UPLOADS
    }),
    seed({
        stage: 1, position: 6, field_id: "app_inner_img", type: "file",
        label: "Current innerways screenshot",
        description: "Show all of your innerways. Attach as many images as it takes to cover them.",
        min_values: 1, max_values: MAX_UPLOADS
    }),
    seed({
        stage: 1, position: 7, field_id: "app_stats_img", type: "file",
        label: "Current stats screenshot",
        description: "Your character stats page exactly as it looks right now.",
        min_values: 1, max_values: MAX_UPLOADS
    })
];


export function questionOptions(question: QuestionRow): ChoiceOption[] {
    if (!question.options) return [];

    try {
        const parsed = JSON.parse(question.options);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        console.error(`Question ${question.field_id} has unreadable options`);
        return [];
    }
}

// Seeds the built in form the first time a guild is asked for its questions,
// then leaves it alone. Editing or deleting a question never brings it back.
export function loadQuestions(guild_id: string): QuestionRow[] {
    const existing = db.all<QuestionRow[]>(
        `SELECT * FROM application_questions WHERE guild_id = ? ORDER BY stage, position, id`,
        guild_id
    );

    if (existing.length > 0) return existing.filter(question => question.enabled === 1);

    db.transaction(() => {
        for (const question of DEFAULT_QUESTIONS) {
            const { options_data, ...row } = question;

            db.run(
                `INSERT INTO application_questions (guild_id, stage, position, field_id, type, label, description, placeholder, required, paragraph, min_values, max_values, min_length, max_length, options, shown_when, role, enabled)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                guild_id, row.stage, row.position, row.field_id, row.type, row.label, row.description,
                row.placeholder, row.required, row.paragraph, row.min_values, row.max_values,
                row.min_length, row.max_length, options_data ? JSON.stringify(options_data) : null,
                row.shown_when, row.role, row.enabled
            );
        }
    });

    return db.all<QuestionRow[]>(
        `SELECT * FROM application_questions WHERE guild_id = ? AND enabled = 1 ORDER BY stage, position, id`,
        guild_id
    );
}

export function contentField(questions: QuestionRow[]): QuestionRow | undefined {
    return questions.find(question => question.role === "content");
}

export function visibleFor(questions: QuestionRow[], stage: number, picked: string[]): QuestionRow[] {
    return questions.filter(question =>
        question.stage === stage && (question.shown_when === "always" || picked.includes(question.shown_when))
    );
}


function clamp(text: string | null, limit: number): string | undefined {
    if (!text) return undefined;
    return text.length > limit ? text.slice(0, limit) : text;
}

function toOptions(question: QuestionRow, cap: number) {
    return questionOptions(question).slice(0, cap).map(option => ({
        label: option.label.slice(0, 100),
        value: option.value.slice(0, 100),
        ...(option.description ? { description: option.description.slice(0, 100) } : {})
    }));
}

// Turns a stored question into the component Discord will render. A question
// the guild has mangled (a radio with one option, say) would be rejected by
// the builders, so those fall back to something Discord will accept.
export function buildQuestionLabel(question: QuestionRow): LabelBuilder {
    const label = new LabelBuilder().setLabel(clamp(question.label, MAX_LABEL) ?? question.field_id);
    const description = clamp(question.description, MAX_DESCRIPTION);
    if (description) label.setDescription(description);

    const required = question.required === 1;

    switch (question.type) {
        case "text": {
            const input = new TextInputBuilder()
                .setCustomId(question.field_id)
                .setStyle(question.paragraph === 1 ? TextInputStyle.Paragraph : TextInputStyle.Short)
                .setRequired(required);

            if (question.placeholder) input.setPlaceholder(question.placeholder.slice(0, 100));
            if (question.min_length) input.setMinLength(question.min_length);
            if (question.max_length) input.setMaxLength(question.max_length);

            return label.setTextInputComponent(input);
        }

        case "select": {
            const options = toOptions(question, 25);
            const menu = new StringSelectMenuBuilder()
                .setCustomId(question.field_id)
                .setRequired(required)
                .setMinValues(Math.min(question.min_values ?? 1, options.length))
                .setMaxValues(Math.min(question.max_values ?? 1, options.length) || 1)
                .addOptions(options);

            if (question.placeholder) menu.setPlaceholder(question.placeholder.slice(0, 150));

            return label.setStringSelectMenuComponent(menu);
        }

        case "radio": {
            return label.setRadioGroupComponent(
                new RadioGroupBuilder()
                    .setCustomId(question.field_id)
                    .setRequired(required)
                    .addOptions(toOptions(question, 10))
            );
        }

        case "checkbox": {
            const options = toOptions(question, 10);

            return label.setCheckboxGroupComponent(
                new CheckboxGroupBuilder()
                    .setCustomId(question.field_id)
                    .setRequired(required)
                    .setMinValues(Math.min(question.min_values ?? 1, options.length))
                    .setMaxValues(Math.min(question.max_values ?? options.length, options.length) || 1)
                    .addOptions(options)
            );
        }

        case "file": {
            return label.setFileUploadComponent(
                // file_types has no setter in the builder yet, but constructor
                // data reaches the payload untouched.
                new FileUploadBuilder({
                    custom_id: question.field_id,
                    required,
                    min_values: required ? Math.max(1, question.min_values ?? 1) : 0,
                    max_values: Math.min(question.max_values ?? MAX_UPLOADS, MAX_UPLOADS) || 1,
                    file_types: ["image"]
                })
            );
        }
    }
}

// Reads whatever the applicant put in this question. Uploads are handed back
// separately because they are stored as screenshots, not as text.
export function readQuestion(interaction: ModalSubmitInteraction, question: QuestionRow): { answer?: AnswerEntry; shot?: ApplicationShot } {
    const options = questionOptions(question);
    const display = (values: readonly string[]) => values
        .map(value => options.find(option => option.value === value)?.label ?? value)
        .join(", ");

    switch (question.type) {
        case "text": {
            const value = interaction.fields.getTextInputValue(question.field_id).trim();
            if (!value) return {};

            return { answer: { field_id: question.field_id, label: question.label, type: "text", values: [value], display: value } };
        }

        case "select": {
            const values = [...interaction.fields.getStringSelectValues(question.field_id)];
            if (values.length === 0) return {};

            return { answer: { field_id: question.field_id, label: question.label, type: "select", values, display: display(values) } };
        }

        case "radio": {
            const value = interaction.fields.getRadioGroup(question.field_id, false);
            if (!value) return {};

            return { answer: { field_id: question.field_id, label: question.label, type: "radio", values: [value], display: display([value]) } };
        }

        case "checkbox": {
            const values = [...interaction.fields.getCheckboxGroup(question.field_id)];
            if (values.length === 0) return {};

            return { answer: { field_id: question.field_id, label: question.label, type: "checkbox", values, display: display(values) } };
        }

        case "file": {
            const files = interaction.fields.getUploadedFiles(question.field_id, false);
            if (!files || files.size === 0) return {};

            return { shot: { label: question.label, urls: [...files.values()].map(file => file.url) } };
        }
    }
}
