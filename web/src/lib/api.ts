// Thin fetch wrapper for the bot's /api endpoints, plus the shapes they return.

export class ApiError extends Error {
	constructor(public status: number, message: string) {
		super(message);
	}
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
	const res = await fetch(`/api${path}`, {
		method: init.method ?? "GET",
		headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
		body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
		credentials: "same-origin"
	});
	let data: unknown = null;
	try {
		data = await res.json();
	} catch {
		// Empty or non-JSON body; handled by the status check below.
	}
	if (!res.ok) {
		const msg = (data as { error?: string } | null)?.error ?? `Request failed (${res.status})`;
		throw new ApiError(res.status, msg);
	}
	return data as T;
}

export interface Me {
	login_enabled: boolean;
	invite_url: string | null;
	bot: { id: string; name: string; avatar: string } | null;
	user: { id: string; username: string; global_name: string | null; avatar: string } | null;
}

export interface GuildInfo {
	id: string;
	name: string;
	icon: string | null;
	member_count: number;
	access: "admin" | "manager";
	bot: { can_manage_roles: boolean; highest_role: number };
}

export interface Channel {
	id: string;
	name: string;
	type: "text" | "announcement" | "voice" | "stage" | "category" | "forum";
	parent_id: string | null;
	position: number;
}

export interface Role {
	id: string;
	name: string;
	color: string | null;
	position: number;
	managed: boolean;
	assignable: boolean;
}

export interface Template {
	title: string;
	body: string;
	color: string;
	thumbnail: boolean;
	image: string;
	footer: string;
}

export interface WheelSegment {
	emoji: string;
	multiplier: number;
	weight: number;
}

export interface GameSettings {
	enabled: boolean;
	cooldown: number;
	min_bet: number;
	max_bet: number;
	fee: number;
	multiplier: number;
	mines: number;
	per_step: number;
	house_edge: number;
	max_rounds: number;
	floors: number;
	traps: number;
	horses: number;
	attempts: number;
	first_try: number;
	try_drop: number;
	segments: WheelSegment[];
}

export interface Boost {
	id: string;
	type: "all" | "role" | "channel" | "category" | "daily";
	target_id: string | null;
	amount: number;
	expires_at: number | null;
}

export interface Ignore {
	type: "channel" | "category" | "role";
	id: string;
}

export interface WelcomeButton {
	id: string;
	label: string;
	emoji: string;
	kind: "channel" | "url";
	channel_id: string | null;
	url: string;
}

export interface WelcomeBlock {
	id: string;
	type: "text" | "buttons" | "image" | "separator";
	text: string;
	// What sits down the right of a text block. "button" uses buttons[0].
	accessory: "none" | "avatar" | "button";
	buttons: WelcomeButton[];
	divider: boolean;
}

export interface WelcomeCard {
	enabled: boolean;
	background: string;
	background_color: string;
	overlay: number;
	accent: string;
	text_color: string;
	sub_color: string;
	title: string;
	subtitle: string;
	footer: string;
	avatar_shape: "circle" | "rounded" | "square";
	avatar_ring: boolean;
	layout: "center" | "left";
}

export interface Settings {
	server: {
		xp_name: string;
		chat_xp: number;
		voice_xp: number;
		daily_xp: number;
		chat_cooldown: number;
		formula: { multiplier: number; offset: number; divider: number };
		voice_mute_mode: "disabled" | "block" | "reduce";
		voice_mute_reduction: number;
		voice_require_company: boolean;
		gift_enabled: boolean;
		loan_enabled: boolean;
		reset_left_users: boolean;
		private_daily: boolean;
		bonus_enabled: boolean;
		bonus_xp: number;
		timezone: string;
	};
	level: {
		prefix: string;
	};
	roles: {
		admin_roles: string[];
		role_channel: string | null;
		level_roles: { level: number; role_id: string }[];
		level_highest_only: boolean;
		attendance_roles: { type: "total" | "streak"; threshold: number; role_id: string }[];
		attendance_highest_only: boolean;
	};
	boosts: Boost[];
	ignores: Ignore[];
	notifications: {
		levelup_enabled: boolean;
		levelup_channel: string | null;
		shop_log_channel: string | null;
		shop_admin_channel: string | null;
		templates: { levelup: Template; role: Template; total: Template; streak: Template };
	};
	gamble: {
		enabled: boolean;
		channels: string[];
		games: Record<string, GameSettings>;
	};
	leaderboard: {
		xp_channel: string | null;
		monthly_channel: string | null;
		total_channel: string | null;
		streak_channel: string | null;
		color: string;
		titles: { xp: string; monthly: string; total: string; streak: string };
	};
	season: {
		enabled: boolean;
		period: "monthly" | "quarterly" | "half" | "yearly" | "date";
		date: string;
		time: string;
		target: "exp" | "attendance" | "both";
		announce_channel: string | null;
		custom_announce: boolean;
		announce_title: string;
		announce_body: string;
		log_channel: string | null;
	};
	birthday: {
		enabled: boolean;
		announce_channel: string | null;
		announce_time: string;
		mention_user: boolean;
		ping_role: string | null;
		birthday_role: string | null;
		age_line: string;
		panel_channel: string | null;
		panel_sticky: boolean;
		set_label: string;
		remove_label: string;
		list_label: string;
		templates: { panel: Template; announce: Template };
	};
	welcome: {
		enabled: boolean;
		channel: string | null;
		mention_user: boolean;
		ping_role: string | null;
		color: string;
		footer: string;
		blocks: WelcomeBlock[];
		card: WelcomeCard;
	};
	meta: { season_next: number | null };
}

export interface BirthdayRow {
	user_id: string;
	name: string;
	avatar: string | null;
	in_server: boolean;
	month: number;
	day: number;
	year: number | null;
	age: number | null;
	in_days: number;
}

export type Section = Exclude<keyof Settings, "meta">;

export interface BoardEntry {
	rank: number;
	user_id: string;
	name: string;
	avatar: string | null;
	level: number;
	xp: number;
	value: number;
}

export interface BoardPage {
	entries: BoardEntry[];
	total: number;
	page: number;
	pages: number;
}

export interface MemberRow {
	user_id: string;
	name: string;
	avatar: string | null;
	in_server: boolean;
	xp: number;
	level: number;
	month_xp: number;
	att_total: number;
	att_streak: number;
}

export interface ActivityRow {
	id: number;
	type: "settings" | "xp" | "level" | "roles" | "games" | "shop" | "reset";
	user_id: string | null;
	user_name: string | null;
	text: string;
	amount: number | null;
	actor_id: string | null;
	actor_name: string | null;
	created_at: number;
}

export interface ShopItem {
	id: number;
	name: string;
	description: string;
	emoji: string;
	price: number;
	type: "role" | "timed_role" | "item";
	role_id: string | null;
	duration_hours: number;
	stock: number;
	per_user_limit: number;
	enabled: number | boolean;
	sort: number;
}

export interface Purchase {
	id: number;
	user_id: string;
	user_name: string;
	item_name: string;
	price: number;
	type: string;
	status: string;
	expires_at: number | null;
	created_at: number;
}

export interface Stats {
	messages: number;
	voice_hours: number;
	xp: number;
	avg_active_users: number;
	member_change: number;
	joins: number;
	leaves: number;
	member_count: number;
	points: { label: string; messages: number; voice_hours: number; xp: number; active_users: number | null; members: number | null }[];
	channels: { channel_id: string; messages: number; xp: number }[];
}

export interface PublicShop {
	guild: { id: string; name: string; icon: string | null };
	xp_name: string;
	items: {
		id: number;
		name: string;
		description: string;
		emoji: string;
		price: number;
		type: "role" | "timed_role" | "item";
		duration_hours: number;
		stock: number;
		per_user_limit: number;
		role: { name: string; color: string | null } | null;
	}[];
	viewer: null | { member: false } | { member: true; name: string; balance: number; is_admin: boolean; inventory: Purchase[] };
}

// ---- message builder -------------------------------------------------------
// Mirrors messages/schema.ts on the bot's side. The limits are Discord's, kept
// here so the builder can show a counter without asking the server.

export const MSG_LIMITS = {
	content: 2000,
	embeds: 10,
	embed_title: 256,
	embed_description: 4096,
	embed_author: 256,
	embed_footer: 2048,
	embed_fields: 25,
	field_name: 256,
	field_value: 1024,
	embed_total: 6000,
	rows: 5,
	row_buttons: 5,
	button_label: 80,
	button_roles: 10,
	reply_text: 1500,
	select_placeholder: 150,
	select_options: 25,
	option_label: 100,
	option_description: 100,
	v2_top: 10,
	v2_total: 40,
	v2_text: 4000,
	gallery_items: 10,
	files: 10,
	url: 1000,
	name: 80
} as const;

export interface MsgMedia {
	id: string;
	url: string;
	alt: string;
	spoiler: boolean;
}

export type ButtonKind = "link" | "channel" | "role" | "reply" | "none";
export type ButtonStyleName = "primary" | "secondary" | "success" | "danger";
export type RoleMode = "add" | "remove" | "toggle";

// What the posted message does to itself after a press. "everyone" really does
// mean everyone — Discord gives every viewer the same components — so it suits
// a one-shot and nothing else. See messages/schema.ts.
export interface ButtonAfter {
	mode: "nothing" | "everyone";
	label: string;
	style: ButtonStyleName | "keep";
	disable: boolean;
}

export interface MsgButton {
	id: string;
	kind: ButtonKind;
	label: string;
	emoji: string;
	style: ButtonStyleName;
	disabled: boolean;
	url: string;
	channel_id: string | null;
	role_mode: RoleMode;
	role_ids: string[];
	remove_ids: string[];
	reply_text: string;
	reply_public: boolean;
	after: ButtonAfter;
}

export interface MsgOption {
	id: string;
	label: string;
	description: string;
	emoji: string;
	role_id: string | null;
}

export interface MsgSelect {
	id: string;
	kind: "role";
	placeholder: string;
	min: number;
	max: number;
	disabled: boolean;
	options: MsgOption[];
}

export interface MsgRow {
	id: string;
	type: "buttons" | "select";
	buttons: MsgButton[];
	select: MsgSelect;
}

export interface MsgField {
	id: string;
	name: string;
	value: string;
	inline: boolean;
}

export interface MsgEmbed {
	id: string;
	color: string;
	author: { name: string; url: string; icon_url: string };
	title: string;
	url: string;
	description: string;
	fields: MsgField[];
	image: string;
	thumbnail: string;
	footer: { text: string; icon_url: string };
	timestamp: "none" | "now" | "custom";
	timestamp_at: string;
}

export type NodeType = "text" | "section" | "gallery" | "separator" | "row" | "file" | "container";

export interface MsgNode {
	id: string;
	type: NodeType;
	text: string;
	accessory: "thumbnail" | "button";
	thumbnail: MsgMedia;
	button: MsgButton;
	items: MsgMedia[];
	divider: boolean;
	spacing: "small" | "large";
	row: MsgRow;
	file: MsgMedia;
	accent: string;
	spoiler: boolean;
	children: MsgNode[];
}

export interface MessageDoc {
	mode: "classic" | "v2";
	content: string;
	embeds: MsgEmbed[];
	rows: MsgRow[];
	attachments: MsgMedia[];
	nodes: MsgNode[];
	tts: boolean;
	silent: boolean;
	suppress_embeds: boolean;
	mentions: { everyone: boolean; roles: boolean; users: boolean };
}

export interface MessageSummary {
	id: number;
	name: string;
	mode: MessageDoc["mode"];
	channel_id: string | null;
	message_id: string | null;
	created_at: number;
	updated_at: number;
}

export interface SavedMessage extends MessageSummary {
	doc: MessageDoc;
	// Only on an import: what didn't survive being read back out of Discord.
	warnings?: string[];
}

export interface SendResult {
	ok: true;
	message: string;
	link: string;
	channel_id: string;
	message_id: string;
	// Pieces left out for being unfinished.
	dropped: string[];
}

// ---- applications ----------------------------------------------------------
// Mirrors types/Application.ts on the bot's side.

export type QuestionType = "text" | "select" | "radio" | "checkbox" | "file";
export type QuestionVisibility = "always" | "gvg" | "gve";
export type QuestionRole = "ign" | "content" | "activity";

export interface QuestionOption {
	label: string;
	value: string;
	description?: string;
}

export interface AppQuestion {
	id: number;
	guild_id: string;
	// 0 is the first form, asked before we know what they're applying for.
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

export interface AppSettings {
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

export interface ApplicationsPayload {
	settings: AppSettings | null;
	questions: AppQuestion[];
	defaults: { title: string; body: string; button: string; note: string };
}

// What Discord will take for each kind of question.
export const QUESTION_LIMITS = {
	label: 45,
	description: 100,
	placeholder: 100,
	per_form: 5,
	uploads: 10,
	options: { text: 0, select: 25, radio: 10, checkbox: 10, file: 0 } as Record<QuestionType, number>,
	min_options: { text: 0, select: 1, radio: 2, checkbox: 1, file: 0 } as Record<QuestionType, number>
} as const;

export function parseOptions(question: Pick<AppQuestion, "options">): QuestionOption[] {
	if (!question.options) return [];
	try {
		const parsed = JSON.parse(question.options);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}
