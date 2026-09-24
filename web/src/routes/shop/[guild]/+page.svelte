<script lang="ts">
	import { page } from "$app/state";
	import { Clock, Gift, LogIn, Package, Settings, Shield } from "@lucide/svelte";
	import { api, type PublicShop } from "$lib/api";
	import Topbar from "$lib/components/Topbar.svelte";
	import { dateTime, fmt } from "$lib/formula";
	import { loginUrl, session } from "$lib/session.svelte";
	import { toast } from "$lib/toast.svelte";

	const guild_id = $derived(page.params.guild);

	let shop = $state<PublicShop | null>(null);
	let error = $state("");
	let busy = $state<number | null>(null);

	async function load() {
		try {
			shop = await api<PublicShop>(`/public/guilds/${guild_id}/shop`);
		} catch (err) {
			error = (err as Error).message;
		}
	}
	$effect(() => {
		void guild_id;
		load();
	});

	const viewer = $derived(shop?.viewer ?? null);
	const member = $derived(viewer && viewer.member ? viewer : null);

	// Bot replies are written for Discord; make them read well on a web page.
	function plain(msg: string): string {
		return msg
			.replace(/<@&\d+>/g, "the role")
			.replace(/<t:(\d+):\w>/g, (_, s) => new Date(Number(s) * 1000).toLocaleString())
			.replace(/\*\*(.+?)\*\*/g, "$1")
			.replace(/`\/shop`/g, "your inventory below");
	}

	async function buy(item_id: number, name: string, price: number) {
		if (!confirm(`Buy "${name}" for ${fmt(price)} ${shop?.xp_name}?`)) return;
		busy = item_id;
		try {
			const r = await api<{ ok: boolean; message: string }>(`/shop/${guild_id}/buy`, { method: "POST", body: { item_id } });
			toast(plain(r.message), r.ok ? "success" : "error", 6000);
			await load();
		} catch (err) {
			toast((err as Error).message, "error");
		} finally {
			busy = null;
		}
	}

	async function use(purchase_id: number) {
		busy = -purchase_id;
		try {
			const r = await api<{ ok: boolean; message: string }>(`/shop/${guild_id}/use`, { method: "POST", body: { purchase_id } });
			toast(plain(r.message), r.ok ? "success" : "error", 6000);
			await load();
		} catch (err) {
			toast((err as Error).message, "error");
		} finally {
			busy = null;
		}
	}

	function kind(type: string, hours: number): string {
		if (type === "role") return "Role";
		if (type === "timed_role") return hours % 24 === 0 ? `Role · ${hours / 24} day${hours === 24 ? "" : "s"}` : `Role · ${hours}h`;
		return "Item";
	}
</script>

<svelte:head><title>{shop ? `${shop.guild.name} XP Shop` : "XP Shop"}</title></svelte:head>

<Topbar />

<main>
	{#if error}
		<div class="warn-box">{error}</div>
	{:else if !shop}
		<div class="faint center">Loading…</div>
	{:else}
		<header>
			{#if shop.guild.icon}<img class="icon" src={shop.guild.icon} alt="" />{:else}<div class="icon ph">{shop.guild.name[0]}</div>{/if}
			<div class="spacer">
				<h1>{shop.guild.name} <span class="muted">XP Shop</span></h1>
				{#if member}
					<div class="balance">👛 {fmt(member.balance)} {shop.xp_name} · {member.name}</div>
				{:else if viewer && !viewer.member}
					<div class="faint">You're logged in, but not a member of this server.</div>
				{:else}
					<div class="faint">Browse freely — log in to buy.</div>
				{/if}
			</div>
			{#if member?.is_admin}
				<a class="btn" href="/dashboard/{shop.guild.id}/shop"><Settings size={14} /> Manage products</a>
			{/if}
			{#if !viewer && session.me?.login_enabled}
				<a class="btn primary" href={loginUrl()}><LogIn size={14} /> Log in to buy</a>
			{/if}
		</header>

		{#if shop.items.length}
			<div class="items">
				{#each shop.items as item (item.id)}
					{@const affordable = member ? member.balance >= item.price : false}
					<article class="item">
						<div class="emoji">{item.emoji || (item.type === "item" ? "🎁" : "🏷️")}</div>
						<h3>{item.name}</h3>
						{#if item.description}<p>{item.description}</p>{/if}
						<div class="meta">
							{#if item.type === "item"}<Gift size={12} />{:else if item.type === "timed_role"}<Clock size={12} />{:else}<Shield size={12} />{/if}
							{kind(item.type, item.duration_hours)}
							{#if item.role}<span class="role" style:color={item.role.color ?? "inherit"}>@{item.role.name}</span>{/if}
						</div>
						<div class="meta faint">
							{item.stock < 0 ? "Unlimited stock" : `${item.stock} left`}{item.per_user_limit ? ` · max ${item.per_user_limit} per person` : ""}
						</div>
						<div class="buy">
							<span class="price">{fmt(item.price)} {shop.xp_name}</span>
							{#if member}
								<button class="btn primary sm" disabled={busy !== null || item.stock === 0 || !affordable} onclick={() => buy(item.id, item.name, item.price)}>
									{item.stock === 0 ? "Sold out" : affordable ? "Buy" : `Need ${fmt(item.price - member.balance)} more`}
								</button>
							{:else if !viewer}
								<a class="btn sm" href={loginUrl()}>Log in to buy</a>
							{/if}
						</div>
					</article>
				{/each}
			</div>
		{:else}
			<div class="empty center"><Package size={20} /><br />The shop is empty right now.</div>
		{/if}

		{#if member}
			<section class="inventory">
				<h2>Your inventory</h2>
				{#if member.inventory.length}
					{#each member.inventory as p (p.id)}
						<div class="inv">
							<strong>{p.item_name}</strong>
							<span class="faint spacer">
								{#if p.status === "owned"}Ready to use
								{:else if p.status === "requested"}⏳ Waiting for an admin
								{:else if p.expires_at}Active until {dateTime(p.expires_at)}
								{:else}Active{/if}
							</span>
							{#if p.status === "owned"}
								<button class="btn sm primary" disabled={busy !== null} onclick={() => use(p.id)}>Use</button>
							{/if}
						</div>
					{/each}
				{:else}
					<div class="faint">Nothing here yet.</div>
				{/if}
			</section>
		{/if}
	{/if}
</main>

<style>
	main {
		max-width: 1000px;
		margin: 0 auto;
		padding: 28px 16px 50px;
	}
	.center {
		text-align: center;
		padding: 40px 0;
	}
	header {
		display: flex;
		align-items: center;
		gap: 14px;
		margin-bottom: 22px;
		flex-wrap: wrap;
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
		font-weight: 600;
	}
	h1 .muted {
		font-weight: 400;
	}
	.balance {
		margin-top: 4px;
		color: #ffd43b;
		font-weight: 600;
	}
	.items {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 12px;
	}
	.item {
		display: flex;
		flex-direction: column;
		gap: 6px;
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 16px;
	}
	.emoji {
		font-size: 28px;
	}
	.item h3 {
		font-size: 15px;
	}
	.item p {
		margin: 0;
		color: var(--muted);
		font-size: 12.5px;
	}
	.meta {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		color: var(--muted);
		flex-wrap: wrap;
	}
	.role {
		font-weight: 600;
	}
	.buy {
		margin-top: auto;
		padding-top: 10px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.price {
		font-weight: 700;
		color: #ffd43b;
	}
	.inventory {
		margin-top: 28px;
	}
	.inventory h2 {
		font-size: 16px;
		margin-bottom: 10px;
	}
	.inv {
		display: flex;
		align-items: center;
		gap: 12px;
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 10px 14px;
		margin-bottom: 8px;
	}
</style>
