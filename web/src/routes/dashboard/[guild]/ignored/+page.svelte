<script lang="ts">
	import { Pencil, Plus, Trash2 } from "@lucide/svelte";
	import type { Ignore } from "$lib/api";
	import Card from "$lib/components/Card.svelte";
	import Modal from "$lib/components/Modal.svelte";
	import OptionIcon from "$lib/components/OptionIcon.svelte";
	import Select, { type Option } from "$lib/components/Select.svelte";
	import { Autosave, useGuild } from "$lib/guild.svelte";

	const g = useGuild();
	const s = new Autosave(g, "ignores");

	let open = $state(false);
	let editing = $state<number | null>(null);
	let pick = $state<string | null>(null);

	// One picker for everything that can be ignored.
	const options = $derived.by((): Option[] => {
		const taken = new Set(s.value.map(i => i.id));
		const channels = g.channels
			.filter(c => c.type !== "category")
			.map((c): Option => ({ value: c.id, label: c.name, kind: c.type, group: "Channels" }));
		const cats = g.channels
			.filter(c => c.type === "category")
			.map((c): Option => ({ value: c.id, label: c.name, kind: "category", group: "Categories" }));
		const roles = g.roles
			.filter(r => !r.managed)
			.map((r): Option => ({ value: r.id, label: r.name, kind: "role", color: r.color, group: "Roles" }));
		return [...channels, ...cats, ...roles].filter(o => !taken.has(o.value) || o.value === (editing !== null ? s.value[editing]?.id : null));
	});

	function optionFor(i: Ignore): Option {
		if (i.type === "role") {
			const r = g.role(i.id);
			return { value: i.id, label: r?.name ?? "deleted role", kind: "role", color: r?.color };
		}
		const c = g.channel(i.id);
		return { value: i.id, label: c?.name ?? "deleted channel", kind: c?.type ?? "text" };
	}

	function start(i: number | null) {
		editing = i;
		pick = i === null ? null : s.value[i].id;
		open = true;
	}

	function commit(id: string | null) {
		if (!id) return;
		const type: Ignore["type"] = g.role(id) ? "role" : g.channel(id)?.type === "category" ? "category" : "channel";
		if (editing !== null) s.value[editing] = { type, id };
		else s.value.push({ type, id });
		open = false;
	}
</script>

<svelte:head><title>Ignored · {g.guild.name}</title></svelte:head>

<div class="page-head">
	<h1>Ignored</h1>
	<p>Exclude specific channels, roles, or categories from XP gains.</p>
</div>

<Card title="Ignores" desc="Roles/channels/categories that will be ignored">
	<div class="grid-tiles">
		{#each s.value as item, i (item.id)}
			{@const o = optionFor(item)}
			<div class="tile">
				<span class="center"><OptionIcon option={o} /><span class="name">{o.label}</span></span>
				<span class="kind faint">{item.type}</span>
				<button class="btn icon" onclick={() => start(i)} aria-label="Edit"><Pencil size={14} /></button>
				<button class="btn icon" onclick={() => s.value.splice(i, 1)} aria-label="Remove"><Trash2 size={14} /></button>
			</div>
		{/each}
		<button class="add-tile small" onclick={() => start(null)}><Plus size={16} /> Add</button>
	</div>
	<div class="hint">Ignoring a category covers every channel in it. Members with an ignored role earn no chat or voice XP anywhere.</div>
</Card>

{#if open}
	<Modal title={editing === null ? "Add Ignore" : "Edit Ignore"} onclose={() => (open = false)}>
		<Select bind:value={pick} {options} allowNone={false} placeholder="None" onpick={commit} />
	</Modal>
{/if}

<style>
	.grid-tiles {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: 10px;
	}
	.tile {
		display: flex;
		align-items: center;
		gap: 4px;
		background: var(--input);
		border: 1px solid var(--input-border);
		border-radius: 8px;
		padding: 7px 8px 7px 14px;
		min-width: 0;
	}
	.center {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-width: 0;
		font-weight: 500;
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.kind {
		font-size: 10.5px;
		text-transform: uppercase;
		letter-spacing: 0.4px;
	}
	.add-tile.small {
		min-height: 40px;
		max-width: none;
	}
</style>
