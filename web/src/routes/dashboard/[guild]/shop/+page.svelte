<script lang="ts">
	import { Clock, Gift, Pencil, Plus, Shield, Trash2 } from "@lucide/svelte";
	import { api, type Purchase, type ShopItem } from "$lib/api";
	import Card from "$lib/components/Card.svelte";
	import Modal from "$lib/components/Modal.svelte";
	import NumberInput from "$lib/components/NumberInput.svelte";
	import RoleSelect from "$lib/components/RoleSelect.svelte";
	import Segmented from "$lib/components/Segmented.svelte";
	import Toggle from "$lib/components/Toggle.svelte";
	import { dateTime, fmt } from "$lib/formula";
	import { useGuild } from "$lib/guild.svelte";
	import { toast } from "$lib/toast.svelte";

	const g = useGuild();
	const xp_name = $derived(g.settings.server.xp_name);

	let items = $state<ShopItem[]>([]);
	let purchases = $state<Purchase[]>([]);
	let loaded = $state(false);

	async function load() {
		[items, purchases] = await Promise.all([
			api<ShopItem[]>(`/guilds/${g.guild.id}/shop/items`),
			api<Purchase[]>(`/guilds/${g.guild.id}/shop/purchases`)
		]);
		loaded = true;
	}
	load().catch(err => toast(err.message, "error"));

	type Draft = Omit<ShopItem, "id" | "enabled"> & { enabled: boolean };
	const blank = (): Draft => ({ name: "", description: "", emoji: "", price: 1000, type: "role", role_id: null, duration_hours: 168, stock: -1, per_user_limit: 0, enabled: true, sort: 0 });

	let editing = $state<number | null>(null);
	let draft = $state<Draft | null>(null);
	let unit = $state<"hours" | "days">("days");
	let busy = $state(false);

	function open(item: ShopItem | null) {
		editing = item?.id ?? null;
		draft = item ? { ...item, enabled: !!item.enabled } : blank();
		unit = draft.duration_hours % 24 === 0 ? "days" : "hours";
	}

	function getDuration(): number {
		return draft ? (unit === "days" ? draft.duration_hours / 24 : draft.duration_hours) : 0;
	}
	function setDuration(v: number): void {
		if (draft) draft.duration_hours = unit === "days" ? v * 24 : v;
	}

	async function save() {
		if (!draft) return;
		busy = true;
		try {
			const path = `/guilds/${g.guild.id}/shop/items${editing !== null ? `/${editing}` : ""}`;
			await api(path, { method: editing !== null ? "PUT" : "POST", body: draft });
			toast(editing !== null ? "Item updated" : "Item added");
			draft = null;
			await load();
		} catch (err) {
			toast((err as Error).message, "error");
		} finally {
			busy = false;
		}
	}

	async function remove(item: ShopItem) {
		if (!confirm(`Remove "${item.name}" from the shop? People who already bought it keep it.`)) return;
		try {
			await api(`/guilds/${g.guild.id}/shop/items/${item.id}`, { method: "DELETE" });
			toast("Item removed");
			await load();
		} catch (err) {
			toast((err as Error).message, "error");
		}
	}

	function kind(i: ShopItem): string {
		if (i.type === "role") return "Role";
		if (i.type === "timed_role") return i.duration_hours % 24 === 0 ? `Role · ${i.duration_hours / 24}d` : `Role · ${i.duration_hours}h`;
		return "Custom item";
	}

	const STATUS: Record<string, string> = {
		active: "Active",
		expired: "Expired",
		owned: "In inventory",
		requested: "Waiting for admin",
		fulfilled: "Fulfilled",
		refunded: "Refunded"
	};
</script>

<svelte:head><title>Exp Shop · {g.guild.name}</title></svelte:head>

<div class="page-head">
	<a class="btn" style="float: right" href="/shop/{g.guild.id}" target="_blank" rel="noopener">View the public shop</a>
	<h1>Exp Shop</h1>
	<p>Items members buy with {xp_name} on the web shop (linked from <span class="mono">/shop</span>). Spending {xp_name} lowers their level, just like losing it in a game.</p>
</div>

{#if !g.isAdmin}
	<div class="warn-box" style="margin-bottom: 14px">Shop management is limited to server admins. You can see the items and purchases.</div>
{/if}

<div class="stack">
	<Card title="Items" desc="Roles, timed roles that are taken back when they expire, or custom rewards that admins hand out.">
		{#if !loaded}
			<div class="empty">Loading…</div>
		{:else}
			<div class="items">
				{#each items as i (i.id)}
					<div class="item" class:off={!i.enabled}>
						<span class="emoji">{i.emoji || (i.type === "item" ? "🎁" : "🏷️")}</span>
						<div class="info">
							<strong>{i.name}</strong>
							<span class="faint">
								{kind(i)}{#if i.role_id} · <span style:color={g.role(i.role_id)?.color ?? "inherit"}>@{g.role(i.role_id)?.name ?? "deleted role"}</span>{/if}
								{#if i.stock >= 0} · {i.stock} left{/if}
								{#if i.per_user_limit} · max {i.per_user_limit}/person{/if}
								{#if !i.enabled} · hidden{/if}
							</span>
						</div>
						<span class="price">{fmt(i.price)} {xp_name}</span>
						{#if g.isAdmin}
							<button class="btn icon" onclick={() => open(i)} aria-label="Edit"><Pencil size={14} /></button>
							<button class="btn icon" onclick={() => remove(i)} aria-label="Delete"><Trash2 size={14} /></button>
						{/if}
					</div>
				{/each}
			</div>
			{#if g.isAdmin}
				<button class="add-tile" onclick={() => open(null)}><Plus size={16} /> Add item</button>
			{:else if !items.length}
				<div class="empty">The shop is empty.</div>
			{/if}
		{/if}
	</Card>

	<Card title="Recent purchases" desc="Custom items show up in the Shop Admin Log channel (Notifications page) when a member uses them.">
		{#if purchases.length}
			<div style="overflow-x: auto">
				<table class="table">
					<thead><tr><th>Member</th><th>Item</th><th>Price</th><th>Status</th><th>When</th></tr></thead>
					<tbody>
						{#each purchases as p (p.id)}
							<tr>
								<td>{p.user_name}</td>
								<td>{p.item_name}</td>
								<td>{fmt(p.price)}</td>
								<td>{STATUS[p.status] ?? p.status}{#if p.status === "active" && p.expires_at}<span class="faint"> · until {dateTime(p.expires_at)}</span>{/if}</td>
								<td class="faint">{dateTime(p.created_at)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<div class="empty">No purchases yet.</div>
		{/if}
	</Card>
</div>

{#if draft}
	<Modal title={editing !== null ? "Edit item" : "Add item"} onclose={() => (draft = null)} width={500}>
		<div class="stack">
			<div>
				<span class="label">Type</span>
				<Segmented
					bind:value={draft.type}
					options={[
						{ value: "role", label: "Role" },
						{ value: "timed_role", label: "Timed role" },
						{ value: "item", label: "Custom item" }
					]}
				/>
				<div class="hint">
					{#if draft.type === "role"}<Shield size={11} /> Gives the role permanently.
					{:else if draft.type === "timed_role"}<Clock size={11} /> Gives the role, then takes it back when time runs out. Buying again extends it.
					{:else}<Gift size={11} /> Goes to the member's inventory. When they use it, admins get a request to fulfil (e.g. a custom colour or a shout-out).{/if}
				</div>
			</div>
			<div class="row" style="align-items: flex-end">
				<div style="width: 70px">
					<label class="label" for="i-emoji">Emoji</label>
					<input id="i-emoji" class="input" maxlength="8" style="text-align: center" bind:value={draft.emoji} />
				</div>
				<div class="spacer">
					<label class="label" for="i-name">Name</label>
					<input id="i-name" class="input" maxlength="80" bind:value={draft.name} placeholder="VIP role" />
				</div>
			</div>
			<div>
				<label class="label" for="i-desc">Description</label>
				<input id="i-desc" class="input" maxlength="300" bind:value={draft.description} placeholder="Optional" />
			</div>
			{#if draft.type !== "item"}
				<div>
					<span class="label">Role</span>
					<RoleSelect bind:value={draft.role_id} allowNone={false} assignableOnly placeholder="Pick a role" />
				</div>
			{/if}
			{#if draft.type === "timed_role"}
				<div class="row" style="align-items: flex-end">
					<div class="spacer">
						<span class="label">Duration</span>
						<NumberInput bind:value={getDuration, setDuration} min={1} max={unit === "days" ? 365 : 8760} />
					</div>
					<div style="width: 160px"><Segmented bind:value={unit} options={[{ value: "hours", label: "Hours" }, { value: "days", label: "Days" }]} /></div>
				</div>
			{/if}
			<div class="grid grid-3">
				<div>
					<label class="label" for="i-price">Price</label>
					<NumberInput id="i-price" bind:value={draft.price} min={0} max={1000000000} />
				</div>
				<div>
					<label class="label" for="i-stock">Stock</label>
					<NumberInput id="i-stock" bind:value={draft.stock} min={-1} max={1000000} />
					<div class="hint">-1 = unlimited</div>
				</div>
				<div>
					<label class="label" for="i-limit">Per person</label>
					<NumberInput id="i-limit" bind:value={draft.per_user_limit} min={0} max={1000} />
					<div class="hint">0 = no limit</div>
				</div>
			</div>
			<div class="row">
				<Toggle bind:checked={draft.enabled} label="For sale" />
				<span>For sale</span>
				<span class="spacer"></span>
				<button class="btn" onclick={() => (draft = null)}>Cancel</button>
				<button class="btn primary" disabled={busy} onclick={save}>{editing !== null ? "Save" : "Add"}</button>
			</div>
		</div>
	</Modal>
{/if}

<style>
	.items {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-bottom: 10px;
		max-width: 840px;
	}
	.items:empty {
		display: none;
	}
	.item {
		display: flex;
		align-items: center;
		gap: 12px;
		background: var(--input);
		border: 1px solid var(--input-border);
		border-radius: 8px;
		padding: 10px 12px;
	}
	.item.off {
		opacity: 0.55;
	}
	.emoji {
		font-size: 20px;
		width: 28px;
		text-align: center;
	}
	.info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.info span {
		font-size: 12px;
	}
	.price {
		font-weight: 700;
		color: #ffd43b;
		white-space: nowrap;
	}
	.hint :global(svg) {
		vertical-align: -1px;
	}
</style>
