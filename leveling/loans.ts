import { Client, ContainerBuilder, GuildMember, MessageFlags } from "discord.js";
import { createLevelingTable } from "../schema/levelingDB.js";
import { logActivity } from "./activity.js";
import { Profile, XpResult, applyXp, getMember, onXpGain } from "./members.js";
import { resolveChannel } from "./notify.js";
import { getSettings } from "./settings.js";
import { COLOR, fmt, sep, signed, text } from "./ui.js";
import { isConnected } from "./uptime.js";
import { afterLevelChange } from "./xp.js";


const db = createLevelingTable();

// /loan: one member lends XP to another, who pays back amount + interest.
// The interest is fixed when the loan is offered and never grows; the term
// only decides when the bot collects. If the borrower is short on the due
// date the loan waits, and it is collected in full the moment they can pay.
//
// Either side can start it. /loan give is the lender offering terms straight
// away (pending). /loan ask is the borrower naming an amount first
// (requested); the lender then fills in how much, the interest and the term,
// which turns it into an ordinary offer the borrower still has to accept.

export type LoanStatus = "requested" | "pending" | "active" | "repaid" | "declined" | "cancelled" | "expired";

export interface Loan {
    id: number;
    guild_id: string;
    lender_id: string;
    borrower_id: string;
    amount: number;
    interest: number;
    interest_pct: number | null;
    duration_ms: number;
    status: LoanStatus;
    channel_id: string | null;
    message_id: string | null;
    created_at: number;
    accepted_at: number | null;
    due_at: number | null;
    overdue_notified: number;
    closed_at: number | null;
    // What the borrower asked for, when the loan started as /loan ask. Null
    // when the lender offered first, so it also says who started it.
    requested_amount: number | null;
    // Who declined or withdrew it. Null when it simply expired.
    closed_by: string | null;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// An offer nobody answers is withdrawn after this.
export const OFFER_MS = 10 * MINUTE;
// A request waits longer: the lender still has to write the terms, and they
// may well not be looking at the channel the moment they're asked.
export const REQUEST_MS = HOUR;
export const MIN_TERM_MS = MINUTE;
export const MAX_TERM_MS = 90 * DAY;
// Interest can be at most the loan itself, so a typo like "1000" meant as
// "10%" on a small loan can't turn into a debt many times its size.
export const MAX_INTEREST_PCT = 100;

export function owed(loan: Pick<Loan, "amount" | "interest">): number {
    return loan.amount + loan.interest;
}


// ---- parsing ---------------------------------------------------------------------

// "10%" is a share of the amount; "150", "1,500" or "1.5k" is a flat amount.
export function parseInterest(input: string, amount: number): { interest: number; pct: number | null } | null {
    const raw = input.trim().toLowerCase().replace(/[,_\s]/g, "");
    if (raw === "none" || raw === "no") return { interest: 0, pct: null };

    const pct = raw.match(/^(\d+(?:\.\d+)?)%$/);
    if (pct) {
        const p = Number(pct[1]);
        return { interest: Math.round(amount * p / 100), pct: p };
    }

    const num = raw.match(/^(\d+(?:\.\d+)?)([km]?)$/);
    if (!num) return null;
    const mult = num[2] === "k" ? 1_000 : num[2] === "m" ? 1_000_000 : 1;
    return { interest: Math.round(Number(num[1]) * mult), pct: null };
}

const UNITS: Record<string, number> = {
    m: MINUTE, min: MINUTE, mins: MINUTE, minute: MINUTE, minutes: MINUTE,
    h: HOUR, hr: HOUR, hrs: HOUR, hour: HOUR, hours: HOUR,
    d: DAY, day: DAY, days: DAY,
    w: 7 * DAY, wk: 7 * DAY, week: 7 * DAY, weeks: 7 * DAY
};

// "30m", "12h", "3d", "1w", "1d12h", "1d 12h". Every number needs a unit.
export function parseTerm(input: string): number | null {
    let rest = input.trim().toLowerCase().replace(/[\s,]/g, "");
    if (!rest) return null;
    let total = 0;
    while (rest) {
        const m = rest.match(/^(\d+(?:\.\d+)?)([a-z]+)/);
        if (!m || !(m[2] in UNITS)) return null;
        total += Number(m[1]) * UNITS[m[2]];
        rest = rest.slice(m[0].length);
    }
    return Math.round(total);
}

// Largest two units: "3 days", "1 day 12 hours", "45 minutes".
export function formatTerm(ms: number): string {
    let rest = Math.max(MINUTE, Math.round(ms / MINUTE) * MINUTE);
    const parts: string[] = [];
    for (const [size, name] of [[DAY, "day"], [HOUR, "hour"], [MINUTE, "minute"]] as const) {
        const n = Math.floor(rest / size);
        if (n > 0) {
            parts.push(`${n} ${name}${n === 1 ? "" : "s"}`);
            rest -= n * size;
        }
        if (parts.length === 2) break;
    }
    return parts.join(" ");
}

function ts(ms: number, style: "R" | "f" = "R"): string {
    return `<t:${Math.floor(ms / 1000)}:${style}>`;
}


// ---- database --------------------------------------------------------------------

export function getLoan(id: number): Loan | undefined {
    return db.get<Loan>(`SELECT * FROM loans WHERE id = ?`, id);
}

export function createOffer(o: {
    guild_id: string;
    lender_id: string;
    borrower_id: string;
    amount: number;
    interest: number;
    interest_pct: number | null;
    duration_ms: number;
    channel_id: string | null;
}): Loan {
    const r = db.run(
        `INSERT INTO loans (guild_id, lender_id, borrower_id, amount, interest, interest_pct, duration_ms, status, channel_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        o.guild_id, o.lender_id, o.borrower_id, o.amount, o.interest, o.interest_pct, o.duration_ms, o.channel_id, Date.now()
    );
    return getLoan(r.lastID)!;
}

// /loan ask: the borrower names an amount and waits for the lender to write
// the terms. Interest and term are still blank at this point.
export function createRequest(o: {
    guild_id: string;
    lender_id: string;
    borrower_id: string;
    amount: number;
    channel_id: string | null;
}): Loan {
    const r = db.run(
        `INSERT INTO loans (guild_id, lender_id, borrower_id, amount, interest, interest_pct, duration_ms, status, channel_id, created_at, requested_amount)
         VALUES (?, ?, ?, ?, 0, NULL, 0, 'requested', ?, ?, ?)`,
        o.guild_id, o.lender_id, o.borrower_id, o.amount, o.channel_id, Date.now(), o.amount
    );
    return getLoan(r.lastID)!;
}

// The lender answered a request with terms, so it becomes an ordinary offer.
// `created_at` restarts: the borrower gets a full OFFER_MS to accept them.
// Null if the request was closed in the meantime.
export function setTerms(id: number, t: { amount: number; interest: number; interest_pct: number | null; duration_ms: number }): Loan | null {
    const changed = db.run(
        `UPDATE loans SET amount = ?, interest = ?, interest_pct = ?, duration_ms = ?, status = 'pending', created_at = ?
         WHERE id = ? AND status = 'requested'`,
        t.amount, t.interest, t.interest_pct, t.duration_ms, Date.now(), id
    ).changes > 0;
    return changed ? getLoan(id)! : null;
}

// The request this borrower already has open with this lender, if any. Keeps
// one person from filling the channel with the same ask.
export function openRequest(guild_id: string, lender_id: string, borrower_id: string): Loan | undefined {
    return db.get<Loan>(
        `SELECT * FROM loans WHERE guild_id = ? AND lender_id = ? AND borrower_id = ? AND status = 'requested' ORDER BY id DESC LIMIT 1`,
        guild_id, lender_id, borrower_id
    );
}

export function setLoanMessage(id: number, message_id: string | null): void {
    db.run(`UPDATE loans SET message_id = ? WHERE id = ?`, message_id, id);
}

// Closes an offer or request that never became a loan. False if it was
// already answered. `by` is whoever pressed the button, if anyone did.
export function closeOffer(id: number, status: "declined" | "cancelled" | "expired", by?: string): boolean {
    return db.run(
        `UPDATE loans SET status = ?, closed_at = ?, closed_by = ? WHERE id = ? AND status IN ('pending', 'requested')`,
        status, Date.now(), by ?? null, id
    ).changes > 0;
}

// Of the two, the one who has to say yes at this point: the lender writes the
// terms for a request, the borrower accepts them on an offer. They're the one
// who "declines" it; the other side withdraws it.
export function responderOf(loan: Loan): string {
    return loan.status === "requested" ? loan.lender_id : loan.borrower_id;
}

// Everything still open that `user_id` is part of, due first.
export function openLoans(guild_id: string, user_id: string): Loan[] {
    return db.all<Loan[]>(
        `SELECT * FROM loans WHERE guild_id = ? AND (borrower_id = ? OR lender_id = ?) AND status IN ('requested', 'pending', 'active')
         ORDER BY COALESCE(due_at, created_at), id`,
        guild_id, user_id, user_id
    );
}

// The loan `borrower_id` should pay first (optionally only to one lender).
export function nextOwed(guild_id: string, borrower_id: string, lender_id?: string | null): Loan | undefined {
    return lender_id
        ? db.get<Loan>(`SELECT * FROM loans WHERE guild_id = ? AND borrower_id = ? AND lender_id = ? AND status = 'active' ORDER BY due_at, id LIMIT 1`, guild_id, borrower_id, lender_id)
        : db.get<Loan>(`SELECT * FROM loans WHERE guild_id = ? AND borrower_id = ? AND status = 'active' ORDER BY due_at, id LIMIT 1`, guild_id, borrower_id);
}

// What `user_id` owes on loans that are already due. While this is above 0
// they can't gift or lend XP, since that XP belongs to their lender.
export function overdueDebt(guild_id: string, user_id: string): number {
    return db.get<{ total: number }>(
        `SELECT COALESCE(SUM(amount + interest), 0) AS total FROM loans WHERE guild_id = ? AND borrower_id = ? AND status = 'active' AND due_at <= ?`,
        guild_id, user_id, Date.now()
    )?.total ?? 0;
}

function nameOf(guild_id: string, user_id: string): string {
    return getMember(guild_id, user_id).name ?? user_id;
}

export type AcceptResult =
    | { ok: true; loan: Loan; lender: XpResult; borrower: XpResult }
    | { ok: false; reason: string; closed: boolean };

// The borrower pressed Accept: the amount moves from lender to borrower and
// the clock starts. All in one transaction, so it happens once or not at all.
export function acceptLoan(id: number, lender_profile?: Profile, borrower_profile?: Profile): AcceptResult {
    return db.transaction((): AcceptResult => {
        const loan = getLoan(id);
        if (!loan || loan.status !== "pending") return { ok: false, reason: "This offer is no longer open.", closed: false };

        const xp_name = getSettings(loan.guild_id).server.xp_name;
        if (Date.now() >= loan.created_at + OFFER_MS) {
            closeOffer(id, "expired");
            return { ok: false, reason: `⌛ This offer expired before it was accepted. No ${xp_name} moved.`, closed: true };
        }
        const lender_balance = getMember(loan.guild_id, loan.lender_id).xp;
        if (lender_balance < loan.amount) {
            closeOffer(id, "cancelled");
            return { ok: false, reason: `❌ <@${loan.lender_id}> no longer has **${fmt(loan.amount)} ${xp_name}** to lend (they have ${fmt(lender_balance)}). No ${xp_name} moved.`, closed: true };
        }
        if (overdueDebt(loan.guild_id, loan.lender_id) > 0) {
            closeOffer(id, "cancelled");
            return { ok: false, reason: `❌ <@${loan.lender_id}> has an overdue loan of their own to pay first. No ${xp_name} moved.`, closed: true };
        }

        const now = Date.now();
        const lender = applyXp(loan.guild_id, loan.lender_id, -loan.amount, lender_profile);
        const borrower = applyXp(loan.guild_id, loan.borrower_id, loan.amount, borrower_profile);
        db.run(`UPDATE loans SET status = 'active', accepted_at = ?, due_at = ? WHERE id = ?`, now, now + loan.duration_ms, id);

        const lender_name = nameOf(loan.guild_id, loan.lender_id);
        const borrower_name = nameOf(loan.guild_id, loan.borrower_id);
        logActivity({
            guild_id: loan.guild_id, type: "xp",
            user_id: loan.borrower_id, user_name: borrower_name,
            text: `Loan from ${lender_name} · +${fmt(loan.amount)} (pays back ${fmt(owed(loan))})`,
            amount: loan.amount,
            actor_id: loan.lender_id, actor_name: lender_name
        });
        logActivity({
            guild_id: loan.guild_id, type: "xp",
            user_id: loan.lender_id, user_name: lender_name,
            text: `Lent to ${borrower_name} · -${fmt(loan.amount)} (gets back ${fmt(owed(loan))})`,
            amount: -loan.amount,
            actor_id: loan.borrower_id, actor_name: borrower_name
        });

        return { ok: true, loan: { ...loan, status: "active", accepted_at: now, due_at: now + loan.duration_ms }, lender, borrower };
    });
}

export interface Repaid {
    loan: Loan;
    borrower: XpResult;
    lender: XpResult;
}

// Moves amount + interest from borrower to lender, but only if the borrower
// has all of it. Null when they're short or the loan is already closed.
export function repayNow(id: number): Repaid | null {
    const loan = getLoan(id);
    if (!loan || loan.status !== "active") return null;
    const total = owed(loan);
    if (getMember(loan.guild_id, loan.borrower_id).xp < total) return null;

    return db.transaction(() => {
        const borrower = applyXp(loan.guild_id, loan.borrower_id, -total);
        const lender = applyXp(loan.guild_id, loan.lender_id, total);
        const now = Date.now();
        db.run(`UPDATE loans SET status = 'repaid', closed_at = ? WHERE id = ?`, now, id);

        const lender_name = nameOf(loan.guild_id, loan.lender_id);
        const borrower_name = nameOf(loan.guild_id, loan.borrower_id);
        logActivity({
            guild_id: loan.guild_id, type: "xp",
            user_id: loan.borrower_id, user_name: borrower_name,
            text: `Loan repaid to ${lender_name} · -${fmt(total)}`,
            amount: -total,
            actor_id: loan.lender_id, actor_name: lender_name
        });
        logActivity({
            guild_id: loan.guild_id, type: "xp",
            user_id: loan.lender_id, user_name: lender_name,
            text: `Loan repaid by ${borrower_name} · +${fmt(total)}`,
            amount: total,
            actor_id: loan.borrower_id, actor_name: borrower_name
        });

        return { loan: { ...loan, status: "repaid" as const, closed_at: now }, borrower, lender };
    });
}


// ---- cards -----------------------------------------------------------------------

function interestText(loan: Loan, xp_name: string): string {
    if (loan.interest === 0) return "none";
    const pct = loan.interest_pct !== null ? `${Math.round(loan.interest_pct * 100) / 100}% → ` : "";
    return `${pct}**+${fmt(loan.interest)} ${xp_name}**`;
}

// What each side ends up with once the loan is paid back. This is the part
// both people need to read before the borrower accepts.
function outcomeLines(loan: Loan, xp_name: string, tense: "offer" | "active" | "done"): string[] {
    const total = owed(loan);
    const b = `<@${loan.borrower_id}>`;
    const l = `<@${loan.lender_id}>`;
    const cost = loan.interest > 0 ? `**${signed(-loan.interest)} ${xp_name}** overall` : "nothing extra (no interest)";
    const gain = loan.interest > 0 ? `**${signed(loan.interest)} ${xp_name}** overall` : "nothing extra (no interest)";

    if (tense === "done") {
        return [
            `📥 ${b}: got ${fmt(loan.amount)}, paid back ${fmt(total)} → ${cost}`,
            `📤 ${l}: gave ${fmt(loan.amount)}, got back ${fmt(total)} → ${gain}`
        ];
    }
    if (tense === "active") {
        return [
            `📥 ${b} got **+${fmt(loan.amount)}** and pays back **${fmt(total)}** when it's due → ${cost}`,
            `📤 ${l} gave **${fmt(loan.amount)}** and gets back **${fmt(total)}** when it's due → ${gain}`
        ];
    }
    return [
        `📥 ${b} gets **+${fmt(loan.amount)}** now and pays back **${fmt(total)}** later → ${cost}`,
        `📤 ${l} gives **${fmt(loan.amount)}** now and gets back **${fmt(total)}** later → ${gain}`
    ];
}

function terms(loan: Loan, xp_name: string): string[] {
    // On a loan that started as a request, say so when the lender's amount
    // isn't the one that was asked for.
    const asked = loan.requested_amount !== null && loan.requested_amount !== loan.amount
        ? ` *(asked for ${fmt(loan.requested_amount)})*`
        : "";
    return [
        `💵 Loan: **${fmt(loan.amount)} ${xp_name}**${asked}`,
        `📈 Interest: ${interestText(loan, xp_name)}`,
        `🔁 Pays back: **${fmt(owed(loan))} ${xp_name}**`
    ];
}

function closedNote(loan: Loan, xp_name: string, was_request: boolean): string {
    const nothing = `No ${xp_name} moved.`;
    const what = was_request ? "request" : "offer";
    if (loan.status === "declined") {
        // Whoever pressed it; on old rows nobody was recorded, and back then
        // only the borrower could decline.
        return `🙅 <@${loan.closed_by ?? loan.borrower_id}> said no. ${nothing}`;
    }
    if (loan.status === "cancelled") {
        return loan.closed_by
            ? `🚫 <@${loan.closed_by}> withdrew the ${what}. ${nothing}`
            : `🚫 The ${what} was withdrawn. ${nothing}`;
    }
    return was_request ? `⌛ Nobody answered in time. ${nothing}` : `⌛ Nobody accepted in time. ${nothing}`;
}

// The card on the original /loan message, for every stage of the loan.
// `note` adds a line at the bottom (balances after accepting, a reason).
export function loanCard(loan: Loan, note?: string): ContainerBuilder {
    const xp_name = getSettings(loan.guild_id).server.xp_name;
    const total = owed(loan);
    const lines: string[] = [];
    let color: number = COLOR.push;
    let footer = "";

    // A request whose terms were never written: the amount is all there is.
    const bare_request = loan.requested_amount !== null && loan.duration_ms === 0;

    switch (loan.status) {
        case "requested":
            color = COLOR.pending;
            lines.push(
                `### 🙏 Loan Request`,
                `<@${loan.borrower_id}> is asking <@${loan.lender_id}> for a loan.`,
                "",
                `💵 Asking for: **${fmt(loan.amount)} ${xp_name}**`,
                "",
                `<@${loan.lender_id}>, it's your call — **Set terms** to say how much you'll lend, the interest and how long <@${loan.borrower_id}> has to pay it back.`
            );
            footer = `Nothing moves yet. Once <@${loan.lender_id}> sets the terms, <@${loan.borrower_id}> still has to accept them. Either of you can close this. Request expires ${ts(loan.created_at + REQUEST_MS)}.`;
            break;
        case "pending":
            color = COLOR.pending;
            lines.push(
                `### 🏦 Loan Offer`,
                loan.requested_amount !== null
                    ? `<@${loan.lender_id}> answered <@${loan.borrower_id}>'s request with these terms.`
                    : `<@${loan.lender_id}> offers <@${loan.borrower_id}> a loan.`,
                "",
                ...terms(loan, xp_name),
                `⏰ Term: **${formatTerm(loan.duration_ms)}**, counted from when it's accepted`,
                "",
                `**If <@${loan.borrower_id}> accepts:**`,
                ...outcomeLines(loan, xp_name, "offer")
            );
            footer = `The interest is fixed: it doesn't grow over time, and paying early costs the same. After ${formatTerm(loan.duration_ms)} the bot takes ${fmt(total)} ${xp_name} from <@${loan.borrower_id}> automatically. If they don't have enough then, it waits and takes it the moment they do. Offer expires ${ts(loan.created_at + OFFER_MS)}.`;
            break;
        case "active": {
            const late = loan.due_at! <= Date.now();
            color = late ? COLOR.lose : COLOR.info;
            lines.push(
                late ? `### ⏰ Loan Overdue` : `### 🏦 Loan Active`,
                `<@${loan.lender_id}> lent <@${loan.borrower_id}> **${fmt(loan.amount)} ${xp_name}**.`,
                "",
                `🔁 Pays back: **${fmt(total)} ${xp_name}** (${fmt(loan.amount)} + ${fmt(loan.interest)} interest)`,
                late ? `⏰ Was due ${ts(loan.due_at!)}, collected the moment <@${loan.borrower_id}> has ${fmt(total)}` : `⏰ Due ${ts(loan.due_at!, "f")} (${ts(loan.due_at!)})`,
                "",
                ...outcomeLines(loan, xp_name, "active")
            );
            footer = `Collected automatically when it's due. If <@${loan.borrower_id}> is short then, it's taken the moment they have enough. \`/loan repay\` pays it early (same amount).`;
            break;
        }
        case "repaid":
            color = COLOR.win;
            lines.push(
                `### ✅ Loan Repaid`,
                `<@${loan.borrower_id}> paid <@${loan.lender_id}> back **${fmt(total)} ${xp_name}** (${fmt(loan.amount)} + ${fmt(loan.interest)} interest).`,
                "",
                ...outcomeLines(loan, xp_name, "done")
            );
            if (loan.closed_at) footer = `Repaid ${ts(loan.closed_at)}.`;
            break;
        default:
            lines.push(
                bare_request ? `### 🙏 Loan Request` : `### 🏦 Loan Offer`,
                bare_request
                    ? `<@${loan.borrower_id}> asked <@${loan.lender_id}> for a loan.`
                    : `<@${loan.lender_id}> offered <@${loan.borrower_id}> a loan.`,
                "",
                ...(bare_request ? [`💵 Asked for: **${fmt(loan.amount)} ${xp_name}**`] : terms(loan, xp_name)),
                "",
                closedNote(loan, xp_name, bare_request)
            );
    }

    const container = new ContainerBuilder().setAccentColor(color).addTextDisplayComponents(text(lines.join("\n")));
    if (footer || note) {
        container.addSeparatorComponents(sep());
        container.addTextDisplayComponents(text([note, footer ? `-# ${footer}` : ""].filter(Boolean).join("\n")));
    }
    return container;
}

export type RepaidHow = "manual" | "due" | "late";

// Posted when a loan gets paid back: both balances, and how it was paid.
export function repaidCard(paid: Repaid, how: RepaidHow): ContainerBuilder {
    const { loan } = paid;
    const xp_name = getSettings(loan.guild_id).server.xp_name;
    const total = owed(loan);
    const early = (loan.closed_at ?? Date.now()) < loan.due_at!;
    const when = {
        manual: `Paid back by <@${loan.borrower_id}> with \`/loan repay\`${early ? `, before it was due (${ts(loan.due_at!)})` : ""}.`,
        due: `Collected automatically on the due date.`,
        late: `Collected automatically the moment <@${loan.borrower_id}> had enough (it was due ${ts(loan.due_at!)}).`
    }[how];

    return new ContainerBuilder()
        .setAccentColor(COLOR.win)
        .addTextDisplayComponents(text([
            `### ✅ Loan Repaid`,
            `<@${loan.borrower_id}> paid <@${loan.lender_id}> back **${fmt(total)} ${xp_name}** (${fmt(loan.amount)} + ${fmt(loan.interest)} interest).`,
            "",
            `📥 <@${loan.borrower_id}>: **${signed(-loan.interest)} ${xp_name}** overall on this loan · balance ${fmt(paid.borrower.xp)}`,
            `📤 <@${loan.lender_id}>: **${signed(loan.interest)} ${xp_name}** overall on this loan · balance ${fmt(paid.lender.xp)}`
        ].join("\n")))
        .addSeparatorComponents(sep())
        .addTextDisplayComponents(text(`-# ${when}`));
}

function overdueCard(loan: Loan, balance: number): ContainerBuilder {
    const xp_name = getSettings(loan.guild_id).server.xp_name;
    const total = owed(loan);
    return new ContainerBuilder()
        .setAccentColor(COLOR.lose)
        .addTextDisplayComponents(text([
            `### ⏰ Loan Due: Waiting for ${xp_name}`,
            `<@${loan.borrower_id}> owes <@${loan.lender_id}> **${fmt(total)} ${xp_name}** but has only **${fmt(balance)}**.`,
            `The bot takes the full **${fmt(total)} ${xp_name}** automatically the moment <@${loan.borrower_id}> has it.`
        ].join("\n")))
        .addSeparatorComponents(sep())
        .addTextDisplayComponents(text(`-# Until it's paid, <@${loan.borrower_id}> can't gift or lend ${xp_name}.`));
}


// ---- Discord side ----------------------------------------------------------------

async function memberOf(client: Client, guild_id: string, user_id: string): Promise<GuildMember | null> {
    const guild = client.guilds.cache.get(guild_id);
    if (!guild) return null;
    return guild.members.cache.get(user_id) ?? await guild.members.fetch(user_id).catch(() => null);
}

// Brings the original /loan message up to date. Best effort: the channel or
// message may be gone, and the loan itself lives in the database anyway.
export async function refreshLoanMessage(client: Client, loan: Loan): Promise<void> {
    if (!loan.message_id) return;
    const channel = await resolveChannel(client, loan.channel_id);
    if (!channel) return;
    await channel.messages.edit(loan.message_id, { components: [loanCard(loan)], allowedMentions: { parse: [] } }).catch(() => {});
}

// A new message under the original /loan message that pings both sides.
async function announce(client: Client, loan: Loan, container: ContainerBuilder): Promise<void> {
    const channel = await resolveChannel(client, loan.channel_id);
    if (!channel) return;
    await channel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [], users: [loan.borrower_id, loan.lender_id], repliedUser: false },
        reply: loan.message_id ? { messageReference: loan.message_id, failIfNotExists: false } : undefined
    }).catch(err => console.error(`Loan ${loan.id}: could not post in channel ${loan.channel_id}:`, err));
}

// Everything after the XP moved: level roles for both sides, the original
// card, and (unless the command replies itself) a message pinging both.
export async function afterRepay(client: Client, paid: Repaid, how: RepaidHow, post: boolean): Promise<void> {
    const { loan } = paid;
    refreshDebtor(loan.guild_id, loan.borrower_id);
    const channel = await resolveChannel(client, loan.channel_id);
    for (const [user_id, r] of [[loan.borrower_id, paid.borrower], [loan.lender_id, paid.lender]] as const) {
        if (r.level === r.old_level) continue;
        const member = await memberOf(client, loan.guild_id, user_id);
        if (member) await afterLevelChange(member, r.old_level, r.level, r.xp, { channel }).catch(err => console.error("Loan level change failed:", err));
    }
    await refreshLoanMessage(client, paid.loan);
    if (post) await announce(client, loan, repaidCard(paid, how));
}


// ---- collecting ------------------------------------------------------------------

let bot: Client | null = null;

// Borrowers with a loan past its due date → what the first loan in line
// needs. Only these are watched when XP comes in, so the hot path (every chat
// message gives XP) is one Map lookup.
const waiting = new Map<string, number>();
const queued = new Set<string>();

const key = (guild_id: string, user_id: string) => `${guild_id}|${user_id}`;

function refreshDebtor(guild_id: string, borrower_id: string): void {
    const next = db.get<{ total: number }>(
        `SELECT amount + interest AS total FROM loans WHERE guild_id = ? AND borrower_id = ? AND status = 'active' AND due_at <= ? ORDER BY due_at, id LIMIT 1`,
        guild_id, borrower_id, Date.now()
    );
    if (next) waiting.set(key(guild_id, borrower_id), next.total);
    else waiting.delete(key(guild_id, borrower_id));
}

// Pays the borrower's due loans in the order they came due. A loan the
// borrower can't cover yet blocks the ones behind it, so whoever lent first
// is paid first.
async function collectFrom(client: Client, guild_id: string, borrower_id: string): Promise<void> {
    // Offline the messages would fail; the tick retries once Discord is back.
    if (!isConnected(client)) return;

    const due = db.all<Loan[]>(
        `SELECT * FROM loans WHERE guild_id = ? AND borrower_id = ? AND status = 'active' AND due_at <= ? ORDER BY due_at, id`,
        guild_id, borrower_id, Date.now()
    );
    for (const loan of due) {
        const paid = repayNow(loan.id);
        if (paid) {
            await afterRepay(client, paid, loan.overdue_notified ? "late" : "due", true);
            continue;
        }
        if (getLoan(loan.id)?.status !== "active") continue;

        // Short on money: say so once, then wait for XP to come in.
        if (!loan.overdue_notified && db.run(`UPDATE loans SET overdue_notified = 1 WHERE id = ? AND overdue_notified = 0`, loan.id).changes > 0) {
            await refreshLoanMessage(client, loan);
            await announce(client, loan, overdueCard(loan, getMember(guild_id, borrower_id).xp));
        }
        break;
    }
    refreshDebtor(guild_id, borrower_id);
}

// The moment an overdue borrower's balance covers their next loan, collect.
// Deferred so it runs after whatever gave the XP has finished (and committed).
onXpGain((guild_id, user_id, xp) => {
    const need = waiting.get(key(guild_id, user_id));
    if (need === undefined || xp < need || !bot) return;
    const k = key(guild_id, user_id);
    if (queued.has(k)) return;
    queued.add(k);
    const client = bot;
    setImmediate(() => {
        queued.delete(k);
        collectFrom(client, guild_id, user_id).catch(err => console.error("Loan collection failed:", err));
    });
});

export function startLoans(client: Client): void {
    bot = client;
    waiting.clear();
    const rows = db.all<{ guild_id: string; borrower_id: string }[]>(
        `SELECT DISTINCT guild_id, borrower_id FROM loans WHERE status = 'active' AND due_at <= ?`, Date.now()
    );
    for (const r of rows) refreshDebtor(r.guild_id, r.borrower_id);
}

// Background job: collects loans that just came due, retries overdue ones
// (in case XP arrived while Discord was unreachable) and closes offers and
// requests nobody answered.
export async function loanTick(client: Client): Promise<void> {
    bot = client;
    if (!isConnected(client)) return;
    const now = Date.now();

    const stale = db.all<Loan[]>(
        `SELECT * FROM loans WHERE (status = 'pending' AND created_at <= ?) OR (status = 'requested' AND created_at <= ?)`,
        now - OFFER_MS, now - REQUEST_MS
    );
    for (const loan of stale) {
        if (closeOffer(loan.id, "expired")) await refreshLoanMessage(client, { ...loan, status: "expired" });
    }

    const debtors = db.all<{ guild_id: string; borrower_id: string }[]>(
        `SELECT DISTINCT guild_id, borrower_id FROM loans WHERE status = 'active' AND due_at <= ?`, now
    );
    for (const d of debtors) {
        if (!client.guilds.cache.has(d.guild_id)) continue;
        await collectFrom(client, d.guild_id, d.borrower_id);
    }
}
