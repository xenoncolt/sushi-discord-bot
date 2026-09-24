import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, CheckboxGroupBuilder, Client, ContainerBuilder, FileUploadBuilder, LabelBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags, ModalBuilder, ModalSubmitInteraction, PermissionFlagsBits, RadioGroupBuilder, SendableChannels, SeparatorBuilder, SeparatorSpacingSize, StringSelectMenuBuilder, TextDisplayBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { createApplicationTable } from "../schema/applicationDB.js";
import { AnswerEntry, ApplicationConfigRow, ApplicationRow, ApplicationSession, ApplicationShot, QuestionRow, VerifyQuestion } from "../types/Application.js";
import { CONTENT_TYPES, PATH_BUILDS, PLAYER_TYPES, WEAPONS, buildVerifyQuestions, checkAnswer, labelOf, labelsOf } from "./applicationData.js";
import { MAX_MODAL_COMPONENTS, buildQuestionLabel, loadQuestions, readQuestion, visibleFor } from "./applicationQuestions.js";


const db = createApplicationTable();

// Discord accepts ten attachments on one message and ten files per upload.
const MAX_ATTACHMENTS = 10;

const ACCENT_PENDING = 0xE8A33D;
const ACCENT_ACCEPTED = 0x57F287;
const ACCENT_REJECTED = 0xED4245;

// Discord caps a modal at five top-level components and refuses to answer a
// modal submit with another modal, so the form is split across several modals
// joined by ephemeral "Continue" buttons. Half-finished answers park here
// until the last step writes them to the database.
const SESSION_TTL = 20 * 60 * 1000;
const sessions = new Map<string, ApplicationSession>();


function sessionKey(guild_id: string, user_id: string): string {
    return `${guild_id}:${user_id}`;
}

function startSession(guild_id: string, user_id: string): ApplicationSession {
    const session: ApplicationSession = {
        guild_id,
        user_id,
        expires_at: Date.now() + SESSION_TTL,
        screenshots: []
    };

    sessions.set(sessionKey(guild_id, user_id), session);
    return session;
}

function getSession(guild_id: string, user_id: string): ApplicationSession | null {
    const key = sessionKey(guild_id, user_id);
    const session = sessions.get(key);
    if (!session) return null;

    if (session.expires_at <= Date.now()) {
        sessions.delete(key);
        return null;
    }

    // Every step they finish buys another full window.
    session.expires_at = Date.now() + SESSION_TTL;
    return session;
}

// Forms people walk away from would otherwise sit in memory until restart.
setInterval(() => {
    const now = Date.now();
    for (const [key, session] of sessions) {
        if (session.expires_at <= now) sessions.delete(key);
    }
}, 5 * 60 * 1000).unref();


export function getApplicationConfig(guild_id: string): ApplicationConfigRow | undefined {
    return db.get<ApplicationConfigRow>(`SELECT * FROM application_config WHERE guild_id = ?`, guild_id);
}

async function resolveSendable(client: Client, channel_id: string): Promise<SendableChannels | null> {
    const channel = client.channels.cache.get(channel_id)
        ?? await client.channels.fetch(channel_id).catch(() => null);

    if (channel && channel.isTextBased() && channel.isSendable()) {
        return channel;
    }
    return null;
}


export const PANEL_DEFAULTS = {
    title: "Applications <:ppnotebook:1550224832157712555>",
    body: [
        `Want to join us? Press the button below and fill in the form. It takes about five minutes and only the officers can read your answers.`,
        ``,
        `**Have these screenshots ready before you start:**`,
        `- All of your current innerways`,
        `- Your current stats page`,
        `- Your arena rank history *(GvG applicants only)*`,
        `- Your GvG stats *(GvG applicants only)*`
    ].join("\n"),
    button: "Start Application",
    note: "**Activity requirement:** you must be able to reach **3k activity every week**. If you cannot keep that up after joining you will be kicked and banned, so please answer that question honestly."
};

export function buildPanelContainer(config?: ApplicationConfigRow): ContainerBuilder {
    const container = new ContainerBuilder().setAccentColor(ACCENT_PENDING);

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`# ${config?.panel_title || PANEL_DEFAULTS.title}`)
    );

    container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );

    const note = config?.panel_note ?? PANEL_DEFAULTS.note;

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            [config?.panel_body || PANEL_DEFAULTS.body, note].filter(Boolean).join("\n\n").slice(0, 3500)
        )
    );

    container.addActionRowComponents(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId("app_start")
                .setLabel((config?.panel_button || PANEL_DEFAULTS.button).slice(0, 80))
                .setEmoji("📝")
                .setStyle(ButtonStyle.Success)
        )
    );

    return container;
}


// Puts the panel where the config says it should be: edits the one already
// posted, moves it if the channel changed, and posts a fresh one if it is gone.
export async function syncApplicationPanel(client: Client, config: ApplicationConfigRow): Promise<string | null> {
    const channel = await resolveSendable(client, config.panel_channel_id);
    if (!channel) return config.panel_msg_id;

    if (config.panel_msg_id) {
        const existing = await channel.messages.fetch(config.panel_msg_id).catch(() => null);

        if (existing?.editable) {
            await existing.edit({ components: [buildPanelContainer(config)], flags: MessageFlags.IsComponentsV2 });
            return existing.id;
        }
    }

    const posted = await channel.send({ components: [buildPanelContainer(config)], flags: MessageFlags.IsComponentsV2 });
    return posted.id;
}


// Questions live in the database so they can be edited from the dashboard. The
// first modal is the questions marked stage 0, which everyone answers; the rest
// depend on what they ticked there and are cut into modals of five, because
// that is all Discord allows in one.
function buildPart1Modal(guild_id: string): ModalBuilder {
    const questions = visibleFor(loadQuestions(guild_id), 0, []).slice(0, MAX_MODAL_COMPONENTS);

    return new ModalBuilder()
        .setCustomId("app_m1")
        .setTitle("Guild Application - Part 1")
        .addLabelComponents(questions.map(buildQuestionLabel));
}

function questionSteps(session: ApplicationSession): QuestionRow[][] {
    const asked = visibleFor(loadQuestions(session.guild_id), 1, session.content_type ?? []);
    const steps: QuestionRow[][] = [];

    for (let i = 0; i < asked.length; i += MAX_MODAL_COMPONENTS) {
        steps.push(asked.slice(i, i + MAX_MODAL_COMPONENTS));
    }

    return steps;
}

function buildStepModal(index: number, step: QuestionRow[]): ModalBuilder {
    return new ModalBuilder()
        .setCustomId(`app_step:${index}`)
        .setTitle(`Guild Application - Part ${index + 2}`)
        .addLabelComponents(step.map(buildQuestionLabel));
}

// Records one question's answer on the session: uploads go to the screenshot
// list, everything else to the answer list that ends up on the review post.
function takeAnswer(interaction: ModalSubmitInteraction, session: ApplicationSession, question: QuestionRow): void {
    const { answer, shot } = readQuestion(interaction, question);

    if (shot) session.screenshots.push(shot);
    if (!answer) return;

    session.answers = (session.answers ?? []).filter(entry => entry.field_id !== answer.field_id);
    session.answers.push(answer);

    // A few answers steer the rest of the form or the review post, so they are
    // mirrored onto the session in the shape the rest of this file expects.
    if (question.role === "content") session.content_type = [...answer.values];
    if (question.role === "ign") session.ign = answer.display;
    if (question.role === "activity") session.activity_ok = answer.values[0] ?? "";
}

function answerFor(session: ApplicationSession, field_id: string): AnswerEntry | undefined {
    return (session.answers ?? []).find(entry => entry.field_id === field_id);
}

function buildVerifyModal(questions: VerifyQuestion[]): ModalBuilder {
    return new ModalBuilder()
        .setCustomId("app_verify")
        .setTitle("Application - Last Step")
        .addTextDisplayComponents(
            new TextDisplayBuilder()
                .setContent([
                    `**Almost done. Answer these two so we know a real person filled this in.**`,
                    ``,
                    `**1.** ${questions[0]?.prompt ?? ""}`,
                    `**2.** ${questions[1]?.prompt ?? ""}`
                ].join("\n"))
        )
        .addLabelComponents(
            new LabelBuilder()
                .setLabel("Your answer to question 1")
                .setTextInputComponent(
                    new TextInputBuilder()
                        .setCustomId("app_q1")
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setMaxLength(50)
                ),
            new LabelBuilder()
                .setLabel("Your answer to question 2")
                .setTextInputComponent(
                    new TextInputBuilder()
                        .setCustomId("app_q2")
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setMaxLength(50)
                )
        );
}


export async function handleApplicationButton(interaction: ButtonInteraction, client: Client): Promise<void> {
    const [action, arg] = interaction.customId.split(":");

    switch (action) {
        case "app_start":  return startApplication(interaction);
        case "app_next":   return continueApplication(interaction, arg);
        case "app_accept": return decideApplication(interaction, client, "accepted", Number(arg));
        case "app_reject": return decideApplication(interaction, client, "rejected", Number(arg));
        case "app_dm":     return promptApplicantDM(interaction, Number(arg));
    }
}

export async function handleApplicationModal(interaction: ModalSubmitInteraction, client: Client): Promise<void> {
    const [action, arg] = interaction.customId.split(":");

    switch (action) {
        case "app_m1":     return savePart1(interaction);
        case "app_step":   return saveStep(interaction, Number(arg));
        case "app_verify": return submitApplication(interaction, client);
        case "app_dmsend": return sendApplicantDM(interaction, client, Number(arg));
    }
}


async function startApplication(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.guildId) return;

    const config = getApplicationConfig(interaction.guildId);
    if (!config) {
        await interaction.reply({ content: `Applications are not set up in this server yet. Ask an admin to run /setup-application.`, flags: MessageFlags.Ephemeral });
        return;
    }

    const open = db.get<ApplicationRow>(`SELECT * FROM applications WHERE guild_id = ? AND user_id = ? AND status = 'pending'`, interaction.guildId, interaction.user.id);
    if (open) {
        await interaction.reply({ content: `You already have application **#${open.id}** waiting with the officers. Please give them a little time.`, flags: MessageFlags.Ephemeral });
        return;
    }

    startSession(interaction.guildId, interaction.user.id);
    await interaction.showModal(buildPart1Modal(interaction.guildId));
}

async function continueApplication(interaction: ButtonInteraction, step: string | undefined): Promise<void> {
    if (!interaction.guildId) return;

    const session = getSession(interaction.guildId, interaction.user.id);
    if (!session) {
        await interaction.reply({ content: `That application timed out. Press **Start Application** again to begin a fresh one.`, flags: MessageFlags.Ephemeral });
        return;
    }

    const steps = questionSteps(session);
    const index = Number(step);

    if (Number.isInteger(index) && index >= 0 && index < steps.length) {
        await interaction.showModal(buildStepModal(index, steps[index]!));
        return;
    }

    session.verify = buildVerifyQuestions();
    await interaction.showModal(buildVerifyModal(session.verify));
}




async function replyExpired(interaction: ModalSubmitInteraction): Promise<void> {
    await interaction.reply({ content: `That application timed out before you finished it. Press **Start Application** again to begin a fresh one.`, flags: MessageFlags.Ephemeral });
}

async function replyContinue(interaction: ModalSubmitInteraction, step: string, body: string): Promise<void> {
    const container = new ContainerBuilder().setAccentColor(ACCENT_PENDING);

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
    container.addActionRowComponents(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`app_next:${step}`)
                .setLabel("Continue")
                .setEmoji("➡️")
                .setStyle(ButtonStyle.Primary)
        )
    );

    await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
}


async function savePart1(interaction: ModalSubmitInteraction): Promise<void> {
    if (!interaction.guildId) return;

    const session = getSession(interaction.guildId, interaction.user.id) ?? startSession(interaction.guildId, interaction.user.id);

    for (const question of visibleFor(loadQuestions(interaction.guildId), 0, []).slice(0, MAX_MODAL_COMPONENTS)) {
        takeAnswer(interaction, session, question);
    }

    if (!session.content_type || session.content_type.length === 0) {
        await interaction.reply({ content: `You need to pick what you are applying for. Press **Start Application** to try again.`, flags: MessageFlags.Ephemeral });
        return;
    }

    const left = questionSteps(session).reduce((sum, step) => sum + step.length, 0);

    if (left === 0) {
        session.verify = buildVerifyQuestions();
        await replyContinue(interaction, "verify", `### Part 1 saved <:coreyes:1549343042480377856>\nOne last step: two quick questions.\n\nPress **Continue** to finish.`);
        return;
    }

    await replyContinue(interaction, "0", `### Part 1 saved <:coreyes:1549343042480377856>\n${left} more question(s), including your screenshots.\n\nPress **Continue** when you are ready.`);
}


async function saveStep(interaction: ModalSubmitInteraction, index: number): Promise<void> {
    if (!interaction.guildId) return;

    const session = getSession(interaction.guildId, interaction.user.id);
    if (!session) return replyExpired(interaction);

    const steps = questionSteps(session);
    const step = steps[index];

    if (!step) {
        await interaction.reply({ content: `Something went out of step there. Press **Start Application** again to begin a fresh one.`, flags: MessageFlags.Ephemeral });
        return;
    }

    for (const question of step) {
        takeAnswer(interaction, session, question);
    }

    const next = index + 1;

    if (next < steps.length) {
        const left = steps.slice(next).reduce((sum, rest) => sum + rest.length, 0);
        await replyContinue(interaction, String(next), `### Saved <:coreyes:1549343042480377856>\n${left} more question(s) to go.\n\nPress **Continue** to carry on.`);
        return;
    }

    await replyContinue(interaction, "verify", `### Saved <:coreyes:1549343042480377856>\nOne last step: two quick questions.\n\nPress **Continue** to finish.`);
}


async function submitApplication(interaction: ModalSubmitInteraction, client: Client): Promise<void> {
    if (!interaction.guildId) return;

    // Re-uploading the screenshots takes longer than the three second window.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const session = getSession(interaction.guildId, interaction.user.id);
    if (!session) {
        await interaction.editReply({ content: `That application timed out before you finished it. Press **Start Application** again to begin a fresh one.` });
        return;
    }

    const config = getApplicationConfig(interaction.guildId);
    if (!config) {
        await interaction.editReply({ content: `Applications are no longer set up in this server. Please tell an admin.` });
        return;
    }

    const questions = session.verify ?? [];
    const given = [interaction.fields.getTextInputValue("app_q1"), interaction.fields.getTextInputValue("app_q2")];

    const results = questions.map((question, i) => ({ question, given: given[i] ?? "", ok: checkAnswer(question, given[i] ?? "") }));
    const verify_passed = results.length > 0 && results.every(r => r.ok);
    const verify_log = results.map(r => `${r.ok ? "<:coreyes:1549343042480377856>" : "❌"} ${r.question.prompt}\n> they answered: ${r.given || "(blank)"}`).join("\n");

    const result = db.run(
        `INSERT INTO applications (guild_id, user_id, username, ign, player_type, content_type, path_build, weapons, activity_ok, about, previous_guild, pve_rank, screenshots, verify_passed, verify_log, answers, status, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        interaction.guildId,
        interaction.user.id,
        interaction.user.tag,
        session.ign || "Unknown",
        answerFor(session, "app_player_type")?.values[0] ?? "",
        (session.content_type ?? []).join(","),
        answerFor(session, "app_path")?.values.join(",") || null,
        answerFor(session, "app_weapons")?.values.join(",") || null,
        session.activity_ok ?? "",
        answerFor(session, "app_about")?.display ?? "",
        answerFor(session, "app_previous_guild")?.display ?? null,
        answerFor(session, "app_pve_rank")?.display ?? null,
        JSON.stringify(session.screenshots),
        verify_passed ? 1 : 0,
        verify_log,
        JSON.stringify(session.answers ?? []),
        Date.now()
    );

    sessions.delete(sessionKey(interaction.guildId, interaction.user.id));

    const row = db.get<ApplicationRow>(`SELECT * FROM applications WHERE id = ?`, result.lastID);
    if (row) {
        await postReview(client, config, row).catch(err => console.error(`Failed to post application #${row.id}:`, err));
    }

    await interaction.editReply({
        content: [
            `### Application sent <:coreyes:1549343042480377856>`,
            `Thanks ${interaction.user.username}, application **#${result.lastID}** is with the officers now.`,
            verify_passed ? `` : `You missed one of the two check questions, so they may ask you about it.`,
            `You will get a DM from me as soon as they decide.`
        ].filter(Boolean).join("\n")
    });
}


interface ShotGroup {
    label: string;
    urls: string[];
}

interface PreparedShot {
    label: string;
    name: string;
    file: AttachmentBuilder;
}

// Every screenshot gets a stable filename, worked out the same way each time
// the review post is rebuilt, because the galleries point at them by name.
function prepareShots(shots: ApplicationShot[]): PreparedShot[] {
    const prepared: PreparedShot[] = [];

    for (const shot of shots) {
        for (const url of shot.urls) {
            const base = url.split("?")[0].split("/").pop() ?? "screenshot.png";
            const name = `${prepared.length + 1}-${base.replace(/[^a-z0-9._-]/gi, "_")}`;

            prepared.push({ label: shot.label, name, file: new AttachmentBuilder(url, { name }) });
        }
    }

    return prepared;
}

// Runs of screenshots that answer the same question become one gallery under
// that heading.
function groupShots(prepared: PreparedShot[]): ShotGroup[] {
    const groups: ShotGroup[] = [];

    for (const shot of prepared) {
        const last = groups.at(-1);
        const url = `attachment://${shot.name}`;

        if (last?.label === shot.label) last.urls.push(url);
        else groups.push({ label: shot.label, urls: [url] });
    }

    return groups;
}

// The same galleries, pointing at the applicant's own uploads instead of files
// we re-hosted. Used when re-uploading fails so the officers still see the
// pictures, at the cost of those links dying after about a day.
function groupLinks(shots: ApplicationShot[], limit: number): ShotGroup[] {
    const groups: ShotGroup[] = [];
    let taken = 0;

    for (const shot of shots) {
        const urls = shot.urls.slice(0, Math.max(0, limit - taken));
        if (urls.length === 0) break;

        taken += urls.length;
        groups.push({ label: shot.label, urls });
    }

    return groups;
}


// How the screenshots ended up on the review post, so rebuilding it later does
// not have to guess. Reading the attachments back off the message is not
// dependable, and getting it wrong wipes them.
const SHOTS_NONE = 0;
const SHOTS_ATTACHED = 1;
const SHOTS_LINKED = 2;


async function postReview(client: Client, config: ApplicationConfigRow, row: ApplicationRow): Promise<void> {
    const channel = await resolveSendable(client, config.review_channel_id);
    if (!channel) {
        console.warn(`Review channel ${config.review_channel_id} is not reachable for application #${row.id}`);
        return;
    }

    const shots: ApplicationShot[] = JSON.parse(row.screenshots);
    const prepared = prepareShots(shots);

    // A message takes ten attachments, and the four questions together can ask
    // for more than that. The first ten sit in the review post itself and the
    // remainder follow underneath rather than being thrown away.
    const inline = prepared.slice(0, MAX_ATTACHMENTS);
    const overflow = prepared.slice(MAX_ATTACHMENTS);

    // Re-hosting the images outlives the upload links Discord handed us, which
    // expire after about a day. Big files on a slow box can take longer than
    // the REST timeout though, so a failure here drops to a gallery built from
    // the applicant's own links: still pictures in front of the officers, just
    // ones that stop working after a day.
    let mode = SHOTS_NONE;

    let review_msg = inline.length === 0 ? null : await channel
        .send({
            components: [buildReviewContainer(row, groupShots(inline), overflow.length)],
            files: inline.map(shot => shot.file),
            flags: MessageFlags.IsComponentsV2
        })
        .catch(err => {
            console.error(`Failed to attach screenshots to application #${row.id}:`, err);
            return null;
        });

    if (review_msg) {
        mode = SHOTS_ATTACHED;
    } else if (inline.length > 0) {
        review_msg = await channel
            .send({
                components: [buildReviewContainer(row, groupLinks(shots, MAX_ATTACHMENTS), 0, true)],
                flags: MessageFlags.IsComponentsV2
            })
            .catch(err => {
                console.error(`Failed to post application #${row.id} with linked screenshots:`, err);
                return null;
            });

        if (review_msg) mode = SHOTS_LINKED;
    }

    // Last resort: the application still has to reach the officers even if no
    // version of the pictures will go up.
    if (!review_msg) {
        review_msg = await channel.send({ components: [buildReviewContainer(row, [], 0)], flags: MessageFlags.IsComponentsV2 });

        if (shots.length > 0) {
            const links = shots.map(s => `**${s.label}**\n${s.urls.join("\n")}`).join("\n\n");
            await channel.send({ content: `Screenshots for **#${row.id}**, these links expire about a day after they were sent:\n\n${links}`.slice(0, 2000) }).catch(() => {});
        }
    }

    await db.run(`UPDATE applications SET review_msg_id = ?, shots_inline = ? WHERE id = ?`, review_msg.id, mode, row.id);

    if (mode !== SHOTS_ATTACHED) return;

    for (let i = 0; i < overflow.length; i += MAX_ATTACHMENTS) {
        const batch = overflow.slice(i, i + MAX_ATTACHMENTS);
        const labels = [...new Set(batch.map(shot => shot.label))].join(", ");

        await channel.send({
            content: `📎 More screenshots for **#${row.id}** - ${labels}`,
            files: batch.map(shot => shot.file)
        }).catch(err => console.error(`Failed to post extra screenshots for application #${row.id}:`, err));
    }
}


// A components v2 message carries at most 4000 characters across every text
// component it holds, and quoting an answer adds two characters per newline.
// A rambling application should never be the reason the review post fails to
// go out, so runs of blank lines are collapsed and the result is capped. The
// untouched answer always stays in the database.
function quote(text: string, limit: number): string {
    const tidy = text.replace(/\n{3,}/g, "\n\n").trim();
    const body = tidy.length > limit ? `${tidy.slice(0, limit)}…` : tidy;
    const rendered = `> ${body.replace(/\n/g, "\n> ")}`;

    return rendered.length > limit ? `${rendered.slice(0, limit)}…` : rendered;
}


// The questions shown here come from whatever the guild asked at the time, so
// the answers are read back from the row rather than from a fixed list. The
// summary block at the top already covers the roles, and screenshots have
// their own section. Applications taken before answers were stored fall back
// to the typed columns.
const SUMMARISED_FIELDS = new Set(["app_player_type", "app_content", "app_activity", "app_ign"]);

function detailBlocks(row: ApplicationRow, weapons: string[], paths: string[]): string[] {
    let answers: AnswerEntry[] = [];

    try {
        answers = row.answers ? JSON.parse(row.answers) : [];
    } catch {
        console.error(`Application #${row.id} has unreadable answers`);
    }

    if (answers.length > 0) {
        return answers
            .filter(answer => !SUMMARISED_FIELDS.has(answer.field_id) && answer.display)
            .map(answer => answer.type === "text"
                ? `**${answer.label}**\n${quote(answer.display, 1200)}`
                : `**${answer.label}**\n${answer.display}`);
    }

    const blocks: string[] = [];
    const build_lines: string[] = [];

    if (weapons.length > 0) build_lines.push(`**Weapon combination**\n${labelsOf(WEAPONS, weapons)}`);
    if (paths.length > 0) build_lines.push(`**Path build${paths.length > 1 ? "s" : ""}**\n${labelsOf(PATH_BUILDS, paths)}`);
    if (row.pve_rank) build_lines.push(`**PvE speedrun ranks**\n${quote(row.pve_rank, 700)}`);

    if (build_lines.length > 0) blocks.push(build_lines.join("\n\n"));
    if (row.about) blocks.push(`**About them**\n${quote(row.about, 1200)}`);
    if (row.previous_guild) blocks.push(`**Guilds before this one**\n${quote(row.previous_guild, 600)}`);

    return blocks;
}


function buildReviewContainer(row: ApplicationRow, groups: ShotGroup[], overflow = 0, expiring = false): ContainerBuilder {
    const shots: ApplicationShot[] = JSON.parse(row.screenshots);
    const content = row.content_type.split(",").filter(Boolean);
    const weapons = (row.weapons ?? "").split(",").filter(Boolean);
    const paths = (row.path_build ?? "").split(",").filter(Boolean);
    const decided = row.status !== "pending";

    const container = new ContainerBuilder().setAccentColor(
        row.status === "accepted" ? ACCENT_ACCEPTED
            : row.status === "rejected" ? ACCENT_REJECTED
                : ACCENT_PENDING
    );

    const divider = () => container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );

    const heading = row.status === "accepted" ? "<:coreyes:1549343042480377856> Accepted"
        : row.status === "rejected" ? "⛔ Rejected"
            : "📝 New application";

    const sent_at = Math.floor(row.submitted_at / 1000);

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent([
            `# ${heading}`,
            `## ${row.ign}`,
            `<@${row.user_id}> · \`${row.username}\``,
            `-# Application #${row.id} · sent <t:${sent_at}:R> · <t:${sent_at}:f>`
        ].join("\n"))
    );

    divider();

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent([
            `**Applying for**`,
            labelsOf(CONTENT_TYPES, content),
            ``,
            `**Player type**`,
            labelOf(PLAYER_TYPES, row.player_type),
            ``,
            `**3k weekly activity**`,
            row.activity_ok === "yes" ? `<:coreyes:1549343042480377856> Yes` : `🚫 **No, they said they cannot meet it**`
        ].join("\n"))
    );

    for (const block of detailBlocks(row, weapons, paths)) {
        divider();
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(block));
    }

    if (groups.length > 0) {
        divider();
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**📸 Screenshots**`));

        for (const group of groups) {
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${group.label}**`));
            container.addMediaGalleryComponents(
                new MediaGalleryBuilder().addItems(
                    group.urls.map(url => new MediaGalleryItemBuilder().setURL(url).setDescription(group.label))
                )
            );
        }

        if (overflow > 0) {
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`-# ${overflow} more screenshot(s) posted below this.`)
            );
        }

        if (expiring) {
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`-# I could not re-host these, so they are the applicant's own uploads and stop loading about a day after they were sent. Save anything you want to keep.`)
            );
        }
    } else if (shots.length > 0) {
        divider();
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`**📸 Screenshots**\nI could not attach these, the links are in the message below.`)
        );
    }

    // A passing check says nothing an officer needs, so it stays off the post
    // entirely. Only a failure is worth the space, and only then are the
    // questions shown so they can see what the applicant got wrong.
    const footer: string[] = [];

    if (!row.verify_passed) {
        footer.push(`⚠️ **Human check failed**`);
        // The log already carries its own quoting, so it is only length capped.
        footer.push(row.verify_log.length > 900 ? `${row.verify_log.slice(0, 900)}…` : row.verify_log);
    }

    if (row.handled_by) footer.push(`-# Handled by <@${row.handled_by}>`);

    if (footer.length > 0) {
        divider();
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(footer.join("\n")));
    }

    container.addActionRowComponents(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`app_accept:${row.id}`).setLabel("Accept").setEmoji("✅").setStyle(ButtonStyle.Success).setDisabled(decided),
            new ButtonBuilder().setCustomId(`app_reject:${row.id}`).setLabel("Reject").setEmoji("⛔").setStyle(ButtonStyle.Danger).setDisabled(decided),
            new ButtonBuilder().setCustomId(`app_dm:${row.id}`).setLabel("Message them").setEmoji("✉️").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setLabel("Open DM").setEmoji("💬").setStyle(ButtonStyle.Link).setURL(`https://discord.com/users/${row.user_id}`)
        )
    );

    return container;
}


// Officers reach these checks from the review buttons and from the modal they
// type a message into, so both interaction shapes have to be accepted.
type ReviewInteraction = ButtonInteraction | ModalSubmitInteraction;

function canReview(interaction: ReviewInteraction, config: ApplicationConfigRow): boolean {
    if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
    if (!config.reviewer_role_id) return false;

    const roles = interaction.member?.roles;
    if (!roles) return false;

    return Array.isArray(roles) ? roles.includes(config.reviewer_role_id) : roles.cache.has(config.reviewer_role_id);
}

async function loadReviewable(interaction: ReviewInteraction, id: number): Promise<{ config: ApplicationConfigRow; row: ApplicationRow } | null> {
    if (!interaction.guildId) return null;

    const config = getApplicationConfig(interaction.guildId);
    if (!config) {
        await interaction.reply({ content: `Applications are not set up in this server.`, flags: MessageFlags.Ephemeral });
        return null;
    }

    if (!canReview(interaction, config)) {
        await interaction.reply({ content: `Only officers can use these buttons.`, flags: MessageFlags.Ephemeral });
        return null;
    }

    const row = db.get<ApplicationRow>(`SELECT * FROM applications WHERE id = ? AND guild_id = ?`, id, interaction.guildId);
    if (!row) {
        await interaction.reply({ content: `Application #${id} is no longer in the database.`, flags: MessageFlags.Ephemeral });
        return null;
    }

    return { config, row };
}


async function decideApplication(interaction: ButtonInteraction, client: Client, status: "accepted" | "rejected", id: number): Promise<void> {
    const found = await loadReviewable(interaction, id);
    if (!found) return;

    const { config, row } = found;

    if (row.status !== "pending") {
        await interaction.reply({ content: `Application **#${row.id}** was already **${row.status}**${row.handled_by ? ` by <@${row.handled_by}>` : ""}.`, flags: MessageFlags.Ephemeral });
        return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    db.run(`UPDATE applications SET status = ?, handled_by = ? WHERE id = ?`, status, interaction.user.id, row.id);
    const updated: ApplicationRow = { ...row, status, handled_by: interaction.user.id };

    const notes: string[] = [];

    if (status === "accepted" && config.accepted_role_id) {
        const member = await interaction.guild?.members.fetch(row.user_id).catch(() => null);

        if (!member) {
            notes.push(`They have left the server, so no role was given.`);
        } else {
            await member.roles.add(config.accepted_role_id)
                .then(() => notes.push(`Gave them <@&${config.accepted_role_id}>.`))
                .catch(() => notes.push(`Could not give them <@&${config.accepted_role_id}> - check that my role sits above it.`));
        }
    }

    const dm_text = status === "accepted"
        ? `🎉 Your application to **${interaction.guild?.name}** was accepted. Welcome aboard!\nGuild ID: \`\`\`\n10018428\n\`\`\``
        : `Thanks for applying to **${interaction.guild?.name}**. The officers have decided not to take your application further this time.`;

    const dm_sent = await client.users.fetch(row.user_id)
        .then(user => user.send(dm_text))
        .then(() => true)
        .catch(() => false);

    if (!dm_sent) notes.push(`Could not DM them, their DMs are closed.`);

    if (interaction.message.editable) {
        // The gallery points at the images by filename, so the post keeps the
        // attachments it already has and is rebuilt around them. If the
        // original upload had failed there is nothing to point at.
        const shots: ApplicationShot[] = JSON.parse(row.screenshots);
        const prepared = row.shots_inline === SHOTS_ATTACHED ? prepareShots(shots) : [];
        const inline = prepared.slice(0, MAX_ATTACHMENTS);

        const groups = row.shots_inline === SHOTS_LINKED
            ? groupLinks(shots, MAX_ATTACHMENTS)
            : groupShots(inline);

        // attachments is deliberately left out. Sending it replaces the files
        // on the message, and an empty array deletes them outright, which is
        // what used to wipe the screenshots the moment someone hit Accept.
        await interaction.message.edit({
            components: [buildReviewContainer(updated, groups, prepared.length - inline.length, row.shots_inline === SHOTS_LINKED)],
            flags: MessageFlags.IsComponentsV2
        }).catch(err => console.error(`Failed to update the review post for application #${row.id}:`, err));
    }

    await interaction.editReply({ content: [`Application **#${row.id}** is now **${status}**.`, ...notes].join("\n") });
}

function buildApplicantDMContainer(text: string, officer_name: string, officer_id: string, app_id: number, guild_name: string): ContainerBuilder {
    const container = new ContainerBuilder().setAccentColor(ACCENT_PENDING);

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`### About your application to ${guild_name}`)
    );

    container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(quote(text, 1600)));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# Sent by ${officer_name} about application #${app_id}. I cannot carry your reply back, so answer them with the button below.`)
    );

    container.addActionRowComponents(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setLabel(`Reply to ${officer_name}`.slice(0, 80))
                .setEmoji("💬")
                .setStyle(ButtonStyle.Link)
                .setURL(`https://discord.com/users/${officer_id}`)
        )
    );

    return container;
}


// The officers asked for a straight line to the applicant rather than a
// thread, so this pairs with the Open DM link button: type a message here and
// I hand it to them, signed, with a button back to whoever wrote it.
async function promptApplicantDM(interaction: ButtonInteraction, id: number): Promise<void> {
    const found = await loadReviewable(interaction, id);
    if (!found) return;

    const { row } = found;

    await interaction.showModal(
        new ModalBuilder()
            .setCustomId(`app_dmsend:${row.id}`)
            .setTitle(`Message ${row.ign}`.slice(0, 45))
            .addTextDisplayComponents(
                new TextDisplayBuilder()
                    .setContent(`This goes straight to <@${row.user_id}> as a direct message from me, signed with your name.`)
            )
            .addLabelComponents(
                new LabelBuilder()
                    .setLabel("What should I tell them?")
                    .setDescription("They get a button to answer you directly, so keep it short and say who you are.")
                    .setTextInputComponent(
                        new TextInputBuilder()
                            .setCustomId("app_dm_text")
                            .setStyle(TextInputStyle.Paragraph)
                            .setPlaceholder("e.g. Hey! Could you send a clearer screenshot of your innerways?")
                            .setRequired(true)
                            .setMinLength(5)
                            .setMaxLength(1500)
                    )
            )
    );
}

async function sendApplicantDM(interaction: ModalSubmitInteraction, client: Client, id: number): Promise<void> {
    const found = await loadReviewable(interaction, id);
    if (!found) return;

    const { row } = found;
    const text = interaction.fields.getTextInputValue("app_dm_text").trim();

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const container = buildApplicantDMContainer(text, interaction.user.username, interaction.user.id, row.id, interaction.guild?.name ?? "the guild");

    const user = await client.users.fetch(row.user_id).catch(() => null);
    const sent = user
        ? await user.send({ components: [container], flags: MessageFlags.IsComponentsV2 }).then(() => true).catch(() => false)
        : false;

    if (!sent) {
        await interaction.editReply({ content: `I could not DM <@${row.user_id}>. Their DMs are closed, so you will have to catch them another way.` });
        return;
    }

    await interaction.editReply({ content: `Sent to <@${row.user_id}>. Their reply goes straight to you, not to me.` });
}
