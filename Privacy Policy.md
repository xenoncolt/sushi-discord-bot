# Privacy Policy

**Last updated:** July 26, 2026

This explains what the **Sushi** Discord bot stores and why. It is kept simple on purpose, because the bot stores very little.

## What the bot stores

When someone uses `/setup-events`, the bot saves one row in its database with:

| What | Example / why |
| --- | --- |
| Event name | "Guild War" — shown on the notice board message |
| Event time | The date and time you entered, saved as a UTC timestamp |
| Event type | `once`, `daily`, `weekly`, or `monthly` |
| Announcement message | The text you typed, posted when the event starts |
| Announcement channel ID | Where to post the announcement |
| Server (guild) ID | So each server only sees and manages its own events |
| Notice board channel ID | Only if you chose one |
| Notice board message ID | So the bot can edit its own board message later |

That is the complete list.

## What the bot does NOT store

- **No user data.** No user IDs, usernames, nicknames, avatars, or roles are saved.
- **No chat messages.** The bot does not save, read through, or log the messages members send in your server. The only message text it keeps is the announcement text you typed into the `/setup-events` form yourself.
- **No emails, IP addresses, payment info, or voice data.**
- **No analytics or tracking.** Nothing is collected to profile you or your server.

Note: if you write a role or user mention (like `<@&123...>`) into your announcement message, that ID is part of your message text and gets saved with it. That is your choice when writing the message.

## Where it is stored

In a single SQLite database file (`database/timing.db`) on the machine that runs the bot. The bot is self-hosted by its owner.

## Who can see it

- The bot owner, who has access to the machine the bot runs on.
- Members of your server can see the announcements and notice board messages the bot posts, because those are normal Discord messages in the channels you chose.
- Nobody else. Data is **not** sold, shared, or sent to any third party. The only outside service involved is Discord itself, which the bot needs to work ([Discord Privacy Policy](https://discord.com/privacy)).

## Logs

The bot prints messages to its own console for errors and warnings, for example when a channel is missing or an announcement fails to send. These lines can contain an event name and a channel ID. They are not shared with anyone and are not kept in a database.

## How long it is kept

- **One-time events** are deleted from the database automatically right after the announcement is posted.
- **Repeating events** (daily / weekly / monthly) are kept and the saved time is moved to the next occurrence, until someone deletes them.
- Using `/remove-events` deletes the event immediately, and the bot also tries to delete its notice board message for that event.

## Deleting your data

- Use `/remove-events` for each event you want gone. This deletes it right away.
- Removing the bot from your server stops it from posting, but any repeating events already saved stay in the database file. To have all data for your server deleted, open an issue and include your server ID: [github.com/xenoncolt/sushi-discord-bot/issues](https://github.com/xenoncolt/sushi-discord-bot/issues)

## Children

The bot is not aimed at children. You must meet Discord's minimum age requirement to use Discord, and therefore this bot.

## Security

The bot only saves the fields listed above, and no personal data. Still, this is a small hobby project — it does not have any special security guarantees, and no system can be promised to be perfectly safe.

## Changes

If the bot changes what it stores, this page will be updated and the "Last updated" date at the top will change.

## Contact

Questions or data deletion requests: open an issue at
[github.com/xenoncolt/sushi-discord-bot/issues](https://github.com/xenoncolt/sushi-discord-bot/issues)
