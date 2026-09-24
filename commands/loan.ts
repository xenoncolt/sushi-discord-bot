import { ActionRowBuilder, ApplicationCommandOptionType, ButtonInteraction, ButtonStyle, ChatInputCommandInteraction, ContainerBuilder, MessageFlags, ModalBuilder, ModalSubmitInteraction, TextInputBuilder, TextInputStyle } from "discord.js";
import { Command } from "../types/Command.js";
import { button, parseBet, row } from "../games/common.js";
import { Loan, MAX_INTEREST_PCT, MAX_TERM_MS, MIN_TERM_MS, OFFER_MS, REQUEST_MS, acceptLoan, afterRepay, closeOffer, createOffer, createRequest, formatTerm, getLoan, loanCard, nextOwed, openLoans, openRequest, overdueDebt, owed, parseInterest, parseTerm, repaidCard, repayNow, responderOf, setLoanMessage, setTerms } from "../leveling/loans.js";
import { getMember } from "../leveling/members.js";
import { getSettings } from "../leveling/settings.js";
import { COLOR, fmt, sep, text } from "../leveling/ui.js";
import { afterLevelChange, profileOf } from "../leveling/xp.js";

function offerButtons(loan: Loan) {
    return row(
        button(`loan:${loan.id}:accept`, "Accept loan", ButtonStyle.Success, "✅"),
        button(`loan:${loan.id}:decline`, "Decline", ButtonStyle.Danger, "✖️")
    );
}

// On a request it's the lender's move: they write the terms, or say no.
function requestButtons(loan: Loan) {
    return row(
        button(`loan:${loan.id}:terms`, "Set terms", ButtonStyle.Success, "📝"),
        button(`loan:${loan.id}:decline`, "Decline", ButtonStyle.Danger, "✖️")
    );
}

// The card, plus whatever the person who has to answer can press.
function offerView(loan: Loan, note?: string): ContainerBuilder {
    const card = loanCard(loan, note);
    if (loan.status === "pending") card.addActionRowComponents(offerButtons(loan));
    else if (loan.status === "requested") card.addActionRowComponents(requestButtons(loan));
    return card;
}

// What the lender fills in to turn a request into an offer.
function termsModal(loan: Loan, xp_name: string): ModalBuilder {
    const amount = new TextInputBuilder()
        .setCustomId("amount")
        // Prefilled with what they asked for, so the usual answer is one tap.
        .setLabel("How much to lend (or 5k, half, all)")
        .setPlaceholder(`They asked for ${fmt(loan.amount)} ${xp_name}`.slice(0, 100))
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(20)
        .setValue(String(loan.amount));

    const interest = new TextInputBuilder()
        .setCustomId("interest")
        .setLabel("Interest they pay on top")
        .setPlaceholder("10%   ·   250   ·   0 for none")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(20);

    const time = new TextInputBuilder()
        .setCustomId("time")
        .setLabel("How long they have to pay it back")
        .setPlaceholder("30m   ·   12h   ·   3d   ·   1w   ·   1d12h")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(30);

    return new ModalBuilder()
        .setCustomId(`loan:${loan.id}:terms`)
        .setTitle("Your loan terms")
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(amount),
            new ActionRowBuilder<TextInputBuilder>().addComponents(interest),
            new ActionRowBuilder<TextInputBuilder>().addComponents(time)
        );
}

interface Terms {
    interest: number;
    pct: number | null;
    duration_ms: number;
}

// Everything /loan give checks about the terms and the lender, shared with
// the modal. Returns the terms, or the reason they don't work.
function checkTerms(guild_id: string, lender_id: string, amount: number, interest_input: string, time_input: string, xp_name: string): Terms | string {
    const term = parseTerm(time_input);
    if (term === null) return `I couldn't read **${time_input}** as a time. Use something like \`30m\`, \`12h\`, \`3d\`, \`1w\` or \`1d12h\`.`;
    if (term < MIN_TERM_MS || term > MAX_TERM_MS) return `The time has to be between **${formatTerm(MIN_TERM_MS)}** and **${formatTerm(MAX_TERM_MS)}**.`;

    const parsed = parseInterest(interest_input, amount);
    if (parsed === null) return `I couldn't read **${interest_input}** as interest. Use a percent like \`10%\` or a flat amount like \`100\` (\`0\` for none).`;
    if (parsed.interest > amount * MAX_INTEREST_PCT / 100) return `Interest can be at most ${MAX_INTEREST_PCT}% of the loan (**${fmt(amount * MAX_INTEREST_PCT / 100)} ${xp_name}** here).`;

    const balance = getMember(guild_id, lender_id).xp;
    if (amount > balance) return `You only have **${fmt(balance)} ${xp_name}**.`;
    const debt = overdueDebt(guild_id, lender_id);
    if (debt > 0) return `You have an overdue loan to pay back first (**${fmt(debt)} ${xp_name}**). You can lend again once it's paid.`;

    return { interest: parsed.interest, pct: parsed.pct, duration_ms: term };
}

async function ephemeral(interaction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction, content: string): Promise<void> {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }).catch(() => {});
}

function listLine(loan: Loan, me: string, xp_name: string): string {
    const total = fmt(owed(loan));
    if (loan.status === "requested") {
        const other = loan.borrower_id === me ? `to <@${loan.lender_id}>` : `from <@${loan.borrower_id}>`;
        return `• 🙏 Request ${other}: asking for ${fmt(loan.amount)} · waiting on terms · expires <t:${Math.floor((loan.created_at + REQUEST_MS) / 1000)}:R>`;
    }
    if (loan.status === "pending") {
        const other = loan.lender_id === me ? `to <@${loan.borrower_id}>` : `from <@${loan.lender_id}>`;
        return `• ✉️ Offer ${other}: ${fmt(loan.amount)} → pays back ${total} · expires <t:${Math.floor((loan.created_at + OFFER_MS) / 1000)}:R>`;
    }
    const late = loan.due_at! <= Date.now();
    const when = late ? `⚠️ **overdue** since <t:${Math.floor(loan.due_at! / 1000)}:R>` : `due <t:${Math.floor(loan.due_at! / 1000)}:R>`;
    return loan.borrower_id === me
        ? `• **${total} ${xp_name}** to <@${loan.lender_id}> (borrowed ${fmt(loan.amount)}) · ${when}`
        : `• <@${loan.borrower_id}> owes **${total} ${xp_name}** (lent ${fmt(loan.amount)}) · ${when}`;
}

export default {
    name: "loan",
    description: "Lend EXP with interest, or ask someone for a loan",
    options: [
        {
            name: "give",
            description: "Offer someone a loan (they have to accept it)",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "user",
                    description: "Who borrows the EXP",
                    type: ApplicationCommandOptionType.User,
                    required: true
                },
                {
                    name: "amount",
                    description: "How much to lend",
                    type: ApplicationCommandOptionType.Integer,
                    required: true,
                    min_value: 1
                },
                {
                    name: "interest",
                    description: "Extra they pay back: a percent like 10% or a flat amount like 100 (0 = none)",
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    max_length: 20
                },
                {
                    name: "time",
                    description: "When the bot collects it back: 30m, 12h, 3d, 1w, 1d12h…",
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    max_length: 30
                }
            ]
        },
        {
            name: "ask",
            description: "Ask someone for a loan (they set the terms, then you accept)",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "user",
                    description: "Who you're asking to lend you the EXP",
                    type: ApplicationCommandOptionType.User,
                    required: true
                },
                {
                    name: "amount",
                    description: "How much you're asking for",
                    type: ApplicationCommandOptionType.Integer,
                    required: true,
                    min_value: 1
                }
            ]
        },
        {
            name: "repay",
            description: "Pay a loan back early (costs the same as on the due date)",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "lender",
                    description: "Who to pay back (default: the loan that's due first)",
                    type: ApplicationCommandOptionType.User,
                    required: false
                }
            ]
        },
        {
            name: "list",
            description: "See the loans you owe and the ones owed to you",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: "user",
                    description: "Whose loans to show",
                    type: ApplicationCommandOptionType.User,
                    required: false
                }
            ]
        }
    ],
    cooldown: 3,
    async execute(interaction) {
        if (!interaction.inCachedGuild()) {
            await ephemeral(interaction, "This only works inside a server.");
            return;
        }
        const s = getSettings(interaction.guildId).server;
        const sub = interaction.options.getSubcommand();

        if (sub === "list") {
            const user = interaction.options.getUser("user") ?? interaction.user;
            const loans = openLoans(interaction.guildId, user.id);
            const owes = loans.filter(l => l.status === "active" && l.borrower_id === user.id);
            const owed_to = loans.filter(l => l.status === "active" && l.lender_id === user.id);
            const offers = loans.filter(l => l.status === "pending" || l.status === "requested");
            const sum = (list: Loan[]) => fmt(list.reduce((a, l) => a + owed(l), 0));

            const container = new ContainerBuilder()
                .setAccentColor(COLOR.info)
                .addTextDisplayComponents(text(`### 🏦 Loans\n<@${user.id}>`));
            container.addSeparatorComponents(sep());
            container.addTextDisplayComponents(text([
                `**📥 Owes** · ${sum(owes)} ${s.xp_name}`,
                owes.length ? owes.map(l => listLine(l, user.id, s.xp_name)).join("\n") : "*Nothing.*",
                "",
                `**📤 Is owed** · ${sum(owed_to)} ${s.xp_name}`,
                owed_to.length ? owed_to.map(l => listLine(l, user.id, s.xp_name)).join("\n") : "*Nothing.*",
                ...(offers.length ? ["", `**✉️ Open offers and requests**`, offers.map(l => listLine(l, user.id, s.xp_name)).join("\n")] : [])
            ].join("\n").slice(0, 3900)));
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
            return;
        }

        if (sub === "repay") {
            const lender = interaction.options.getUser("lender");
            const loan = nextOwed(interaction.guildId, interaction.user.id, lender?.id);
            if (!loan) {
                await ephemeral(interaction, lender ? `You don't owe <@${lender.id}> anything.` : "You don't owe anyone anything.");
                return;
            }
            const total = owed(loan);
            const balance = getMember(interaction.guildId, interaction.user.id).xp;
            if (balance < total) {
                const due = loan.due_at! <= Date.now()
                    ? "It's already due, so the bot takes it the moment you have enough."
                    : `Otherwise the bot collects it <t:${Math.floor(loan.due_at! / 1000)}:R> (or, if you're short then, the moment you have enough).`;
                await ephemeral(interaction, `You need **${fmt(total)} ${s.xp_name}** to pay back <@${loan.lender_id}>, but you have **${fmt(balance)}**. ${due}`);
                return;
            }
            const paid = repayNow(loan.id);
            if (!paid) {
                await ephemeral(interaction, "That loan was just settled. Check `/loan list`.");
                return;
            }
            await interaction.reply({
                components: [repaidCard(paid, "manual")],
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { parse: [], users: [loan.lender_id] }
            });
            await afterRepay(interaction.client, paid, "manual", false);
            return;
        }

        // give and ask: both need loans on, and a real person on the other side.
        if (!s.loan_enabled) {
            await ephemeral(interaction, "Loans are turned off on this server.");
            return;
        }
        const target = interaction.options.getUser("user", true);
        const amount = interaction.options.getInteger("amount", true);

        if (target.bot || target.id === interaction.user.id) {
            const self = sub === "ask" ? "You can't ask yourself for a loan." : "You can't lend to yourself.";
            await ephemeral(interaction, target.bot ? `Bots can't hold ${s.xp_name}.` : self);
            return;
        }
        const other = interaction.guild.members.cache.get(target.id) ?? await interaction.guild.members.fetch(target.id).catch(() => null);
        if (!other) {
            await ephemeral(interaction, "That person isn't in this server.");
            return;
        }

        if (sub === "ask") {
            // One open ask per pair: the rest is up to the lender.
            const open = openRequest(interaction.guildId, other.id, interaction.user.id);
            if (open) {
                await ephemeral(interaction, `You already have a request open with <@${other.id}> (asking for **${fmt(open.amount)} ${s.xp_name}**). Wait for them to answer it, or press Decline on it to close it.`);
                return;
            }
            const request = createRequest({
                guild_id: interaction.guildId,
                lender_id: other.id,
                borrower_id: interaction.user.id,
                amount,
                channel_id: interaction.channelId
            });
            const asked = await interaction.reply({
                components: [offerView(request)],
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { parse: [], users: [other.id] },
                withResponse: true
            });
            setLoanMessage(request.id, asked.resource?.message?.id ?? null);
            return;
        }

        // give: the lender names the terms up front.
        const borrower = other;
        const interest_input = interaction.options.getString("interest", true);
        const time_input = interaction.options.getString("time", true);

        const checked = checkTerms(interaction.guildId, interaction.user.id, amount, interest_input, time_input, s.xp_name);
        if (typeof checked === "string") {
            await ephemeral(interaction, checked);
            return;
        }

        const loan = createOffer({
            guild_id: interaction.guildId,
            lender_id: interaction.user.id,
            borrower_id: borrower.id,
            amount,
            interest: checked.interest,
            interest_pct: checked.pct,
            duration_ms: checked.duration_ms,
            channel_id: interaction.channelId
        });
        const res = await interaction.reply({
            components: [offerView(loan)],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [], users: [borrower.id] },
            withResponse: true
        });
        setLoanMessage(loan.id, res.resource?.message?.id ?? null);
    },
    async buttonHandler(interaction: ButtonInteraction) {
        if (!interaction.inCachedGuild()) return;
        const [, raw_id, action] = interaction.customId.split(":");
        const loan = getLoan(Number(raw_id));
        if (!loan || loan.guild_id !== interaction.guildId) {
            await ephemeral(interaction, "This offer is no longer open.");
            return;
        }
        // Already answered (or expired while the bot was away): show where it stands.
        if (loan.status !== "pending" && loan.status !== "requested") {
            await interaction.update({ components: [offerView(loan)], allowedMentions: { parse: [] } });
            return;
        }

        const me = interaction.user.id;
        if (action === "decline") {
            if (me !== loan.borrower_id && me !== loan.lender_id) {
                await ephemeral(interaction, `Only <@${loan.borrower_id}> or <@${loan.lender_id}> can do that.`);
                return;
            }
            // Whoever was being waited on says no; the other one takes it back.
            const status = me === responderOf(loan) ? "declined" : "cancelled";
            closeOffer(loan.id, status, me);
            await interaction.update({ components: [offerView(getLoan(loan.id)!)], allowedMentions: { parse: [] } });
            return;
        }

        // The lender writing the terms on a request they were sent.
        if (action === "terms") {
            if (loan.status !== "requested") {
                await interaction.update({ components: [offerView(loan)], allowedMentions: { parse: [] } });
                return;
            }
            if (me !== loan.lender_id) {
                await ephemeral(interaction, me === loan.borrower_id
                    ? `It's <@${loan.lender_id}>'s turn — they set the terms, then you accept or decline them.`
                    : `Only <@${loan.lender_id}> can answer this request.`);
                return;
            }
            const settings = getSettings(interaction.guildId).server;
            if (!settings.loan_enabled) {
                await ephemeral(interaction, "Loans are turned off on this server.");
                return;
            }
            await interaction.showModal(termsModal(loan, settings.xp_name));
            return;
        }

        if (action !== "accept") return;
        if (loan.status !== "pending") {
            await interaction.update({ components: [offerView(loan)], allowedMentions: { parse: [] } });
            return;
        }
        if (me !== loan.borrower_id) {
            await ephemeral(interaction, me === loan.lender_id ? "You can't accept your own offer. Wait for them to answer." : `This offer is for <@${loan.borrower_id}>.`);
            return;
        }
        if (!getSettings(interaction.guildId).server.loan_enabled) {
            await ephemeral(interaction, "Loans are turned off on this server.");
            return;
        }

        const lender = interaction.guild.members.cache.get(loan.lender_id) ?? null;
        const r = acceptLoan(loan.id, lender ? profileOf(lender) : undefined, profileOf(interaction.member));
        if (!r.ok) {
            if (r.closed) await interaction.update({ components: [offerView(getLoan(loan.id)!, r.reason)], allowedMentions: { parse: [] } });
            else await ephemeral(interaction, r.reason);
            return;
        }

        const xp_name = getSettings(interaction.guildId).server.xp_name;
        const here = interaction.channel?.isSendable() ? interaction.channel : null;
        afterLevelChange(interaction.member, r.borrower.old_level, r.borrower.level, r.borrower.xp, { channel: here }).catch(err => console.error("Loan level change failed:", err));
        if (lender) afterLevelChange(lender, r.lender.old_level, r.lender.level, r.lender.xp, { channel: here }).catch(err => console.error("Loan level change failed:", err));

        await interaction.update({
            components: [offerView(r.loan, `-# Balances now: <@${loan.lender_id}> ${fmt(r.lender.xp)} ${xp_name} · <@${loan.borrower_id}> ${fmt(r.borrower.xp)} ${xp_name}`)],
            allowedMentions: { parse: [] }
        });
    },
    // The lender's terms on a /loan ask: the request turns into an ordinary
    // offer, which the borrower still has to accept.
    async modalSubmit(interaction: ModalSubmitInteraction) {
        if (!interaction.inCachedGuild()) return;
        const [, raw_id, action] = interaction.customId.split(":");
        if (action !== "terms") return;

        const loan = getLoan(Number(raw_id));
        if (!loan || loan.guild_id !== interaction.guildId || loan.status !== "requested") {
            await ephemeral(interaction, "That request is no longer open.");
            return;
        }
        if (interaction.user.id !== loan.lender_id) {
            await ephemeral(interaction, `Only <@${loan.lender_id}> can answer this request.`);
            return;
        }
        const s = getSettings(interaction.guildId).server;
        if (!s.loan_enabled) {
            await ephemeral(interaction, "Loans are turned off on this server.");
            return;
        }

        const amount_input = interaction.fields.getTextInputValue("amount");
        const amount = parseBet(amount_input, getMember(interaction.guildId, interaction.user.id).xp);
        if (amount === null) {
            await ephemeral(interaction, `I couldn't read **${amount_input}** as an amount. Use a number like \`500\` or \`2k\`, or \`half\` / \`all\` of what you have.`);
            return;
        }
        if (amount < 1) {
            await ephemeral(interaction, `You have to lend at least **1 ${s.xp_name}**.`);
            return;
        }

        const checked = checkTerms(interaction.guildId, interaction.user.id, amount, interaction.fields.getTextInputValue("interest"), interaction.fields.getTextInputValue("time"), s.xp_name);
        if (typeof checked === "string") {
            await ephemeral(interaction, checked);
            return;
        }

        const offer = setTerms(loan.id, { amount, interest: checked.interest, interest_pct: checked.pct, duration_ms: checked.duration_ms });
        if (!offer) {
            await ephemeral(interaction, "That request was just closed.");
            return;
        }

        // The request card becomes the offer card, Accept/Decline and all.
        if (!interaction.isFromMessage()) {
            await interaction.reply({ components: [offerView(offer)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [], users: [offer.borrower_id] } });
            return;
        }
        await interaction.update({ components: [offerView(offer)], allowedMentions: { parse: [] } });
        // Editing that message doesn't ping anyone, and it's the borrower's
        // turn now, so say so where they'll see it.
        await interaction.followUp({
            components: [new ContainerBuilder().setAccentColor(COLOR.pending).addTextDisplayComponents(text([
                `### 📨 Terms are in`,
                `<@${offer.borrower_id}>, <@${offer.lender_id}> answered your loan request: **${fmt(offer.amount)} ${s.xp_name}**, paying back **${fmt(owed(offer))}** after ${formatTerm(offer.duration_ms)}.`,
                `-# Accept or decline them on [the request](${interaction.message.url}) — it expires <t:${Math.floor((offer.created_at + OFFER_MS) / 1000)}:R>.`
            ].join("\n")))],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [], users: [offer.borrower_id] }
        }).catch(() => {});
    }
} satisfies Command;
