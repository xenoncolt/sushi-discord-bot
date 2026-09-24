<script lang="ts">
	import { ChevronLeft, LogIn, LogOut } from "@lucide/svelte";
	import { loginUrl, logout, session } from "$lib/session.svelte";

	let { back = true }: { back?: boolean } = $props();
	let menu = $state(false);
	const user = $derived(session.me?.user ?? null);
</script>

<svelte:window onclick={() => (menu = false)} />

<header class="topbar">
	<div class="left">
		{#if back && user}
			<a class="back" href="/servers"><ChevronLeft size={16} /> Servers</a>
			<span class="divider"></span>
		{/if}
		<a class="brand" href={user ? "/servers" : "/"}>
			<img src="/favicon.svg" alt="" width="26" height="26" />
			<span>LeaderBoard</span>
		</a>
	</div>
	<div class="right">
		{#if user}
			<button class="user" onclick={e => { e.stopPropagation(); menu = !menu; }}>
				<img class="avatar" src={user.avatar} alt="" width="28" height="28" />
				<span>{user.global_name ?? user.username}</span>
			</button>
			{#if menu}
				<div class="menu">
					<button onclick={logout}><LogOut size={14} /> Log out</button>
				</div>
			{/if}
		{:else if session.loaded && session.me?.login_enabled}
			<a class="btn primary sm" href={loginUrl()}><LogIn size={14} /> Log in</a>
		{/if}
	</div>
</header>

<style>
	.topbar {
		position: sticky;
		top: 0;
		z-index: 30;
		height: 52px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 20px;
		background: var(--bg-deep);
		border-bottom: 1px solid #2a2c30;
	}
	.left,
	.right {
		display: flex;
		align-items: center;
		gap: 12px;
		position: relative;
	}
	.back {
		display: flex;
		align-items: center;
		gap: 4px;
		color: var(--muted);
		font-size: 13px;
	}
	.back:hover {
		color: var(--text);
	}
	.divider {
		width: 1px;
		height: 20px;
		background: #3a3d42;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 8px;
		font-weight: 600;
		font-size: 15px;
	}
	.user {
		display: flex;
		align-items: center;
		gap: 8px;
		border: 0;
		background: transparent;
		font-size: 13px;
		color: var(--muted);
	}
	.user .avatar {
		width: 28px;
		height: 28px;
	}
	.menu {
		position: absolute;
		right: 0;
		top: 40px;
		background: #2b2e32;
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 4px;
		min-width: 140px;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
	}
	.menu button {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		border: 0;
		background: transparent;
		padding: 8px 10px;
		border-radius: 5px;
		font-size: 13px;
	}
	.menu button:hover {
		background: rgba(255, 255, 255, 0.06);
	}
	@media (max-width: 600px) {
		.topbar {
			padding: 0 12px;
		}
		.user span {
			display: none;
		}
	}
</style>
