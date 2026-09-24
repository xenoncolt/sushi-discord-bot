<script lang="ts" module>
	export interface Option {
		value: string;
		label: string;
		kind?: "text" | "announcement" | "voice" | "stage" | "category" | "forum" | "role";
		color?: string | null;
		group?: string;
		note?: string;
		disabled?: boolean;
	}
</script>

<script lang="ts">
	import { ChevronDown, Search } from "@lucide/svelte";
	import OptionIcon from "./OptionIcon.svelte";

	let {
		value = $bindable(null),
		options,
		placeholder = "None",
		allowNone = true,
		noneLabel = "None",
		disabled = false,
		compact = false,
		onpick
	}: {
		value?: string | null;
		options: Option[];
		placeholder?: string;
		allowNone?: boolean;
		noneLabel?: string;
		disabled?: boolean;
		compact?: boolean;
		onpick?: (value: string | null) => void;
	} = $props();

	let open = $state(false);
	let q = $state("");
	let trigger = $state<HTMLButtonElement>();
	let pop = $state<HTMLDivElement>();
	let pos = $state({ top: 0, left: 0, width: 260, up: false });

	const current = $derived(options.find(o => o.value === value));
	const filtered = $derived(q.trim() ? options.filter(o => o.label.toLowerCase().includes(q.trim().toLowerCase())) : options);

	function place() {
		if (!trigger) return;
		const r = trigger.getBoundingClientRect();
		const width = Math.max(r.width, 260);
		const room_below = window.innerHeight - r.bottom;
		const up = room_below < 320 && r.top > room_below;
		pos = {
			top: up ? r.top - 6 : r.bottom + 6,
			left: Math.min(r.left, window.innerWidth - width - 8),
			width,
			up
		};
	}

	function toggle() {
		if (disabled) return;
		open = !open;
		if (open) {
			q = "";
			place();
		}
	}

	function pick(v: string | null) {
		value = v;
		onpick?.(v);
		open = false;
	}

	function outside(e: MouseEvent) {
		const t = e.target as Node;
		if (open && !trigger?.contains(t) && !pop?.contains(t)) open = false;
	}

	function focusOnMount(node: HTMLInputElement) {
		node.focus();
	}
</script>

<svelte:window onmousedown={outside} onresize={() => (open = false)} onscroll={() => open && place()} />

<button bind:this={trigger} type="button" class="input trigger" class:compact {disabled} onclick={toggle} aria-haspopup="listbox" aria-expanded={open}>
	{#if current}
		<OptionIcon option={current} />
		<span class="label">{current.label}</span>
	{:else}
		<span class="label faint">{placeholder}</span>
	{/if}
	<ChevronDown size={15} class="chev" />
</button>

{#if open}
	<div
		bind:this={pop}
		class="pop"
		style:left="{pos.left}px"
		style:width="{pos.width}px"
		style:top={pos.up ? "auto" : `${pos.top}px`}
		style:bottom={pos.up ? `${window.innerHeight - pos.top}px` : "auto"}
		role="listbox"
	>
		<div class="search">
			<Search size={14} />
			<input use:focusOnMount bind:value={q} placeholder="Search..." onkeydown={e => e.key === "Escape" && (open = false)} />
		</div>
		<div class="list">
			{#if allowNone && !q}
				<button type="button" class="opt" class:selected={value === null} onclick={() => pick(null)}>
					<span class="faint">{noneLabel}</span>
				</button>
			{/if}
			{#each filtered as o, i (o.value)}
				{#if o.group && o.group !== filtered[i - 1]?.group}
					<div class="group">{o.group}</div>
				{/if}
				<button type="button" class="opt" class:selected={value === o.value} disabled={o.disabled} onclick={() => pick(o.value)}>
					<OptionIcon option={o} />
					<span class="label">{o.label}</span>
					{#if o.note}<span class="note">{o.note}</span>{/if}
				</button>
			{:else}
				<div class="none">No matches</div>
			{/each}
		</div>
	</div>
{/if}

<style>
	.trigger {
		display: flex;
		align-items: center;
		gap: 7px;
		text-align: left;
		min-width: 0;
		cursor: pointer;
	}
	.trigger.compact {
		padding: 6px 9px;
		font-size: 13px;
	}
	.label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.trigger :global(.chev) {
		color: var(--muted);
		flex: none;
	}
	.pop {
		position: fixed;
		z-index: 80;
		background: #25272b;
		border: 1px solid var(--input-border);
		border-radius: 8px;
		box-shadow: 0 14px 40px rgba(0, 0, 0, 0.45);
		overflow: hidden;
	}
	.search {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 8px;
		padding: 7px 10px;
		border: 1px solid var(--accent);
		border-radius: 6px;
		color: var(--muted);
	}
	.search input {
		flex: 1;
		background: transparent;
		border: 0;
		outline: none;
		color: var(--text);
		font: inherit;
	}
	.list {
		max-height: 280px;
		overflow-y: auto;
		padding: 0 6px 6px;
	}
	.opt {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		border: 0;
		background: transparent;
		padding: 7px 8px;
		border-radius: 5px;
		text-align: left;
		font-size: 13.5px;
	}
	.opt:hover:not(:disabled),
	.opt.selected {
		background: rgba(255, 255, 255, 0.06);
	}
	.opt.selected {
		color: #f06595;
	}
	.note {
		font-size: 11px;
		color: var(--faint);
		flex: none;
	}
	.group {
		font-size: 10.5px;
		font-weight: 700;
		letter-spacing: 0.5px;
		text-transform: uppercase;
		color: var(--faint);
		padding: 10px 8px 4px;
	}
	.none {
		padding: 10px;
		color: var(--faint);
		font-size: 13px;
	}
</style>
