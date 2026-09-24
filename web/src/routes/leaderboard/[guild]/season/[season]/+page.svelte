<script lang="ts">
	import { page } from "$app/state";
	import { ChevronLeft } from "@lucide/svelte";
	import { api, type BoardEntry } from "$lib/api";
	import Board from "$lib/components/Board.svelte";
	import Topbar from "$lib/components/Topbar.svelte";

	type Kind = "xp" | "total" | "streak";
	interface Archived {
		id: number;
		target: string;
		ended_at: number;
		total: number;
		page: number;
		pages: number;
		entries: BoardEntry[];
	}

	const guild_id = $derived(page.params.guild);
	const season_id = $derived(page.params.season);

	let guild = $state<{ name: string; icon: string | null; xp_name: string } | null>(null);
	let tab = $state<Kind>("xp");
	let current = $state(1);
	let data = $state<Archived | null>(null);
	let error = $state("");

	$effect(() => {
		api<{ name: string; icon: string | null; xp_name: string }>(`/public/guilds/${guild_id}`).then(g => (guild = g)).catch(err => (error = err.message));
	});
	$effect(() => {
		const t = tab, p = current;
		api<Archived>(`/public/guilds/${guild_id}/seasons/${season_id}?type=${t}&page=${p}`).then(d => (data = d)).catch(err => (error = err.message));
	});
</script>

<svelte:head><title>Season #{season_id} · {guild?.name ?? "Leaderboard"}</title></svelte:head>

<Topbar />

<main>
	<a class="back" href="/leaderboard/{guild_id}"><ChevronLeft size={15} /> Current leaderboard</a>
	{#if error}
		<div class="warn-box">{error}</div>
	{:else if guild && data}
		<header>
			{#if guild.icon}<img class="icon" src={guild.icon} alt="" />{/if}
			<div>
				<h1>{guild.name} — Season #{data.id}</h1>
				<div class="faint">Ended {new Date(data.ended_at).toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })} · {data.total} ranked</div>
				<nav class="tabs">
					<button class:active={tab === "xp"} onclick={() => { tab = "xp"; current = 1; }}>EXP</button>
					<button class:active={tab === "total"} onclick={() => { tab = "total"; current = 1; }}>Total</button>
					<button class:active={tab === "streak"} onclick={() => { tab = "streak"; current = 1; }}>Streak</button>
				</nav>
			</div>
		</header>
		<Board entries={data.entries} page={data.page} pages={data.pages} kind={tab} xp_name={guild.xp_name} onpage={p => (current = p)} />
	{:else}
		<div class="faint" style="text-align: center; padding: 40px">Loading…</div>
	{/if}
</main>

<style>
	main {
		max-width: 700px;
		margin: 0 auto;
		padding: 20px 16px 50px;
	}
	.back {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--muted);
		font-size: 13px;
		margin-bottom: 16px;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 14px;
		margin-bottom: 24px;
		text-align: left;
	}
	.icon {
		width: 58px;
		height: 58px;
		border-radius: 10px;
	}
	h1 {
		font-size: 20px;
		font-weight: 500;
	}
	.tabs {
		display: inline-flex;
		margin-top: 6px;
		border: 1px solid var(--border);
		border-radius: 5px;
		overflow: hidden;
	}
	.tabs button {
		border: 0;
		background: transparent;
		color: #c9a15b;
		font-size: 11.5px;
		padding: 4px 10px;
	}
	.tabs button.active {
		background: var(--accent);
		color: #fff;
	}
</style>
