<script lang="ts">
	import { Send } from "@lucide/svelte";
	import { api } from "$lib/api";
	import Card from "$lib/components/Card.svelte";
	import ChannelSelect from "$lib/components/ChannelSelect.svelte";
	import Toggle from "$lib/components/Toggle.svelte";
	import V2Preview, { renderMarkdown } from "$lib/components/V2Preview.svelte";
	import { Autosave, useGuild } from "$lib/guild.svelte";
	import { session } from "$lib/session.svelte";
	import { toast } from "$lib/toast.svelte";

	type Tab = "levelup" | "role" | "total" | "streak";

	const g = useGuild();
	const s = new Autosave(g, "notifications");

	let tab = $state<Tab>("levelup");
	let body_el = $state<HTMLTextAreaElement>();
	let focused_field = $state<"title" | "body" | "footer">("body");
	let testing = $state(false);

	const tpl = $derived(s.value.templates[tab]);

	const PLACEHOLDERS: Record<Tab, [string, string][]> = {
		levelup: [["Name", "{name}"], ["Mention", "{mention}"], ["New Level", "{level}"], ["Old Level", "{old_level}"], ["Level Diff", "{level_diff}"], ["Total XP", "{xp}"], ["XP Name", "{xp_name}"], ["Server", "{server}"]],
		role: [["Name", "{name}"], ["Mention", "{mention}"], ["Level", "{level}"], ["Role Name", "{role}"], ["Role Mention", "{roleMention}"], ["Server", "{server}"]],
		total: [["Name", "{name}"], ["Mention", "{mention}"], ["Check-ins", "{count}"], ["Role Name", "{role}"], ["Role Mention", "{roleMention}"], ["Server", "{server}"]],
		streak: [["Name", "{name}"], ["Mention", "{mention}"], ["Streak", "{count}"], ["Role Name", "{role}"], ["Role Mention", "{roleMention}"], ["Server", "{server}"]]
	};

	const TABS: { id: Tab; label: string; hint: string }[] = [
		{ id: "levelup", label: "Level Up", hint: "Sent to the Level Up Announcement Channel (or where they chatted) when someone levels up." },
		{ id: "role", label: "Role", hint: "Sent to the Level Role Announcement Channel (Roles page) when a level role is given." },
		{ id: "total", label: "Total", hint: "Sent to the Level Role Announcement Channel when an attendance-total role is given." },
		{ id: "streak", label: "Streak", hint: "Sent to the Level Role Announcement Channel when an attendance-streak role is given." }
	];

	function insert(token: string) {
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

	const me = $derived(session.me?.user);
	const sample_role = $derived(g.role(g.settings.roles.level_roles.at(-1)?.role_id)?.name ?? "Little Villain");
	const vars = $derived<Record<string, string>>({
		name: me?.global_name ?? me?.username ?? "Member",
		user: me?.global_name ?? me?.username ?? "Member",
		username: me?.username ?? "member",
		mention: "<@me>",
		level: "12",
		old_level: "11",
		level_diff: "1",
		xp: "7,276",
		xp_name: g.settings.server.xp_name,
		server: g.guild.name,
		role: sample_role,
		roleMention: "<@&role>",
		role_name: sample_role,
		count: tab === "streak" ? "7" : "30"
	});

	function fill(text: string): string {
		return text.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
	}

	const mentions = $derived({ me: vars.user, "&role": sample_role });
	const preview_html = $derived(renderMarkdown([tpl.title.trim() ? `### ${fill(tpl.title)}` : "", fill(tpl.body)].filter(Boolean).join("\n"), mentions));
	const footer_html = $derived(tpl.footer.trim() ? renderMarkdown(fill(tpl.footer), mentions) : "");
	const image_url = $derived(/^https:\/\/\S+$/.test(fill(tpl.image).trim()) ? fill(tpl.image).trim() : null);

	async function test() {
		await s.flush();
		testing = true;
		try {
			const r = await api<{ message: string }>(`/guilds/${g.guild.id}/test/${tab}`, { method: "POST", body: {} });
			toast(r.message);
		} catch (err) {
			toast((err as Error).message, "error", 6000);
		} finally {
			testing = false;
		}
	}
</script>

<svelte:head><title>Notifications · {g.guild.name}</title></svelte:head>

<div class="page-head">
	<h1>Notifications</h1>
	<p>Configure the level-up announcement channel and message format.</p>
</div>

<div class="stack">
	<Card title="Level Up Announcement Channel" desc="Channel to send level up announcement. With none, it's posted where the member was chatting.">
		{#snippet aside()}<div class="aside-select"><ChannelSelect bind:value={s.value.levelup_channel} noneLabel="Where they chatted" placeholder="Where they chatted" compact /></div>{/snippet}
	</Card>

	<Card title="Enable Level Up Notifications" desc="Whether to send level up notification messages">
		{#snippet aside()}<Toggle bind:checked={s.value.levelup_enabled} label="Level up notifications" />{/snippet}
	</Card>

	<Card title="Announcement Messages" desc="Level-up and role messages are sent as Discord Components V2 cards. Customize each one here.">
		<div class="tabs">
			{#each TABS as t (t.id)}
				<button class:active={tab === t.id} onclick={() => (tab = t.id)}>{t.label}</button>
			{/each}
		</div>
		<div class="hint" style="margin: 0 0 14px">{TABS.find(t => t.id === tab)?.hint}</div>

		<div class="editor">
			<div class="fields">
				<div>
					<label class="label" for="t-title">Title</label>
					<input id="t-title" class="input" maxlength="200" bind:value={s.value.templates[tab].title} onfocus={() => (focused_field = "title")} />
				</div>
				<div>
					<label class="label" for="t-body">Message</label>
					<textarea id="t-body" class="input" rows="4" maxlength="1500" bind:this={body_el} bind:value={s.value.templates[tab].body} onfocus={() => (focused_field = "body")}></textarea>
					<div class="chips">
						{#each PLACEHOLDERS[tab] as [label, token] (token)}
							<button class="btn ghost-accent sm" onmousedown={e => e.preventDefault()} onclick={() => insert(token)} title={token}>{label}</button>
						{/each}
					</div>
				</div>
				<div class="grid grid-2">
					<div>
						<label class="label" for="t-color">Accent color</label>
						<div class="row">
							<input id="t-color" type="color" class="swatch" bind:value={s.value.templates[tab].color} />
							<input class="input mono" maxlength="7" bind:value={s.value.templates[tab].color} />
						</div>
					</div>
					<div>
						<span class="label">Avatar thumbnail</span>
						<div class="row" style="height: 38px"><Toggle bind:checked={s.value.templates[tab].thumbnail} label="Avatar thumbnail" /><span class="muted">Show the member's avatar</span></div>
					</div>
				</div>
				<div>
					<label class="label" for="t-image">Image URL (optional)</label>
					<input id="t-image" class="input" placeholder="https://…" maxlength="500" bind:value={s.value.templates[tab].image} />
				</div>
				<div>
					<label class="label" for="t-footer">Footer (optional)</label>
					<input id="t-footer" class="input" maxlength="200" bind:value={s.value.templates[tab].footer} onfocus={() => (focused_field = "footer")} />
				</div>
			</div>

			<div class="preview">
				<span class="label">Preview</span>
				<V2Preview
					color={tpl.color}
					html={preview_html}
					thumbnail={tpl.thumbnail ? me?.avatar ?? "/favicon.svg" : null}
					image={image_url}
					footer={footer_html}
					bot_name={session.me?.bot?.name ?? "LeaderBoard"}
					bot_avatar={session.me?.bot?.avatar ?? "/favicon.svg"}
				/>
				<button class="btn" style="margin-top: 12px" disabled={testing} onclick={test}><Send size={14} /> Send a test message</button>
			</div>
		</div>
	</Card>

	<Card title="Experience Shop Log Channel" desc="Notifications will be sent here when users purchase items from the Experience Shop.">
		{#snippet aside()}<div class="aside-select"><ChannelSelect bind:value={s.value.shop_log_channel} compact /></div>{/snippet}
	</Card>

	<Card title="Experience Shop Admin Log Channel" desc="Benefit use requests and timed-role auto-revoke failures are sent here.">
		{#snippet aside()}<div class="aside-select"><ChannelSelect bind:value={s.value.shop_admin_channel} compact /></div>{/snippet}
	</Card>
</div>

<style>
	.aside-select {
		width: 220px;
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
	@media (max-width: 1100px) {
		.editor {
			grid-template-columns: 1fr;
		}
	}
</style>
