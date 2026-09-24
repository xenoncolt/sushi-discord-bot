<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";
	import { ChartColumn, Dices, LogIn, Mic, ShoppingBag, Sparkles } from "@lucide/svelte";
	import Topbar from "$lib/components/Topbar.svelte";
	import { loadMe, loginUrl, session } from "$lib/session.svelte";

	const error = $derived(page.url.searchParams.get("error"));

	loadMe().then(me => {
		if (me?.user && !page.url.searchParams.get("error")) goto("/servers", { replaceState: true });
	});

	const features = [
		{ icon: Sparkles, title: "Chat & voice XP", text: "Members earn XP for chatting and for every 5 minutes in voice." },
		{ icon: ChartColumn, title: "Levels & roles", text: "Level-up cards, automatic level roles and attendance streaks." },
		{ icon: Dices, title: "15 games", text: "Bet XP on slots, blackjack, minesweeper, roulette and more." },
		{ icon: ShoppingBag, title: "XP shop", text: "Spend XP on roles, timed roles and custom rewards." }
	];
</script>

<svelte:head><title>LeaderBoard</title></svelte:head>

<Topbar back={false} />

<main class="hero">
	<img class="logo" src="/favicon.svg" alt="" width="84" height="84" />
	<h1>{session.me?.bot?.name ?? "LeaderBoard"} Dashboard</h1>
	<p class="lead">Manage your server's leveling, games, shop and leaderboards in one place.</p>

	{#if error}
		<div class="warn-box">{error}</div>
	{/if}

	{#if !session.loaded}
		<div class="faint">Loading…</div>
	{:else if session.me?.login_enabled}
		<a class="btn primary big" href={loginUrl("/servers")}><LogIn size={18} /> Log in with Discord</a>
	{:else}
		<div class="warn-box">
			Dashboard login isn't configured yet. The bot owner needs to set <span class="mono">DISCORD_CLIENT_SECRET</span> and
			<span class="mono">DASHBOARD_URL</span> in <span class="mono">.env</span>.
		</div>
	{/if}

	<div class="features">
		{#each features as f}
			<div class="feature">
				<f.icon size={20} />
				<strong>{f.title}</strong>
				<span>{f.text}</span>
			</div>
		{/each}
	</div>
	<div class="faint small"><Mic size={12} /> Only server admins and roles they choose can change settings.</div>
</main>

<style>
	.hero {
		max-width: 860px;
		margin: 0 auto;
		padding: 70px 20px 40px;
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 16px;
	}
	.logo {
		filter: drop-shadow(0 8px 30px rgba(194, 24, 91, 0.35));
	}
	h1 {
		font-size: 30px;
	}
	.lead {
		margin: 0;
		color: var(--muted);
		font-size: 15px;
	}
	.big {
		padding: 12px 22px;
		font-size: 15px;
		margin-top: 8px;
	}
	.features {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 12px;
		margin-top: 36px;
		width: 100%;
	}
	.feature {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
		text-align: left;
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 16px;
		color: var(--muted);
		font-size: 12.5px;
	}
	.feature :global(svg) {
		color: #f06595;
	}
	.feature strong {
		color: var(--text);
		font-size: 14px;
	}
	.small {
		font-size: 12px;
		display: flex;
		align-items: center;
		gap: 5px;
	}
	@media (max-width: 760px) {
		.features {
			grid-template-columns: 1fr 1fr;
		}
	}
</style>
