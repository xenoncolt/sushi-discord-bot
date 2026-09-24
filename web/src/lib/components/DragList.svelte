<script lang="ts" module>
	// Which list a drag started in, so a row can never be dropped into a
	// different list — the builder nests lists inside lists (blocks inside a
	// container, buttons inside a row) and their drag events bubble through
	// each other.
	let active = $state<{ group: string; from: number } | null>(null);
	let groups = 0;

	export function dragGroup(): string {
		return `dl${groups++}`;
	}
</script>

<script lang="ts" generics="T">
	import { GripVertical } from "@lucide/svelte";
	import type { Snippet } from "svelte";

	let {
		items = $bindable(),
		id,
		item,
		tools,
		horizontal = false,
		gap = 8,
		handleTitle = "Drag to move — or focus this and use the arrow keys"
	}: {
		items: T[];
		id: (item: T) => string;
		item: Snippet<[T, number]>;
		// Buttons that belong to the row rather than to its contents: remove,
		// duplicate, whatever the list needs.
		tools?: Snippet<[T, number]>;
		horizontal?: boolean;
		gap?: number;
		handleTitle?: string;
	} = $props();

	const group = dragGroup();

	// Only the handle arms a drag, so selecting text inside a row still works
	// the way it looks like it should.
	let armed = $state<string | null>(null);
	let over = $state<number | null>(null);

	function move(from: number, to: number) {
		if (to < 0 || to >= items.length || from === to) return;
		const next = [...items];
		const [moved] = next.splice(from, 1);
		next.splice(to, 0, moved);
		items = next;
	}

	function end() {
		active = null;
		over = null;
		armed = null;
	}

	function drop(to: number) {
		if (active?.group === group) move(active.from, to);
		end();
	}

	function onkeydown(e: KeyboardEvent, i: number) {
		const back = horizontal ? "ArrowLeft" : "ArrowUp";
		const forward = horizontal ? "ArrowRight" : "ArrowDown";
		if (e.key !== back && e.key !== forward) return;
		e.preventDefault();
		move(i, e.key === back ? i - 1 : i + 1);
		// Keep the handle under the fingers that are moving it.
		const handle = e.currentTarget as HTMLElement;
		requestAnimationFrame(() => handle.focus());
	}
</script>

<div class="dl" class:horizontal style:gap="{gap}px">
	{#each items as entry, i (id(entry))}
		<div
			class="dl-row"
			class:dragging={active?.group === group && active.from === i}
			class:over={over === i && active?.group === group && active.from !== i}
			draggable={armed === id(entry)}
			role="listitem"
			ondragstart={e => {
				e.stopPropagation();
				active = { group, from: i };
			}}
			ondragover={e => {
				if (active?.group !== group) return;
				e.preventDefault();
				e.stopPropagation();
				over = i;
			}}
			ondragleave={() => over === i && (over = null)}
			ondrop={e => {
				if (active?.group !== group) return;
				e.preventDefault();
				e.stopPropagation();
				drop(i);
			}}
			ondragend={end}
		>
			<button
				class="dl-handle"
				type="button"
				title={handleTitle}
				aria-label="Move this item"
				disabled={items.length < 2}
				onmousedown={() => (armed = id(entry))}
				onmouseup={() => (armed = null)}
				onkeydown={e => onkeydown(e, i)}
			>
				<GripVertical size={14} />
			</button>

			<div class="dl-body">{@render item(entry, i)}</div>

			{#if tools}
				<div class="dl-tools">{@render tools(entry, i)}</div>
			{/if}
		</div>
	{/each}
</div>

<style>
	.dl {
		display: flex;
		flex-direction: column;
	}
	.dl.horizontal {
		flex-direction: row;
		flex-wrap: wrap;
		align-items: flex-start;
	}

	.dl-row {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		border-radius: 8px;
		border: 1px solid transparent;
		transition: border-color 0.12s, opacity 0.12s;
	}
	.dl:not(.horizontal) .dl-row {
		width: 100%;
	}
	.dl-row.dragging {
		opacity: 0.4;
	}
	.dl-row.over {
		border-color: var(--accent);
	}

	.dl-handle {
		display: flex;
		align-items: center;
		justify-content: center;
		flex: none;
		width: 20px;
		align-self: stretch;
		min-height: 28px;
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: var(--faint);
		cursor: grab;
		padding: 0;
	}
	.dl-handle:hover:not(:disabled),
	.dl-handle:focus-visible {
		color: var(--text);
		background: rgba(255, 255, 255, 0.05);
		outline: none;
	}
	.dl-handle:focus-visible {
		box-shadow: 0 0 0 2px var(--accent);
	}
	.dl-handle:active {
		cursor: grabbing;
	}

	.dl-body {
		flex: 1;
		min-width: 0;
	}
	.dl.horizontal .dl-body {
		flex: none;
	}
	.dl-tools {
		display: flex;
		align-items: center;
		gap: 2px;
		flex: none;
	}
</style>
