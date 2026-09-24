export type ApplicationStatus = "pending" | "accepted" | "rejected";

export interface ApplicationConfigRow {
    guild_id: string;
    panel_channel_id: string;
    panel_msg_id: string | null;
    review_channel_id: string;
    reviewer_role_id: string | null;
    accepted_role_id: string | null;
    panel_title: string | null;
    panel_body: string | null;
    panel_button: string | null;
    panel_note: string | null;
}

export interface ApplicationRow {
    id: number;
    guild_id: string;
    user_id: string;
    username: string;
    ign: string;
    player_type: string;
    content_type: string;
    path_build: string | null;
    weapons: string | null;
    activity_ok: string;
    about: string;
    previous_guild: string | null;
    pve_rank: string | null;
    screenshots: string;
    verify_passed: number;
    verify_log: string;
    status: ApplicationStatus;
    submitted_at: number;
    shots_inline: number;
    answers: string | null;
    review_msg_id: string | null;
    handled_by: string | null;
}

// A screenshot question and every image the applicant attached to it.
export interface ApplicationShot {
    label: string;
    urls: string[];
}

export interface VerifyQuestion {
    prompt: string;
    // More than one spelling is usually fair ("23:00" / "23" / "2300").
    answers: string[];
}

// Answers live in memory between modal steps: a modal submit cannot open the
// next modal, so the flow hops modal -> ephemeral button -> modal and needs
// somewhere to park the half-finished application until the last step.
export interface ApplicationSession {
    guild_id: string;
    user_id: string;
    expires_at: number;
    player_type?: string;
    content_type?: string[];
    ign?: string;
    about?: string;
    previous_guild?: string;
    activity_ok?: string;
    path_build?: string[];
    weapons?: string[];
    pve_rank?: string;
    screenshots: ApplicationShot[];
    answers?: AnswerEntry[];
    verify?: VerifyQuestion[];
}

export type QuestionType = "text" | "select" | "radio" | "checkbox" | "file";

// Which applicants see a question. Anything other than "always" depends on the
// answer to the question marked with role "content".
export type QuestionVisibility = "always" | "gvg" | "gve";

// A handful of questions mean something to the bot beyond being text on a
// form, so they carry a role. Everything else is just a question.
export type QuestionRole = "ign" | "content" | "activity";

export interface QuestionRow {
    id: number;
    guild_id: string;
    // 0 is asked in the first modal, before we know what they are applying for.
    // 1 is everything after, which is where conditional questions may live.
    stage: number;
    position: number;
    field_id: string;
    type: QuestionType;
    label: string;
    description: string | null;
    placeholder: string | null;
    required: number;
    paragraph: number;
    min_values: number | null;
    max_values: number | null;
    min_length: number | null;
    max_length: number | null;
    options: string | null;
    shown_when: QuestionVisibility;
    role: QuestionRole | null;
    enabled: number;
}

// What an applicant actually answered. The label and the option labels are
// copied in at submit time so renaming a question later cannot rewrite what
// somebody already said.
export interface AnswerEntry {
    field_id: string;
    label: string;
    type: QuestionType;
    values: string[];
    display: string;
}
