<script lang="ts">
	import { ChevronLeft, ChevronRight, Pencil, Search } from "@lucide/svelte";
	import { api, type MemberRow } from "$lib/api";
	import Card from "$lib/components/Card.svelte";
	import Modal from "$lib/components/Modal.svelte";
	import NumberInput from "$lib/components/NumberInput.svelte";
	import RoleSelect from "$lib/components/RoleSelect.svelte";
	import Segmented from "$lib/components/Segmented.svelte";
	import { fmt, xpForLevel } from "$lib/formula";
	import { Autosave, useGuild } from "$lib/guild.svelte";
	import { toast } from "$lib/toast.svelte";

	const g = useGuild();
	const xp_name = $derived(g.settings.server.xp_name);

	// Nickname level prefix, e.g. "[LV.{level}]" → "[LV.5] Nickname".
	const lv = new Autosave(g, "level");
	const PREFIX_EXAMPLES = ["[LV.{level}]", "Lv.{level}", "⭐{level}", "[{level}LV]"];
	const prefix_preview = $derived(lv.value.prefix.trim() ? `${lv.value.prefix.trim().replace("{level}", "5")} Nickname` : "Nickname");

	let q = $state("");
	let page = $state(1);
	let data = $state<{ total: number; page: number; pages: number; members: MemberRow[] } | null>(null);
	let loading = $state(false);

	async function load() {
		loading = true;
		try {
			data = await api(`/guilds/${g.guild.id}/members?page=${page}&q=${encodeURIComponent(q.trim())}`);
		} catch (err) {
			toast((err as Error).message, "error");
		} finally {
			loading = false;
		}
	}
	load();

	let search_timer: ReturnType<typeof setTimeout>;
	function onsearch() {
		clearTimeout(search_timer);
		search_timer = setTimeout(() => {
			page = 1;
			load();
		}, 300);
	}

	// ---- edit one member
	let editing = $state<MemberRow | null>(null);
	let mode = $state<"set_level" | "set_xp" | "add" | "remove">("set_level");
	let amount = $state(0);
	let busy = $state(false);

	function edit(m: MemberRow) {
		editing = m;
		mode = "set_level";
		amount = m.level;
	}

	const preview = $derived.by(() => {
		if (!editing) return "";
		const f = g.settings.server.formula;
		switch (mode) {
			case "set_level": return `${fmt(editing.xp)} → ${fmt(xpForLevel(amount, f))} ${xp_name} (level ${amount})`;
			case "set_xp": return `${fmt(editing.xp)} → ${fmt(amount)} ${xp_name}`;
			case "add": return `${fmt(editing.xp)} → ${fmt(editing.xp + amount)} ${xp_name}`;
			case "remove": return `${fmt(editing.xp)} → ${fmt(Math.max(0, editing.xp - amount))} ${xp_name}`;
		}
	});

	async function apply() {
		if (!editing) return;
		busy = true;
		try {
			const updated = await api<MemberRow>(`/guilds/${g.guild.id}/members/${editing.user_id}/xp`, { method: "POST", body: { mode, value: amount } });
			if (data) data.members = data.members.map(m => (m.user_id === updated.user_id ? updated : m));
			toast(`${updated.name}: level ${updated.level}, ${fmt(updated.xp)} ${xp_name}`);
			editing = null;
		} catch (err) {
			toast((err as Error).message, "error");
		} finally {
			busy = false;
		}
	}

	// ---- bulk by role
	let bulk_role = $state<string | null>(null);
	let bulk_mode = $state<"add" | "remove">("add");
	let bulk_amount = $state(100);

	async function applyBulk() {
		if (!bulk_role) return toast("Pick a role first.", "error");
		busy = true;
		try {
			const r = await api<{ members: number }>(`/guilds/${g.guild.id}/xp/role`, { method: "POST", body: { role_id: bulk_role, mode: bulk_mode, value: bulk_amount } });
			toast(`${bulk_mode === "add" ? "Gave" : "Took"} ${fmt(bulk_amount)} ${xp_name} ${bulk_mode === "add" ? "to" : "from"} ${r.members} members`);
			load();
		} catch (err) {
			toast((err as Error).message, "error");
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Level · {g.guild.name}</title></svelte:head>

<div class="page-head">
	<h1>Level</h1>
	<p>Level prefix for nicknames, plus member lookup to adjust XP and levels. Every change shows up in Activity.</p>
</div>

<div class="stack">
	<Card title="Level Prefix" desc={"Automatically shows the level in front of members' server nicknames. Include {level} where the number goes; leave empty to turn it off."}>
		<div class="prefix-row">
			<input class="input mono" maxlength="20" placeholder={"[LV.{level}]"} bind:value={lv.value.prefix} />
			<div class="nick-preview"><span class="faint">Preview</span> <strong>{prefix_preview}</strong></div>
		</div>
		<div class="row wrap" style="margin-top: 10px">
			{#each PREFIX_EXAMPLES as ex (ex)}
				<button class="btn sm" onclick={() => (lv.value.prefix = ex)}>{ex} → {ex.replace("{level}", "5")}</button>
			{/each}
			<button class="btn sm" onclick={() => (lv.value.prefix = "")}>Off</button>
		</div>
		<details class="why">
			<summary>Prefix not showing up?</summary>
			<ul>
				<li>The bot needs the <strong>Manage Nicknames</strong> permission.</li>
				<li>The bot's role must be above the member's highest role.</li>
				<li>The server owner's nickname can never be changed by a bot.</li>
				<li>Nicknames longer than 32 characters are skipped.</li>
				<li>Nicknames update when someone's level changes — run <span class="mono">/levelsync</span> to apply it to everyone now.</li>
			</ul>
		</details>
	</Card>

	<Card title="Members" desc="Ranked by total {xp_name}. Search to find anyone, including members with no XP yet.">
		<div class="search">
			<Search size={15} />
			<input placeholder="Search by name or ID" bind:value={q} oninput={onsearch} />
		</div>

		{#if !data}
			<div class="empty">Loading…</div>
		{:else if !data.members.length}
			<div class="empty">{q ? "Nobody matches that search." : "Nobody has earned XP yet."}</div>
		{:else}
			<div class="table-wrap" class:loading>
				<table class="table">
					<thead>
						<tr><th>Member</th><th>Level</th><th>{xp_name}</th><th class="hide-sm">Monthly</th><th class="hide-sm">Check-ins</th><th class="hide-sm">Streak</th><th></th></tr>
					</thead>
					<tbody>
						{#each data.members as m (m.user_id)}
							<tr>
								<td>
									<div class="row who">
										{#if m.avatar}<img class="avatar" src={m.avatar} alt="" />{:else}<div class="avatar"></div>{/if}
										<span class="name">{m.name}</span>
										{#if !m.in_server}<span class="badge pvp">left</span>{/if}
									</div>
								</td>
								<td>{m.level}</td>
								<td>{fmt(m.xp)}</td>
								<td class="hide-sm">{fmt(m.month_xp)}</td>
								<td class="hide-sm">{m.att_total}</td>
								<td class="hide-sm">{m.att_streak}</td>
								<td><button class="btn sm" onclick={() => edit(m)}><Pencil size={13} /> Edit</button></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if data.pages > 1}
				<div class="pager">
					<button class="btn icon" disabled={page <= 1} onclick={() => { page--; load(); }} aria-label="Previous"><ChevronLeft size={16} /></button>
					<span>{data.page} / {data.pages}</span>
					<button class="btn icon" disabled={page >= data.pages} onclick={() => { page++; load(); }} aria-label="Next"><ChevronRight size={16} /></button>
				</div>
			{/if}
		{/if}
	</Card>

	<Card title="Bulk XP by role" desc="Give or take XP from everyone who has a role (replaces /addxptorole).">
		<div class="bulk">
			<div>
				<span class="label">Role</span>
				<RoleSelect bind:value={bulk_role} placeholder="Pick a role" allowNone={false} />
			</div>
			<div>
				<span class="label">Action</span>
				<Segmented bind:value={bulk_mode} options={[{ value: "add", label: "Add" }, { value: "remove", label: "Remove" }]} />
			</div>
			<div>
				<label class="label" for="bulk-amt">Amount</label>
				<NumberInput id="bulk-amt" bind:value={bulk_amount} min={0} max={100000000} />
			</div>
			<button class="btn primary" disabled={busy} onclick={applyBulk}>Apply</button>
		</div>
	</Card>
</div>

{#if editing}
	<Modal title="Adjust {editing.name}" onclose={() => (editing = null)}>
		<div class="row who" style="margin-bottom: 14px">
			{#if editing.avatar}<img class="avatar" src={editing.avatar} alt="" />{/if}
			<div>
				<strong>{editing.name}</strong>
				<div class="faint">Level {editing.level} · {fmt(editing.xp)} {xp_name}</div>
			</div>
		</div>
		<span class="label">Action</span>
		<Segmented
			bind:value={mode}
			size="sm"
			options={[
				{ value: "set_level", label: "Set level" },
				{ value: "set_xp", label: "Set XP" },
				{ value: "add", label: "Add" },
				{ value: "remove", label: "Remove" }
			]}
		/>
		<div style="margin-top: 12px">
			<label class="label" for="amt">{mode === "set_level" ? "Level" : xp_name}</label>
			<NumberInput id="amt" bind:value={amount} min={0} max={1000000000} />
			<div class="hint">{preview}</div>
		</div>
		<div class="row" style="justify-content: flex-end; margin-top: 18px">
			<button class="btn" onclick={() => (editing = null)}>Cancel</button>
			<button class="btn primary" disabled={busy} onclick={apply}>Apply</button>
		</div>
	</Modal>
{/if}

<style>
	.prefix-row {
		display: grid;
		grid-template-columns: minmax(0, 320px) 1fr;
		gap: 12px;
		align-items: center;
	}
	.nick-preview {
		display: flex;
		align-items: center;
		gap: 10px;
		background: #313338;
		border-radius: 6px;
		padding: 9px 12px;
		width: fit-content;
	}
	.why {
		margin-top: 12px;
		font-size: 12.5px;
		color: var(--muted);
	}
	.why summary {
		cursor: pointer;
		width: fit-content;
	}
	.why ul {
		margin: 8px 0 0;
		padding-left: 20px;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.search {
		display: flex;
		align-items: center;
		gap: 8px;
		max-width: 360px;
		background: var(--input);
		border: 1px solid var(--input-border);
		border-radius: 6px;
		padding: 7px 10px;
		color: var(--muted);
		margin-bottom: 12px;
	}
	.search input {
		flex: 1;
		border: 0;
		background: transparent;
		outline: none;
		color: var(--text);
		font: inherit;
	}
	.table-wrap {
		overflow-x: auto;
	}
	.loading {
		opacity: 0.6;
	}
	.who {
		gap: 10px;
		min-width: 0;
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 260px;
	}
	.pager {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		margin-top: 12px;
		color: var(--muted);
	}
	.bulk {
		display: grid;
		grid-template-columns: 1.4fr 1fr 1fr auto;
		gap: 12px;
		align-items: end;
		max-width: 900px;
	}
	@media (max-width: 760px) {
		.bulk {
			grid-template-columns: 1fr;
		}
		.hide-sm {
			display: none;
		}
	}
</style>
