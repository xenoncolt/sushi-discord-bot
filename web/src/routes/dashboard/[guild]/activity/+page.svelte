<script lang="ts">
	import { AtSign, Clock, Dices, List, RotateCcw, Search, Settings, ShoppingBag, Sprout, User, Zap } from "@lucide/svelte";
	import { api, type ActivityRow } from "$lib/api";
	import { dateTime } from "$lib/formula";
	import { useGuild } from "$lib/guild.svelte";

	const g = useGuild();

	const TYPES = [
		{ id: "", label: "All", icon: List, color: "#f06595" },
		{ id: "settings", label: "Settings", icon: Settings, color: "#4dabf7" },
		{ id: "xp", label: "XP", icon: Zap, color: "#51cf66" },
		{ id: "level", label: "Level", icon: Sprout, color: "#fab005" },
		{ id: "roles", label: "Roles", icon: AtSign, color: "#cc5de8" },
		{ id: "games", label: "Games", icon: Dices, color: "#748ffc" },
		{ id: "shop", label: "Shop", icon: ShoppingBag, color: "#f783ac" },
		{ id: "reset", label: "Reset", icon: RotateCcw, color: "#ff6b6b" }
	] as const;
	const byId = Object.fromEntries(TYPES.map(t => [t.id, t]));

	let type = $state<string>("");
	let q = $state("");
	let applied_q = $state("");
	let rows = $state<ActivityRow[]>([]);
	let loading = $state(false);
	let done = $state(false);

	async function load(reset: boolean) {
		loading = true;
		const before = reset ? "" : rows.at(-1)?.id ?? "";
		try {
			const page = await api<ActivityRow[]>(`/guilds/${g.guild.id}/activity?type=${type}&q=${encodeURIComponent(applied_q)}&before=${before}`);
			rows = reset ? page : [...rows, ...page];
			done = page.length < 50;
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		void type;
		void applied_q;
		load(true);
	});
</script>

<svelte:head><title>Activity · {g.guild.name}</title></svelte:head>

<div class="page-head">
	<h1>Activity</h1>
	<p>View server activity logs: settings, XP, roles, shop, and more.</p>
</div>

<div class="bar">
	<div class="filters">
		{#each TYPES as t (t.id)}
			<button class="filter" class:active={type === t.id} style:--c={t.color} onclick={() => (type = t.id)}>
				<t.icon size={13} />{t.label}
			</button>
		{/each}
	</div>
	<form class="search" onsubmit={e => { e.preventDefault(); applied_q = q.trim(); }}>
		<Search size={14} />
		<input placeholder="Search activity & Enter" bind:value={q} />
	</form>
</div>

<div class="list">
	{#each rows as r (r.id)}
		{@const t = byId[r.type] ?? TYPES[0]}
		<div class="item">
			<span class="ico" style:--c={t.color}><t.icon size={14} /></span>
			<div class="body">
				<div class="line">
					{#if r.user_name}<strong>{r.user_name}</strong>{" · "}{/if}{r.text}
				</div>
				<div class="meta">
					<Clock size={11} /> {dateTime(r.created_at)}
					{#if r.actor_name && r.actor_name !== r.user_name}
						· <User size={11} /> {r.actor_name}
					{/if}
				</div>
			</div>
			<span class="kind">{t.label}</span>
		</div>
	{:else}
		{#if !loading}<div class="empty">Nothing logged yet{applied_q ? " for that search" : ""}.</div>{/if}
	{/each}
</div>

{#if rows.length && !done}
	<div class="row" style="justify-content: center; margin-top: 14px">
		<button class="btn" disabled={loading} onclick={() => load(false)}>{loading ? "Loading…" : "Load more"}</button>
	</div>
{/if}

<style>
	.bar {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 10px;
		margin-bottom: 14px;
	}
	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		flex: 1;
	}
	.filter {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		border: 1px solid transparent;
		background: color-mix(in srgb, var(--c) 12%, transparent);
		color: var(--c);
		padding: 5px 10px;
		border-radius: 6px;
		font-size: 12.5px;
		font-weight: 500;
	}
	.filter.active {
		background: color-mix(in srgb, var(--c) 30%, transparent);
		border-color: color-mix(in srgb, var(--c) 60%, transparent);
		color: #fff;
	}
	.search {
		display: flex;
		align-items: center;
		gap: 8px;
		background: var(--input);
		border: 1px solid var(--input-border);
		border-radius: 6px;
		padding: 6px 10px;
		width: 240px;
		color: var(--muted);
	}
	.search input {
		flex: 1;
		min-width: 0;
		border: 0;
		background: transparent;
		outline: none;
		color: var(--text);
		font: inherit;
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.item {
		display: flex;
		align-items: center;
		gap: 12px;
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 10px 14px;
	}
	.ico {
		width: 30px;
		height: 30px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		flex: none;
		background: color-mix(in srgb, var(--c) 16%, transparent);
		color: var(--c);
	}
	.body {
		flex: 1;
		min-width: 0;
	}
	.line {
		overflow-wrap: anywhere;
	}
	.meta {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 11.5px;
		color: var(--faint);
		margin-top: 2px;
	}
	.kind {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.5px;
		text-transform: uppercase;
		color: var(--muted);
		align-self: flex-end;
	}
	@media (max-width: 600px) {
		.search {
			width: 100%;
		}
	}
</style>
