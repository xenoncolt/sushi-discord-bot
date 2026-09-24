import { Client, cleanContent, Events, Message } from "discord.js";
import { askMissChief, checkCooldown, isAiBusy, isAiChannel, isAiEnabled } from "../../utils/aiChat.js";

// Everything here leans on the privileged MessageContent intent (see index.ts):
// without it Discord blanks the text of any message that doesn't ping her, so
// neither the name trigger nor the channel history below would see a word.

// "miss chief", "misschief", "Miss-Chief". Deliberately not "mischief", which
// is an ordinary word people use without meaning her.
const NAME_CALL = /\bmiss[\s_-]*chief\b/i;

// Checked against the raw text as well as mentions.everyone, because the flag
// is only set when the author actually had permission to ping everybody.
const MASS_PING = /@(everyone|here)\b/i;

// How much of the channel she reads before answering. Every line is paid for in
// tokens on every reply, so this is kept to the bare minimum that still shows
// what the conversation is about - the last few messages carry the topic, and
// anything older than the age cutoff is usually a different conversation.
const HISTORY_MESSAGES = 5;
const HISTORY_MAX_AGE_MS = 15 * 60 * 1000;
const HISTORY_LINE_CHARS = 120;

const BOT_NAME = "Miss Chief";

// Said when somebody pings her with nothing attached. Answering these locally
// keeps idle pings off the free-tier quota entirely.
const EMPTY_PINGS = [
    "You rang, darling? Try adding a question next time.",
    "Mm? Use your words, pet.",
    "A ping with no question. How very brave of you."
];

// Said when somebody only calls her by name while she is busy or they are on
// cooldown. Pings get the blunter notices below; these are gentler, since the
// person may not have been waiting on an answer at all.
const SLEEPING = [
    "Shh, darling... mommy is sleeping. Whisper my name again later.",
    "Mommy's having her beauty sleep, pet. Dream of me and try again soon.",
    "Not now, sweetheart. Demon's curled up in bed. Come back in a bit.",
    "Mm... five more minutes, darling. Mommy's resting her horns.",
    "Hush, pet. Demon's napping. Call me again when I've had my rest."
];

export default {
    name: Events.MessageCreate,
    once: false,
    async execute(message: Message, client: Client) {
        if (!isAiEnabled()) return;
        if (message.author.bot || message.system) return;
        if (!message.inGuild() || !client.user) return;
        if (!isAiChannel(message.channelId)) return;

        // A mass ping is an announcement, not a question for her, even when she
        // happens to be tagged or named in it too.
        if (message.mentions.everyone || MASS_PING.test(message.content)) return;

        // ignoreRepliedUser matters here: replying to someone with the ping on
        // puts them in mentions.users, so without it she would answer every
        // reply to one of her own messages and talk to herself.
        const mentioned = message.mentions.has(client.user, {
            ignoreEveryone: true,
            ignoreRoles: true,
            ignoreRepliedUser: true
        });

        const answering_reply = message.mentions.repliedUser?.id === client.user.id;

        // Pinging her or replying to her is aimed squarely at her, so those get
        // the blunt "wait your turn" notices. Just saying her name gets the
        // sleepy ones instead.
        const direct = mentioned || answering_reply;

        if (!direct && !NAME_CALL.test(message.content)) return;
        if (!message.channel.isSendable()) return;

        const bot_ping = new RegExp(`<@!?${client.user.id}>`, "g");
        const question = readable(message.content.replace(bot_ping, " "), message);

        // Her name stays in the question - "what do you think, miss chief" reads
        // fine to the model - it only has to go for the emptiness check.
        if (!question.replace(NAME_CALL, "").replace(/[\s\p{P}\p{S}]/gu, "")) {
            await reply(message, pick(EMPTY_PINGS));
            return;
        }

        // Busy is checked first on purpose: asking consumes the cooldown slot,
        // and being turned away for someone else's question should not cost the
        // asker their next fifteen seconds.
        if (isAiBusy()) {
            await reply(message, direct ? "I'm busy tormenting someone else. Ask again in a moment." : pick(SLEEPING));
            return;
        }

        const wait = checkCooldown(message.author.id);
        if (wait > 0) {
            await reply(message, direct ? `Patience, pet. ${wait}s.` : pick(SLEEPING));
            return;
        }

        // Purely cosmetic, and it expires on its own after ten seconds, so a
        // failure here should never stop the actual answer.
        await message.channel.sendTyping().catch(() => {});

        const { context, replying_to } = await readHistory(message, client.user.id);

        let author = message.member?.displayName ?? message.author.displayName;
        if (replying_to) author += ` (replying to ${replying_to})`;

        const answer = await askMissChief(author, question, context);

        await reply(message, answer);
    }
};

// The last few messages before this one, oldest first, as "Name: text" lines.
// Her own earlier answers are in here too, which is what lets a follow-up like
// "why?" make sense. Any failure just means she answers without the backstory.
async function readHistory(message: Message<true>, bot_id: string): Promise<{ context: string[]; replying_to?: string }> {
    let recent: Message<true>[] = [];

    try {
        const fetched = await message.channel.messages.fetch({ limit: HISTORY_MESSAGES, before: message.id });
        recent = [...fetched.values()]
            .filter(m => message.createdTimestamp - m.createdTimestamp <= HISTORY_MAX_AGE_MS)
            .reverse();
    } catch (err) {
        console.error("Failed to read channel history for AI reply:", err);
    }

    // "is this true, miss chief?" means nothing without the message it points
    // at, which can be older than the window above. It rides along with the
    // question rather than in the context, because the context is trimmed from
    // the oldest end and this is the one line that must never be cut.
    const ref_id = message.reference?.messageId;
    let replied: Message<true> | undefined;

    if (ref_id) {
        replied = recent.find(m => m.id === ref_id)
            ?? await message.fetchReference().catch(() => undefined) as Message<true> | undefined;
    }

    // Other bots are mostly level-up spam and embeds, so only her own lines make
    // the context - unless someone replied to one, which makes it the topic.
    const context = recent
        .filter(m => m !== replied && !m.system && (!m.author.bot || m.author.id === bot_id))
        .map(m => historyLine(m, bot_id))
        .filter((line): line is string => line !== null);

    return {
        context,
        replying_to: replied ? historyLine(replied, bot_id) ?? speaker(replied, bot_id) : undefined
    };
}

// "Name: text", or null when there is nothing readable in the message.
function historyLine(m: Message<true>, bot_id: string): string | null {
    let text = readable(m.content, m);

    if (!text) {
        if (m.attachments.size > 0) text = "[sent an attachment]";
        else if (m.stickers.size > 0) text = "[sent a sticker]";
        else return null;
    }

    if (text.length > HISTORY_LINE_CHARS) text = text.slice(0, HISTORY_LINE_CHARS).trimEnd() + "...";

    return `${speaker(m, bot_id)}: ${text}`;
}

function speaker(m: Message<true>, bot_id: string): string {
    if (m.author.id === bot_id) return BOT_NAME;

    return m.member?.displayName ?? m.author.displayName;
}

function pick(lines: string[]): string {
    return lines[Math.floor(Math.random() * lines.length)];
}

// Turns user, role and channel mentions into plain names and custom emoji into
// :name:, so the model never sees raw snowflake ids.
function readable(text: string, message: Message<true>): string {
    return cleanContent(text, message.channel)
        .replace(/\s+/g, " ")
        .trim();
}

// parse: [] is the hard stop on the bot ever pinging a role or the whole guild,
// whatever the model decides to write. repliedUser keeps the asker notified.
async function reply(message: Message, content: string): Promise<void> {
    try {
        await message.reply({
            content,
            allowedMentions: { parse: [], repliedUser: true }
        });
    } catch (err) {
        console.error("Failed to send AI reply:", err);
    }
}
