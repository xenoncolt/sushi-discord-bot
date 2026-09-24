<script lang="ts">
	import { CalendarClock, Folder, Globe, Hash, Pencil, Plus, Sun, Trash2, Volume2 } from "@lucide/svelte";
	import type { Boost } from "$lib/api";
	import Card from "$lib/components/Card.svelte";
	import ChannelSelect from "$lib/components/ChannelSelect.svelte";
	import Modal from "$lib/components/Modal.svelte";
	import NumberInput from "$lib/components/NumberInput.svelte";
	import RoleSelect from "$lib/components/RoleSelect.svelte";
	import Segmented from "$lib/components/Segmented.svelte";
	import Toggle from "$lib/components/Toggle.svelte";
	import { dateTime, fmt } from "$lib/formula";
	import { Autosave, useGuild } from "$lib/guild.svelte";
	import { toast } from "$lib/toast.svelte";

	const g = useGuild();
	const s = new Autosave(g, "boosts");

	let open = $state(false);
	let editing = $state<number | null>(null);
	let type = $state<Boost["type"]>("all");
	let target = $state<string | null>(null);
	let amount = $state(5);
	let expires = $state(false);
	let expires_at = $state("");

	function toLocalInput(ms: number): string {
		const d = new Date(ms - new Date().getTimezoneOffset() * 60000);
		return d.toISOString().slice(0, 16);
	}

	function start(i: number | null) {
		editing = i;
		const b = i === null ? null : s.value[i];
		type = b?.type ?? "all";
		target = b?.target_id ?? null;
		amount = b?.amount ?? 5;
		expires = !!b?.expires_at;
		expires_at = b?.expires_at ? toLocalInput(b.expires_at) : toLocalInput(Date.now() + 7 * 86400000);
		open = true;
	}

	function plusDays(days: number) {
		expires = true;
		const base = expires_at ? new Date(expires_at).getTime() : Date.now();
		expires_at = toLocalInput(Math.max(base, Date.now()) + days * 86400000);
	}

	function save() {
		if ((type === "role" || type === "channel" || type === "category") && !target) return toast(`Pick a ${type} first.`, "error");
		if (amount === 0) return toast("The XP amount can't be 0.", "error");
		const at = expires && expires_at ? new Date(expires_at).getTime() : null;
		if (at !== null && at <= Date.now()) return toast("The expiry is in the past.", "error");
		const boost: Boost = {
			id: editing !== null ? s.value[editing].id : `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`,
			type,
			// A daily boost's target is an optional role; anything else left over
			// from switching types is dropped.
			target_id: type === "all" ? null : type === "daily" ? (g.role(target) ? target : null) : target,
			amount,
			expires_at: at
		};
		if (editing !== null) s.value[editing] = boost;
		else s.value.push(boost);
		open = false;
	}

	function label(b: Boost): string {
		switch (b.type) {
			case "all": return "Global";
			case "daily": return b.target_id ? `Daily check-in · @${g.role(b.target_id)?.name ?? "deleted role"}` : "Daily check-in";
			case "role": return `@${g.role(b.target_id)?.name ?? "deleted role"}`;
			default: return g.channel(b.target_id)?.name ?? "deleted channel";
		}
	}

	const now = Date.now();
</script>

<svelte:head><title>Boosts · {g.guild.name}</title></svelte:head>

<div class="page-head">
	<h1>Boosts</h1>
	<p>Set up XP boosts for roles, channels, and categories.</p>
</div>

<Card title="Boosts" desc="Bonus targets/amount/expires — the amount is added on top of every matching XP gain">
	<div class="list">
		{#each s.value as b, i (b.id)}
			{@const expired = b.expires_at !== null && b.expires_at <= now}
			<div class="boost" class:expired>
				<span class="kind">
					{#if b.type === "all"}<Globe size={15} />{:else if b.type === "daily"}<Sun size={15} />{:else if b.type === "role"}<span class="dot" style:background={g.role(b.target_id)?.color ?? "#7b7f86"}></span>{:else if b.type === "category"}<Folder size={15} />{:else if g.channel(b.target_id)?.type === "voice"}<Volume2 size={15} />{:else}<Hash size={15} />{/if}
				</span>
				<div class="what">
					<strong>{label(b)}</strong>
					<span class="faint">{b.type === "daily" ? (b.target_id ? "Extra /daily XP for this role" : "Extra /daily XP for everyone") : b.type === "all" ? "Every chat & voice XP gain" : `${b.type[0].toUpperCase()}${b.type.slice(1)} boost`}</span>
				</div>
				<span class="amt" class:neg={b.amount < 0}>{b.amount < 0 ? "−" : "+"}{fmt(Math.abs(b.amount))} XP</span>
				<span class="exp">
					<CalendarClock size={13} />
					{b.expires_at ? (expired ? "Expired" : dateTime(b.expires_at)) : "Never expires"}
				</span>
				<button class="btn icon" onclick={() => start(i)} aria-label="Edit"><Pencil size={14} /></button>
				<button class="btn icon" onclick={() => s.value.splice(i, 1)} aria-label="Delete"><Trash2 size={14} /></button>
			</div>
		{/each}
	</div>
	<button class="add-tile" onclick={() => start(null)}><Plus size={16} /> Add</button>
</Card>

{#if open}
	<Modal title={editing === null ? "Add Boost" : "Edit Boost"} onclose={() => (open = false)}>
		<div class="stack">
			<div>
				<span class="label">Boost Type</span>
				<Segmented
					bind:value={type}
					size="sm"
					options={[
						{ value: "all", label: "Global" },
						{ value: "role", label: "Role" },
						{ value: "channel", label: "Channel" },
						{ value: "category", label: "Category" },
						{ value: "daily", label: "Daily" }
					]}
				/>
			</div>

			{#if type === "role"}
				<RoleSelect bind:value={target} allowNone={false} placeholder="None" />
			{:else if type === "daily"}
				<div>
					<span class="label">Who gets it</span>
					<RoleSelect bind:value={target} allowNone noneLabel="Everyone" placeholder="Everyone" />
				</div>
			{:else if type === "channel"}
				<ChannelSelect bind:value={target} types={["text", "announcement", "voice", "stage", "forum"]} allowNone={false} />
			{:else if type === "category"}
				<ChannelSelect bind:value={target} types={["category"]} allowNone={false} />
			{/if}

			<div>
				<label class="label" for="amount">XP Amount</label>
				<div class="row">
					<NumberInput id="amount" bind:value={amount} min={-100000} max={100000} placeholder="XP" />
					<span class="muted">XP</span>
				</div>
				<div class="hint">Boosts stack. A negative amount lowers XP instead (never below 0). To block XP completely, use Ignored.</div>
			</div>

			<div>
				<div class="row">
					<span class="label" style="margin: 0">Expires</span>
					<span class="spacer"></span>
					<Toggle bind:checked={expires} label="Expires" />
				</div>
				<input class="input" type="datetime-local" bind:value={expires_at} disabled={!expires} style="margin-top: 8px" />
				<div class="row wrap" style="margin-top: 8px">
					{#each [7, 30, 90, 365] as d}
						<button class="btn sm" onclick={() => plusDays(d)}>+{d}d</button>
					{/each}
				</div>
			</div>

			<div class="row" style="justify-content: flex-end">
				<button class="btn primary" onclick={save}>{editing === null ? "Add" : "Save"}</button>
			</div>
		</div>
	</Modal>
{/if}

<style>
	.list {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-bottom: 10px;
		max-width: 840px;
	}
	.list:empty {
		display: none;
	}
	.boost {
		display: flex;
		align-items: center;
		gap: 12px;
		background: var(--input);
		border: 1px solid var(--input-border);
		border-radius: 8px;
		padding: 10px 12px;
	}
	.boost.expired {
		opacity: 0.5;
	}
	.kind {
		width: 20px;
		display: grid;
		place-items: center;
		color: var(--muted);
	}
	.dot {
		width: 11px;
		height: 11px;
		border-radius: 50%;
	}
	.what {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.what strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.what span {
		font-size: 12px;
	}
	.amt {
		font-weight: 700;
		color: #69db7c;
	}
	.amt.neg {
		color: #ff8787;
	}
	.exp {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		color: var(--muted);
		min-width: 130px;
	}
	@media (max-width: 600px) {
		.exp {
			display: none;
		}
	}
</style>
