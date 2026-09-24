<script lang="ts">
	import { page } from "$app/state";
	import {
		AtSign, Ban, Cake, ChartColumn, ChartNoAxesColumn, ChevronsUp, CircleAlert, ClipboardList, Dices, History,
		Menu, Megaphone, MessageSquarePlus, RefreshCw, ShoppingBag, Sprout, Store, TrendingUp, UserPlus, X
	} from "@lucide/svelte";
	import { api, ApiError, type Channel, type GuildInfo, type Role, type Settings } from "$lib/api";
	import Topbar from "$lib/components/Topbar.svelte";
	import { GuildContext, provideGuild } from "$lib/guild.svelte";
	import { loginUrl } from "$lib/session.svelte";

	let { children } = $props();

	let ctx = $state<GuildContext | null>(null);
	let error = $state("");
	let open = $state(false);

	// Context has to be provided during init, so it's a stable wrapper whose
	// contents are swapped when the server changes.
	const holder = new GuildContext(
		{ id: "", name: "", icon: null, member_count: 0, access: "manager", bot: { can_manage_roles: false, highest_role: 0 } },
		{} as Settings,
		[],
		[]
	);
	provideGuild(holder);

	const guild_id = $derived(page.params.guild);

	$effect(() => {
		const id = guild_id;
		ctx = null;
		error = "";
		Promise.all([
			api<GuildInfo>(`/guilds/${id}`),
			api<Settings>(`/guilds/${id}/settings`),
			api<Channel[]>(`/guilds/${id}/channels`),
			api<Role[]>(`/guilds/${id}/roles`)
		])
			.then(([guild, settings, channels, roles]) => {
				holder.guild = guild;
				holder.settings = settings;
				holder.channels = channels;
				holder.roles = roles;
				ctx = holder;
			})
			.catch(err => {
				if (err instanceof ApiError && err.status === 401) location.href = loginUrl();
				else error = err.message;
			});
	});

	const menu = [
		{ href: "server", label: "Server", icon: TrendingUp },
		{ href: "level", label: "Level", icon: Sprout },
		{ href: "roles", label: "Roles", icon: AtSign },
		{ href: "boosts", label: "Boosts", icon: ChevronsUp },
		{ href: "ignored", label: "Ignored", icon: Ban },
		{ href: "notifications", label: "Notifications", icon: Megaphone },
		{ href: "messages", label: "Messages", icon: MessageSquarePlus },
		{ href: "welcome", label: "Welcome", icon: UserPlus },
		{ href: "birthday", label: "Birthday", icon: Cake },
		{ href: "applications", label: "Applications", icon: ClipboardList },
		{ href: "gamble", label: "Gamble", icon: Dices },
		{ href: "leaderboard", label: "Leaderboard", icon: ChartColumn },
		{ href: "season", label: "Season", icon: RefreshCw },
		{ href: "statistics", label: "Statistics", icon: ChartNoAxesColumn },
		{ href: "activity", label: "Activity", icon: History },
		{ href: "shop", label: "Shop", icon: ShoppingBag }
	];

	const current = $derived(page.url.pathname.split("/")[3] ?? "server");
</script>

<Topbar />

{#if error}
	<div class="center"><div class="warn-box">{error}</div><a class="btn" href="/servers">Back to servers</a></div>
{:else if !ctx}
	<div class="center faint">Loading server…</div>
{:else}
	<div class="shell">
		<button class="mobile-toggle btn" onclick={() => (open = !open)} aria-label="Menu">
			{#if open}<X size={16} />{:else}<Menu size={16} />{/if}
			{menu.find(m => m.href === current)?.label ?? "Menu"}
		</button>

		<aside class:open>
			<div class="guild">
				{#if ctx.guild.icon}<img src={ctx.guild.icon} alt="" />{:else}<div class="ph">{ctx.guild.name[0]}</div>{/if}
				<div>
					<strong>{ctx.guild.name}</strong>
					<span>Server Settings</span>
				</div>
			</div>

			<div class="section">Menu</div>
			<nav>
				{#each menu as m (m.href)}
					<a href="/dashboard/{ctx.guild.id}/{m.href}" class:active={current === m.href} onclick={() => (open = false)}>
						<m.icon size={15} />
						<span>{m.label}</span>
					</a>
				{/each}
			</nav>

			<div class="links">
				<div class="section">Links</div>
				<nav>
					<a href="/leaderboard/{ctx.guild.id}" target="_blank" rel="noopener"><ChartColumn size={15} /><span>Leaderboard</span></a>
					<a href="/shop/{ctx.guild.id}" target="_blank" rel="noopener"><Store size={15} /><span>Exp Shop</span></a>
					<a href="/dashboard/{ctx.guild.id}/reset" class:active={current === "reset"} onclick={() => (open = false)}><CircleAlert size={15} /><span>Reset</span></a>
				</nav>
			</div>
		</aside>

		<main>
			{#key ctx.guild.id}
				{@render children()}
			{/key}
		</main>
	</div>
{/if}

<style>
	.center {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 14px;
		padding: 80px 20px;
	}
	.shell {
		display: flex;
		min-height: calc(100vh - 52px);
	}
	aside {
		width: 220px;
		flex: none;
		background: var(--bg-deep);
		border-right: 1px solid #2a2c30;
		display: flex;
		flex-direction: column;
		padding: 14px 10px;
		position: sticky;
		top: 52px;
		height: calc(100vh - 52px);
		overflow-y: auto;
	}
	.guild {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 4px 6px 14px;
	}
	.guild img,
	.guild .ph {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		flex: none;
	}
	.guild .ph {
		display: grid;
		place-items: center;
		background: #3a3d42;
	}
	.guild div {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.guild strong {
		font-size: 13px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.guild span {
		font-size: 11px;
		color: var(--muted);
	}
	.section {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.8px;
		text-transform: uppercase;
		color: var(--muted);
		padding: 8px 8px 6px;
	}
	nav {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	nav a {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 10px;
		border-radius: 6px;
		color: var(--muted);
		font-size: 13px;
		transition: background 0.12s, color 0.12s;
	}
	nav a:hover {
		color: var(--text);
		background: rgba(255, 255, 255, 0.04);
	}
	nav a.active {
		background: var(--accent-grad);
		color: #fff;
	}
	.links {
		margin-top: auto;
		padding-top: 16px;
	}
	main {
		flex: 1;
		min-width: 0;
		padding: 28px 30px 60px;
	}
	.mobile-toggle {
		display: none;
	}
	@media (max-width: 900px) {
		.shell {
			flex-direction: column;
		}
		.mobile-toggle {
			display: inline-flex;
			margin: 12px 16px 0;
			align-self: flex-start;
		}
		aside {
			display: none;
			position: static;
			width: auto;
			height: auto;
			margin: 8px 16px 0;
			border: 1px solid var(--border);
			border-radius: 10px;
		}
		aside.open {
			display: flex;
		}
		.links {
			margin-top: 10px;
		}
		main {
			padding: 18px 16px 50px;
		}
	}
</style>
