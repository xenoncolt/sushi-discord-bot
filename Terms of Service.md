# Terms of Service

**Last updated:** July 26, 2026

These are the terms for using the **Sushi** Discord bot. By adding the bot to a server or using its commands, you agree to these terms. If you do not agree, please remove the bot from your server.

## 1. What the bot does

Sushi is an event reminder bot. It has two slash commands:

- `/setup-events` — save an event (name, date, time, and announcement message), pick a channel where the bot will post the announcement, and optionally pick a channel where the bot keeps a "notice board" message showing when the event happens next. Events can be one-time, daily, weekly, or monthly.
- `/remove-events` — delete a saved event and its notice board message.

That is all the bot does. It has no other features right now.

## 2. Who can use it

- You must follow the [Discord Terms of Service](https://discord.com/terms) and [Community Guidelines](https://discord.com/guidelines). This includes Discord's minimum age requirement for your country.
- To set up or remove an event, you need **Manage Channels** permission (plus **Send Messages** to set up, and **Manage Messages** to remove) in the channel you are pointing the bot at. The bot checks this before saving or deleting anything.

## 3. Rules for using the bot

Please do not:

- Use the bot to send spam, scams, harassment, hateful content, or anything against Discord's rules. You write the announcement message yourself, so you are responsible for what it says.
- Abuse role or user mentions in announcement messages to mass-ping people who do not want it.
- Try to break, overload, or abuse the bot (for example, spamming commands to overload the server it runs on).
- Reverse engineer, resell, or pretend the bot is yours. The source code is open under GPL-3.0 — see the license instead.

## 4. If you break the rules

The bot owner may block a server or a user from using the bot, or remove the bot from a server, at any time. No warning is guaranteed.

## 5. Availability

The bot is a free hobby project run by one person.

- It can go offline, be restarted, or be shut down at any time, without notice.
- Reminders can be late or missed — for example if the bot is offline at the event time, if it loses permission to post in the channel, or if the channel is deleted. If the bot restarts and an event is more than 10 minutes overdue, that occurrence is skipped and the bot moves on to the next one.
- There is no guarantee of uptime, and no promise that saved event data will never be lost.

Do not use the bot for anything where a missed reminder would be a serious problem.

## 6. No warranty

The bot is provided "as is", with no warranty of any kind. The owner is not responsible for any loss or damage that comes from using it, including missed reminders or deleted messages.

## 7. Removing your data

Removing the bot from your server, or using `/remove-events` on each event, stops it from working there. See the [Privacy Policy](./Privacy%20Policy.md) for what gets stored and how to have it deleted.

## 8. Changes to these terms

These terms may change if the bot changes. The "Last updated" date at the top will change too. Continuing to use the bot after a change means you accept the new terms.

## 9. Contact

Questions, problems, or data requests: open an issue at
[github.com/xenoncolt/sushi-discord-bot/issues](https://github.com/xenoncolt/sushi-discord-bot/issues)
