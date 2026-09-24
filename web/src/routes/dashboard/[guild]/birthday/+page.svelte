<script lang="ts">
	import { Cake, Clock, Pencil, Pin, RefreshCw, Send, Trash2, Users } from "@lucide/svelte";
	import { api, type BirthdayRow } from "$lib/api";
	import Card from "$lib/components/Card.svelte";
	import ChannelSelect from "$lib/components/ChannelSelect.svelte";
	import RoleSelect from "$lib/components/RoleSelect.svelte";
	import Toggle from "$lib/components/Toggle.svelte";
	import V2Preview, { renderMarkdown } from "$lib/components/V2Preview.svelte";
	import { Autosave, useGuild } from "$lib/guild.svelte";
	import { session } from "$lib/session.svelte";
	import { toast } from "$lib/toast.svelte";

	type Tab = "panel" | "announce";
	type Field = "title" | "body" | "footer" | "age_line";

	const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

	const g = useGuild();
	const s = new Autosave(g, "birthday");
	const v = $derived(s.value);

	let tab = $state<Tab>("panel");
	let body_el = $state<HTMLTextAreaElement>();
	let focused_field = $state<Field>("body");
	let testing = $state(false);
	let reposting = $state(false);

	const tpl = $derived(v.templates[tab]);
	const tz = $derived(g.settings.server.timezone);

	const PLACEHOLDERS: Record<Tab, [string, string][]> = {
		panel: [["Server", "{server}"], ["Saved count", "{count}"]],
		announce: [["Name", "{name}"], ["Mention", "{mention}"], ["Username", "{username}"], ["Age", "{age}"], ["Date", "{date}"], ["Day", "{day}"], ["Month", "{month}"], ["Server", "{server}"]]
	};

	function insert(token: string) {
		if (focused_field === "age_line") {
			s.value.age_line += token;
			return;
		}
		const t = s.value.templates[tab];
		if (focused_field === "body" && body_el) {
			const start = body_el.selectionStart ?? t.body.length;
			const end = body_el.selectionEnd ?? start;
			t.body = t.body.slice(0, start) + token + t.body.slice(end);
			queueMicrotask(() => {
				body_el?.focus();
				body_el?.setSelectionRange(start + token.length, start + token.length);
			});
		} else {
			t[focused_field] += token;
		}
	}

	// ---- saved birthdays --------------------------------------------------

	let birthdays = $state<BirthdayRow[]>([]);
	let loading = $state(true);
	let query = $state("");

	const shown = $derived(
		query.trim()
			? birthdays.filter(b => b.name.toLowerCase().includes(query.trim().toLowerCase()) || b.user_id === query.trim())
			: birthdays
	);

	api<BirthdayRow[]>(`/guilds/${g.guild.id}/birthdays`)
		.then(r => (birthdays = r))
		.catch(err => toast((err as Error).message, "error"))
		.finally(() => (loading = false));

	// Fixing a date for someone: the same forgiving formats the bot's own
	// modal takes, which is usually needed when a day/month pair went in the
	// wrong way round.
	let editing = $state<string | null>(null);
	let draft = $state("");
	let draft_year = $state("");

	function startEdit(row: BirthdayRow) {
		editing = row.user_id;
		draft = `${row.day}-${row.month}`;
		draft_year = row.year === null ? "" : String(row.year);
	}

	async function saveEdit(row: BirthdayRow) {
		try {
			const r = await api<{ month: number; day: number; year: number | null }>(`/guilds/${g.guild.id}/birthdays/${row.user_id}`, {
				method: "PUT",
				body: { date: draft, year: draft_year }
			});
			birthdays = birthdays.map(b => (b.user_id === row.user_id ? { ...b, ...r } : b));
			editing = null;
			toast(`${row.name} — ${r.day} ${MONTHS[r.month - 1]}`);
		} catch (err) {
			toast((err as Error).message, "error", 6000);
		}
	}

	async function remove(row: BirthdayRow) {
		try {
			await api(`/guilds/${g.guild.id}/birthdays/${row.user_id}`, { method: "DELETE" });
			birthdays = birthdays.filter(b => b.user_id !== row.user_id);
			toast(`Removed ${row.name}'s birthday`);
		} catch (err) {
			toast((err as Error).message, "error", 5000);
		}
	}

	function when(row: BirthdayRow): string {
		if (row.in_days === 0) return "today";
		if (row.in_days === 1) return "tomorrow";
		return `in ${row.in_days} days`;
	}

	// ---- preview ----------------------------------------------------------

	const me = $derived(session.me?.user);
	const ping_role = $derived(g.role(v.ping_role)?.name ?? "Birthdays");
	const vars = $derived<Record<string, string>>({
		name: me?.global_name ?? me?.username ?? "Member",
		user: me?.global_name ?? me?.username ?? "Member",
		username: me?.username ?? "member",
		mention: "<@me>",
		server: g.guild.name,
		count: String(birthdays.length),
		age: "24",
		date: "5 November",
		day: "5",
		month: "November",
		xp_name: g.settings.server.xp_name
	});

	function fill(text: string): string {
		return text.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
	}

	const mentions = $derived({ me: vars.user, "&role": ping_role });
	// The age line is only appended when that member shared a year, so the
	// preview shows it on the announcement tab only.
	const preview_body = $derived(tab === "announce" && v.age_line.trim() ? `${tpl.body}\n${v.age_line}` : tpl.body);
	const preview_html = $derived(renderMarkdown([tpl.title.trim() ? `### ${fill(tpl.title)}` : "", fill(preview_body)].filter(Boolean).join("\n"), mentions));
	const footer_html = $derived(tpl.footer.trim() ? renderMarkdown(fill(tpl.footer), mentions) : "");
	const image_url = $derived(/^https:\/\/\S+$/.test(fill(tpl.image).trim()) ? fill(tpl.image).trim() : null);
	const thumb = $derived(!tpl.thumbnail ? null : tab === "panel" ? g.guild.icon ?? "/favicon.svg" : me?.avatar ?? "/favicon.svg");

	// ---- actions ----------------------------------------------------------

	async function test() {
		await s.flush();
		testing = true;
		try {
			const r = await api<{ message: string }>(`/guilds/${g.guild.id}/test/birthday`, { method: "POST", body: {} });
			toast(r.message);
		} catch (err) {
			toast((err as Error).message, "error", 6000);
		} finally {
			testing = false;
		}
	}

	async function repost() {
		await s.flush();
		reposting = true;
		try {
			const r = await api<{ message: string }>(`/guilds/${g.guild.id}/birthday/panel`, { method: "POST", body: {} });
			toast(r.message);
		} catch (err) {
			toast((err as Error).message, "error", 6000);
		} finally {
			reposting = false;
		}
	}
</script>

<svelte:head><title>Birthday · {g.guild.name}</title></svelte:head>

<div class="page-head">
	<h1>Birthday</h1>
	<p>Members add their own birthday from a pinned-to-the-bottom card, and the bot celebrates them on the day.</p>
</div>

<div class="stack">
	<Card title="Birthday System" desc="Collect birthdays and announce them automatically.">
		{#snippet aside()}<Toggle bind:checked={s.value.enabled} label="Birthday system" />{/snippet}
		{#if !v.enabled}
			<div class="hint">While this is off the panel is taken down, no announcements are sent, and the birthday role is removed from everyone.</div>
		{/if}
	</Card>

	<Card title="Birthday Panel Channel" desc="Where the card with the “set my birthday” button lives.">
		{#snippet aside()}<div class="aside-select"><ChannelSelect bind:value={s.value.panel_channel} compact /></div>{/snippet}
		<div class="row" style="margin-top: 4px">
			<Toggle bind:checked={s.value.panel_sticky} label="Keep the panel at the bottom" />
			<span>Keep the panel at the bottom of the channel</span>
		</div>
		<div class="note" style="margin-top: 10px">
			<Pin size={13} /> With this on, the panel is taken down and posted again a few seconds after anyone writes in that channel — so it never scrolls away and the button is always one click from the newest message. Put the announcement in this same channel and the birthday post will slot in right above it.
		</div>
		<div class="hint">The panel's message id is stored, so a restart cleans up the old card instead of leaving a stack of dead ones behind.</div>
		<div class="row" style="margin-top: 12px">
			<button class="btn" disabled={reposting || !v.enabled || !v.panel_channel} onclick={repost}><RefreshCw size={14} /> Update the panel now</button>
		</div>
	</Card>

	<Card title="Announcement Channel" desc="Where the happy-birthday message is posted.">
		{#snippet aside()}<div class="aside-select"><ChannelSelect bind:value={s.value.announce_channel} compact /></div>{/snippet}
		<div class="row wrap" style="margin-top: 6px; align-items: flex-end">
			<div>
				<label class="label" for="b-time">Time (24h)</label>
				<input id="b-time" class="input" type="time" bind:value={s.value.announce_time} style="width: 180px" />
			</div>
			<div class="tznote"><Clock size={13} /> {tz} — the timezone from the Server page.</div>
		</div>
		<div class="note" style="margin-top: 12px">
			<Users size={13} /> If the bot is offline when that time comes round, the announcement still goes out as soon as it is back — as long as it's the same day there. Whole days that were missed are skipped rather than posted late in a batch.
		</div>
		<div class="grid grid-2" style="margin-top: 14px">
			<div>
				<span class="label">Ping the birthday member</span>
				<div class="row" style="height: 38px">
					<Toggle bind:checked={s.value.mention_user} label="Ping the birthday member" />
					<span class="muted">Notify them with {"{mention}"}</span>
				</div>
			</div>
			<div>
				<span class="label">Also ping a role</span>
				<RoleSelect bind:value={s.value.ping_role} noneLabel="Don't ping a role" />
			</div>
		</div>
	</Card>

	<Card title="Birthday Role" desc="Worn for the day, taken off again when the day is over.">
		{#snippet aside()}<div class="aside-select"><RoleSelect bind:value={s.value.birthday_role} noneLabel="No role" assignableOnly /></div>{/snippet}
		<div class="hint">
			Given at the announcement time and removed at midnight. The list of who should be wearing it is worked out fresh every minute, so a restart, a missed day or a hand-edited role all sort themselves out.
			{#if !g.guild.bot.can_manage_roles}<br /><span class="warn">The bot doesn't have Manage Roles, so it can't hand this out.</span>{/if}
		</div>
	</Card>

	<Card title="Messages" desc="The panel and the announcement are Discord Components V2 cards. Customize both here.">
		<div class="tabs">
			<button class:active={tab === "panel"} onclick={() => (tab = "panel")}>Panel</button>
			<button class:active={tab === "announce"} onclick={() => (tab = "announce")}>Announcement</button>
		</div>
		<div class="hint" style="margin: 0 0 14px">
			{tab === "panel"
				? "The card that sits in the panel channel with the buttons attached."
				: "Posted in the announcement channel on the day, once per birthday member."}
		</div>

		<div class="editor">
			<div class="fields">
				<div>
					<label class="label" for="b-title">Title</label>
					<input id="b-title" class="input" maxlength="200" bind:value={s.value.templates[tab].title} onfocus={() => (focused_field = "title")} />
				</div>
				<div>
					<label class="label" for="b-body">Message</label>
					<textarea id="b-body" class="input" rows="4" maxlength="1500" bind:this={body_el} bind:value={s.value.templates[tab].body} onfocus={() => (focused_field = "body")}></textarea>
					<div class="chips">
						{#each PLACEHOLDERS[tab] as [label, token] (token)}
							<button class="btn ghost-accent sm" onmousedown={e => e.preventDefault()} onclick={() => insert(token)} title={token}>{label}</button>
						{/each}
					</div>
				</div>

				{#if tab === "announce"}
					<div>
						<label class="label" for="b-age">Age line (only when they shared a year)</label>
						<input id="b-age" class="input" maxlength="500" bind:value={s.value.age_line} onfocus={() => (focused_field = "age_line")} />
						<div class="hint">Added under the message for members who filled the year in. Leave it empty to never mention ages.</div>
					</div>
				{/if}

				<div class="grid grid-2">
					<div>
						<label class="label" for="b-color">Accent color</label>
						<div class="row">
							<input id="b-color" type="color" class="swatch" bind:value={s.value.templates[tab].color} />
							<input class="input mono" maxlength="7" bind:value={s.value.templates[tab].color} />
						</div>
					</div>
					<div>
						<span class="label">Thumbnail</span>
						<div class="row" style="height: 38px">
							<Toggle bind:checked={s.value.templates[tab].thumbnail} label="Thumbnail" />
							<span class="muted">{tab === "panel" ? "Show the server icon" : "Show their avatar"}</span>
						</div>
					</div>
				</div>
				<div>
					<label class="label" for="b-image">Image URL (optional)</label>
					<input id="b-image" class="input" placeholder="https://…" maxlength="500" bind:value={s.value.templates[tab].image} />
				</div>
				<div>
					<label class="label" for="b-footer">Footer (optional)</label>
					<input id="b-footer" class="input" maxlength="200" bind:value={s.value.templates[tab].footer} onfocus={() => (focused_field = "footer")} />
				</div>

				{#if tab === "panel"}
					<div class="grid grid-3">
						<div>
							<label class="label" for="b-set">“Set” button</label>
							<input id="b-set" class="input" maxlength="80" bind:value={s.value.set_label} />
						</div>
						<div>
							<label class="label" for="b-rm">“Remove” button</label>
							<input id="b-rm" class="input" maxlength="80" bind:value={s.value.remove_label} />
						</div>
						<div>
							<label class="label" for="b-list">“Upcoming” button</label>
							<input id="b-list" class="input" maxlength="80" bind:value={s.value.list_label} />
						</div>
					</div>
				{/if}
			</div>

			<div class="preview">
				<span class="label">Preview</span>
				{#if tab === "announce" && v.ping_role}
					<div class="pingline"><span class="mention">@{ping_role}</span></div>
				{/if}
				<V2Preview
					color={tpl.color}
					html={preview_html}
					thumbnail={thumb}
					image={image_url}
					footer={tab === "panel" ? "" : footer_html}
					bot_name={session.me?.bot?.name ?? "Bot"}
					bot_avatar={session.me?.bot?.avatar ?? "/favicon.svg"}
				>
					{#snippet extra()}
						{#if tab === "panel"}
							{#if footer_html}
								<div class="pv-rule"></div>
								<div class="pv-footer">{@html footer_html}</div>
							{/if}
							<div class="pv-buttons">
								<span class="pv-btn primary">{v.set_label}</span>
								<span class="pv-btn">{v.remove_label}</span>
								<span class="pv-btn">{v.list_label}</span>
							</div>
						{/if}
					{/snippet}
				</V2Preview>
				<div class="row" style="margin-top: 12px">
					{#if tab === "announce"}
						<button class="btn" disabled={testing} onclick={test}><Send size={14} /> Send a test message</button>
					{:else}
						<button class="btn" disabled={reposting || !v.enabled || !v.panel_channel} onclick={repost}><RefreshCw size={14} /> Update the panel now</button>
					{/if}
				</div>
			</div>
		</div>
	</Card>

	<Card title="Saved Birthdays" desc="Everyone who added a date, soonest first." badge={String(birthdays.length)}>
		{#snippet aside()}
			<input class="input" placeholder="Search a name…" bind:value={query} style="width: 200px" />
		{/snippet}

		{#if loading}
			<div class="faint">Loading…</div>
		{:else if !birthdays.length}
			<div class="faint">Nobody has added a birthday yet. Once the panel is up, members can add theirs with the button.</div>
		{:else if !shown.length}
			<div class="faint">No match for “{query}”.</div>
		{:else}
			<div class="list">
				{#each shown as b (b.user_id)}
					<div class="bd" class:soon={b.in_days === 0}>
						{#if b.avatar}<img src={b.avatar} alt="" />{:else}<div class="ph"><Cake size={14} /></div>{/if}
						<div class="who">
							<strong>{b.name}</strong>
							{#if !b.in_server}<span class="left">left the server</span>{/if}
						</div>
						{#if editing === b.user_id}
							<div class="edit">
								<input class="input" bind:value={draft} placeholder="5 Nov" aria-label="Day and month" />
								<input class="input" bind:value={draft_year} placeholder="Year" maxlength="4" style="width: 72px" aria-label="Year" />
								<button class="btn sm primary" onclick={() => saveEdit(b)}>Save</button>
								<button class="btn sm" onclick={() => (editing = null)}>Cancel</button>
							</div>
						{:else}
							<div class="date">{b.day} {MONTHS[b.month - 1]}{b.year ? ` ${b.year}` : ""}</div>
							<div class="age">{b.age === null ? "—" : `turning ${b.age}`}</div>
							<div class="in">{when(b)}</div>
						{/if}
						{#if g.isAdmin && editing !== b.user_id}
							<div class="actions">
								<button class="btn icon" title="Change this date" aria-label="Change {b.name}'s birthday" onclick={() => startEdit(b)}><Pencil size={13} /></button>
								<button class="btn icon" title="Remove this birthday" aria-label="Remove {b.name}'s birthday" onclick={() => remove(b)}><Trash2 size={14} /></button>
							</div>
						{/if}
					</div>
				{/each}
			</div>
			{#if !g.isAdmin}
				<div class="hint">Only server admins (Manage Server) can delete someone else's date.</div>
			{/if}
		{/if}
	</Card>
</div>

<style>
	.aside-select {
		width: 220px;
	}
	.tznote {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--muted);
		padding-bottom: 10px;
	}
	.warn {
		color: #ffa8a8;
	}
	.tabs {
		display: flex;
		gap: 4px;
		margin-bottom: 8px;
	}
	.tabs button {
		border: 0;
		background: transparent;
		color: var(--muted);
		padding: 6px 10px;
		border-radius: 6px;
		font-size: 13px;
	}
	.tabs button.active {
		color: #f06595;
		background: var(--accent-soft);
	}
	.editor {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 22px;
	}
	.fields {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 8px;
	}
	.swatch {
		width: 42px;
		height: 38px;
		border: 1px solid var(--input-border);
		border-radius: 6px;
		background: var(--input);
		padding: 3px;
		flex: none;
	}
	.pingline {
		margin-bottom: 6px;
		font-size: 14px;
	}
	.pingline .mention {
		background: rgba(88, 101, 242, 0.3);
		color: #c9cdfb;
		border-radius: 3px;
		padding: 0 3px;
		font-weight: 500;
	}
	/* The bot adds the buttons under the footer, so the preview does too. */
	.pv-rule {
		border-top: 1px solid #3f4147;
		margin: 10px 0;
	}
	.pv-footer {
		font-size: 12px;
		color: #949ba4;
	}
	.pv-buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 12px;
	}
	.pv-btn {
		background: #4e5058;
		color: #fff;
		border-radius: 8px;
		padding: 7px 14px;
		font-size: 13px;
		font-weight: 500;
	}
	.pv-btn.primary {
		background: #5865f2;
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.bd {
		display: grid;
		grid-template-columns: 26px minmax(0, 1fr) 130px 110px 90px auto;
		align-items: center;
		gap: 10px;
		padding: 7px 8px;
		border-radius: 6px;
		font-size: 13px;
	}
	.bd:hover {
		background: rgba(255, 255, 255, 0.03);
	}
	.bd.soon {
		background: var(--accent-soft);
	}
	.bd img,
	.bd .ph {
		width: 26px;
		height: 26px;
		border-radius: 50%;
	}
	.bd .ph {
		display: grid;
		place-items: center;
		background: #3a3d42;
		color: var(--muted);
	}
	.who {
		display: flex;
		align-items: baseline;
		gap: 8px;
		min-width: 0;
	}
	.who strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.left {
		font-size: 11px;
		color: var(--muted);
		flex: none;
	}
	.date {
		color: var(--text);
	}
	.age,
	.in {
		color: var(--muted);
	}
	/* Takes the date, age and "in N days" columns while it's open. */
	.edit {
		grid-column: span 3;
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.edit .input {
		height: 30px;
		padding: 0 8px;
		font-size: 12px;
	}
	.actions {
		display: flex;
		gap: 4px;
	}
	@media (max-width: 1100px) {
		.editor {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 700px) {
		.bd {
			grid-template-columns: 26px minmax(0, 1fr) auto;
			row-gap: 2px;
		}
		.age {
			display: none;
		}
	}
</style>
