<script lang="ts">
	import { ChevronDown, ExternalLink, Plus, Trash2 } from "@lucide/svelte";
	import { MSG_LIMITS, type MsgRow } from "$lib/api";
	import { badEmoji, buttonProblem, newButton } from "$lib/msgdoc";
	import DragList from "../DragList.svelte";
	import Segmented from "../Segmented.svelte";
	import ButtonForm from "./ButtonForm.svelte";
	import SelectForm from "./SelectForm.svelte";

	let { row = $bindable() }: { row: MsgRow } = $props();

	// One button open at a time: the pills are the row as Discord will lay it
	// out, and five editors unfolded at once would bury it.
	let editing = $state<string | null>(null);

	function add() {
		if (row.buttons.length >= MSG_LIMITS.row_buttons) return;
		const button = newButton();
		row.buttons = [...row.buttons, button];
		editing = button.id;
	}

	function remove(id: string) {
		row.buttons = row.buttons.filter(b => b.id !== id);
		if (editing === id) editing = null;
	}
</script>

<div class="rowform">
	<Segmented
		bind:value={row.type}
		size="sm"
		options={[
			{ value: "buttons", label: "Buttons" },
			{ value: "select", label: "Dropdown" }
		]}
	/>

	{#if row.type === "buttons"}
		<DragList bind:items={row.buttons} id={b => b.id} horizontal gap={6}>
			{#snippet item(button, i)}
				<button
					class="pill"
					class:ghost={Boolean(buttonProblem(button))}
					class:open={editing === button.id}
					class:primary={button.kind !== "link" && button.kind !== "channel" && button.style === "primary"}
					class:success={button.kind !== "link" && button.kind !== "channel" && button.style === "success"}
					class:danger={button.kind !== "link" && button.kind !== "channel" && button.style === "danger"}
					type="button"
					onclick={() => (editing = editing === button.id ? null : button.id)}
				>
					{#if button.emoji && !badEmoji(button.emoji)}<span>{button.emoji}</span>{/if}
					<span class="pill-label">{button.label.trim() || `Button ${i + 1}`}</span>
					{#if button.kind === "link" || button.kind === "channel"}
						<ExternalLink size={11} />
					{:else}
						<ChevronDown size={11} />
					{/if}
				</button>
			{/snippet}
		</DragList>

		{#each row.buttons as button, i (button.id)}
			{#if editing === button.id}
				<ButtonForm bind:button={row.buttons[i]} onremove={() => remove(button.id)} />
			{/if}
		{/each}

		<div class="row">
			<button class="btn sm" disabled={row.buttons.length >= MSG_LIMITS.row_buttons} onclick={add}><Plus size={13} /> Button</button>
			<span class="spacer"></span>
			<span class="faint">{row.buttons.length}/{MSG_LIMITS.row_buttons} in this row</span>
		</div>
	{:else}
		<SelectForm bind:select={row.select} />
	{/if}
</div>

<style>
	.rowform {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		max-width: 220px;
		background: #4e5058;
		border: 1px solid transparent;
		color: #fff;
		border-radius: 6px;
		padding: 5px 10px;
		font-size: 12.5px;
		font-weight: 500;
	}
	.pill.primary {
		background: #5865f2;
	}
	.pill.success {
		background: #248046;
	}
	.pill.danger {
		background: #da373c;
	}
	.pill.ghost {
		background: #3a3d42;
		color: var(--muted);
		border-style: dashed;
		border-color: var(--input-border);
	}
	.pill.open {
		border-color: var(--accent);
	}
	.pill-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
