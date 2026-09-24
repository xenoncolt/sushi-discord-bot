<script lang="ts">
	import { goto } from "$app/navigation";
	import { ExternalLink, Plus, Settings } from "@lucide/svelte";
	import { api, ApiError } from "$lib/api";
	import Topbar from "$lib/components/Topbar.svelte";
	import { loginUrl } from "$lib/session.svelte";

	interface Guilds {
		manageable: { id: string; name: string; icon: string | null; access: string; member_count: number }[];
		invitable: { id: string; name: string; icon: string | null; invite_url: string }[];
	}

	let data = $state<Guilds | null>(null);
	let error = $state("");

	api<Guilds>("/guilds")
		.then(d => {
			data = d;
			if (d.manageable.length === 1 && !d.invitable.length) goto(`/dashboard/${d.manageable[0].id}/server`, { replaceState: true });
		})
		.catch(err => {
			if (err instanceof ApiError && err.status === 401) location.href = loginUrl("/servers");
			else error = err.message;
		});

	function initials(name: string): string {
		return name.split(/\s+/).map(w => w[0]).join("").slice(0, 3);
	}
</script>

<svelte:head><title>Servers · LeaderBoard</title></svelte:head>

<Topbar back={false} />

<main>
	<div class="page-head">
		<h1>Select a server</h1>
		<p>Servers where you're an admin (or hold one of the dashboard's Admin Roles).</p>
	</div>

	{#if error}
		<div class="warn-box">{error}</div>
	{:else if !data}
		<div class="faint">Loading servers…</div>
	{:else}
		<div class="servers">
			{#each data.manageable as g (g.id)}
				<a class="server" href="/dashboard/{g.id}/server">
					{#if g.icon}<img src={g.icon} alt="" />{:else}<div class="ph">{initials(g.name)}</div>{/if}
					<div class="meta">
						<strong>{g.name}</strong>
						<span>{g.member_count.toLocaleString()} members · {g.access === "admin" ? "Admin" : "Manager"}</span>
					</div>
					<span class="btn primary sm"><Settings size={13} /> Manage</span>
				</a>
			{/each}
			{#each data.invitable as g (g.id)}
				<a class="server dim" href={g.invite_url} target="_blank" rel="noopener">
					{#if g.icon}<img src={g.icon} alt="" />{:else}<div class="ph">{initials(g.name)}</div>{/if}
					<div class="meta">
						<strong>{g.name}</strong>
						<span>Bot not added yet</span>
					</div>
					<span class="btn sm"><Plus size={13} /> Add bot <ExternalLink size={11} /></span>
				</a>
			{/each}
		</div>
		{#if !data.manageable.length && !data.invitable.length}
			<div class="empty">You don't manage any servers the bot is in.</div>
		{/if}
	{/if}
</main>

<style>
	main {
		max-width: 1000px;
		margin: 0 auto;
		padding: 32px 20px;
	}
	.servers {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
		gap: 12px;
	}
	.server {
		display: flex;
		align-items: center;
		gap: 12px;
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 14px;
		transition: border-color 0.15s, background 0.15s;
	}
	.server:hover {
		border-color: rgba(194, 24, 91, 0.6);
		background: var(--card-hover);
	}
	.server.dim {
		opacity: 0.7;
	}
	img,
	.ph {
		width: 46px;
		height: 46px;
		border-radius: 50%;
		flex: none;
	}
	.ph {
		display: grid;
		place-items: center;
		background: #3a3d42;
		font-weight: 600;
		font-size: 14px;
	}
	.meta {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.meta strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.meta span {
		color: var(--faint);
		font-size: 12px;
	}
</style>
