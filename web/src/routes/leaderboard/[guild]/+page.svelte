<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { CalendarCheck, CalendarDays, History } from "@lucide/svelte";
	import { api, type BoardPage } from "$lib/api";
	import Board from "$lib/components/Board.svelte";
	import Topbar from "$lib/components/Topbar.svelte";

	type Kind = "xp" | "monthly" | "streak" | "total";
	interface PublicGuild {
		id: string;
		name: string;
		icon: string | null;
		xp_name: string;
		seasons: { id: number; target: string; ended_at: number }[];
	}

	const TABS: { id: Kind; label: string; icon?: typeof CalendarDays }[] = [
		{ id: "xp", label: "All-Time" },
		{ id: "monthly", label: "Monthly" },
		{ id: "streak", label: "Streak", icon: CalendarCheck },
		{ id: "total", label: "Total", icon: CalendarDays }
	];

	const guild_id = $derived(page.params.guild);
	const tab = $derived((TABS.some(t => t.id === page.url.searchParams.get("tab")) ? page.url.searchParams.get("tab") : "xp") as Kind);
	const current = $derived(Math.max(1, Number(page.url.searchParams.get("page")) || 1));

	let guild = $state<PublicGuild | null>(null);
	let board = $state<BoardPage | null>(null);
	let error = $state("");

	$effect(() => {
		api<PublicGuild>(`/public/guilds/${guild_id}`).then(g => (guild = g)).catch(err => (error = err.message));
	});

	$effect(() => {
		const t = tab, p = current;
		api<BoardPage>(`/public/guilds/${guild_id}/leaderboard?type=${t}&page=${p}`).then(b => (board = b)).catch(err => (error = err.message));
	});

	function go(next: { tab?: Kind; page?: number }) {
		const params = new URLSearchParams();
		const t = next.tab ?? tab;
		if (t !== "xp") params.set("tab", t);
		const p = next.page ?? (next.tab ? 1 : current);
		if (p > 1) params.set("page", String(p));
		goto(`?${params}`, { keepFocus: true, noScroll: true });
	}
</script>

<svelte:head><title>{guild ? `${guild.name} Leaderboard` : "Leaderboard"}</title></svelte:head>

<Topbar />

<main>
	{#if error}
		<div class="warn-box">{error}</div>
	{:else if guild}
		<header>
			{#if guild.icon}<img class="icon" src={guild.icon} alt="" />{:else}<div class="icon ph">{guild.name[0]}</div>{/if}
			<div>
				<h1>{guild.name}</h1>
				<nav class="tabs">
					{#each TABS as t (t.id)}
						<button class:active={tab === t.id} onclick={() => go({ tab: t.id })}>
							{#if t.icon}<t.icon size={12} />{/if}{t.label}
						</button>
					{/each}
				</nav>
			</div>
		</header>

		{#if board}
			<Board entries={board.entries} page={board.page} pages={board.pages} kind={tab} xp_name={guild.xp_name} onpage={p => go({ page: p })} />
		{:else}
			<div class="faint center">Loading…</div>
		{/if}

		{#if guild.seasons.length}
			<div class="seasons">
				<History size={14} /> Past seasons:
				{#each guild.seasons as s (s.id)}
					<a href="/leaderboard/{guild.id}/season/{s.id}">#{s.id} · {new Date(s.ended_at).toLocaleDateString("en-US", { month: "short", year: "numeric" })}</a>
				{/each}
			</div>
		{/if}
	{:else}
		<div class="faint center">Loading…</div>
	{/if}
</main>

<style>
	main {
		max-width: 700px;
		margin: 0 auto;
		padding: 26px 16px 50px;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 14px;
		margin-bottom: 24px;
	}
	.icon {
		width: 58px;
		height: 58px;
		border-radius: 10px;
		object-fit: cover;
	}
	.ph {
		display: grid;
		place-items: center;
		background: #3a3d42;
		font-size: 22px;
	}
	h1 {
		font-size: 22px;
		font-weight: 500;
		margin-bottom: 6px;
	}
	.tabs {
		display: inline-flex;
		border: 1px solid var(--border);
		border-radius: 5px;
		overflow: hidden;
		background: #25282b;
	}
	.tabs button {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		border: 0;
		background: transparent;
		color: #c9a15b;
		font-size: 11.5px;
		padding: 4px 9px;
	}
	.tabs button.active {
		background: var(--accent);
		color: #fff;
	}
	.center {
		text-align: center;
		padding: 40px 0;
	}
	.seasons {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 8px;
		margin-top: 26px;
		font-size: 12px;
		color: var(--faint);
	}
	.seasons a {
		color: var(--muted);
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 2px 7px;
	}
	.seasons a:hover {
		color: var(--text);
	}
</style>
