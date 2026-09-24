<script lang="ts" module>
	import { FileUp, Image, Images, Minus, MousePointerClick, PanelTop, Type } from "@lucide/svelte";
	import type { NodeType } from "$lib/api";

	export const BLOCKS: { type: NodeType; label: string; icon: typeof Type; hint: string }[] = [
		{ type: "text", label: "Text", icon: Type, hint: "A paragraph of markdown" },
		{ type: "section", label: "Section", icon: Image, hint: "A paragraph with a thumbnail or a button beside it" },
		{ type: "gallery", label: "Gallery", icon: Images, hint: "Up to ten pictures, laid out by Discord" },
		{ type: "row", label: "Buttons", icon: MousePointerClick, hint: "A row of buttons, or one dropdown" },
		{ type: "separator", label: "Divider", icon: Minus, hint: "A line, or just some breathing room" },
		{ type: "file", label: "File", icon: FileUp, hint: "Uploaded with the message, with a download button" },
		{ type: "container", label: "Container", icon: PanelTop, hint: "A bordered card with an accent stripe" }
	];
</script>

<script lang="ts">
	let {
		onadd,
		exclude = [],
		disabled = false,
		note = ""
	}: {
		onadd: (type: NodeType) => void;
		exclude?: NodeType[];
		disabled?: boolean;
		note?: string;
	} = $props();

	const shown = $derived(BLOCKS.filter(b => !exclude.includes(b.type)));
</script>

<div class="addbar">
	<span class="label" style="margin: 0">Add</span>
	{#each shown as block (block.type)}
		<button class="btn sm" {disabled} title={block.hint} onclick={() => onadd(block.type)}>
			<block.icon size={13} />
			{block.label}
		</button>
	{/each}
	{#if note}
		<span class="spacer"></span>
		<span class="faint">{note}</span>
	{/if}
</div>

<style>
	.addbar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 7px;
	}
</style>
