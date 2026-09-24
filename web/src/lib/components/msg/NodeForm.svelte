<script lang="ts">
	import { Copy, Plus, Trash2, TriangleAlert } from "@lucide/svelte";
	import { MSG_LIMITS, type MsgNode, type NodeType } from "$lib/api";
	import { newMedia, newNode, nodeProblem, reKey } from "$lib/msgdoc";
	import DragList from "../DragList.svelte";
	import Segmented from "../Segmented.svelte";
	import Toggle from "../Toggle.svelte";
	import AddBar, { BLOCKS } from "./AddBar.svelte";
	import ButtonForm from "./ButtonForm.svelte";
	import MediaField from "./MediaField.svelte";
	import NodeForm from "./NodeForm.svelte";
	import RowForm from "./RowForm.svelte";

	let {
		node = $bindable(),
		onremove,
		onduplicate
	}: {
		node: MsgNode;
		onremove: () => void;
		onduplicate?: () => void;
	} = $props();

	const kind = $derived(BLOCKS.find(b => b.type === node.type));
	const problem = $derived(nodeProblem(node));

	function addChild(type: NodeType) {
		node.children = [...node.children, newNode(type)];
	}

	function removeChild(id: string) {
		node.children = node.children.filter(c => c.id !== id);
	}

	function duplicateChild(i: number) {
		const copy = reKey(node.children[i]);
		node.children = [...node.children.slice(0, i + 1), copy, ...node.children.slice(i + 1)];
	}

	function addImage() {
		if (node.items.length >= MSG_LIMITS.gallery_items) return;
		node.items = [...node.items, newMedia()];
	}

	function removeImage(id: string) {
		node.items = node.items.filter(m => m.id !== id);
	}
</script>

<div class="node" class:container={node.type === "container"}>
	<div class="head">
		{#if kind}<kind.icon size={13} />{/if}
		<strong>{kind?.label ?? node.type}</strong>
		{#if node.type === "container"}
			<span class="faint">· {node.children.length} inside</span>
		{/if}
		<span class="spacer"></span>
		{#if problem}
			<span class="warnpill"><TriangleAlert size={11} /> {problem}</span>
		{/if}
		{#if onduplicate}
			<button class="btn icon" title="Duplicate this block" aria-label="Duplicate this block" onclick={onduplicate}><Copy size={13} /></button>
		{/if}
		<button class="btn icon" title="Remove this block" aria-label="Remove this block" onclick={onremove}><Trash2 size={13} /></button>
	</div>

	<div class="body">
		{#if node.type === "text"}
			<textarea class="input" rows={Math.min(12, Math.max(3, node.text.split("\n").length + 1))} maxlength={MSG_LIMITS.v2_text} bind:value={node.text} aria-label="Text"></textarea>
		{:else if node.type === "section"}
			<textarea class="input" rows={Math.min(10, Math.max(2, node.text.split("\n").length + 1))} maxlength={MSG_LIMITS.v2_text} bind:value={node.text} aria-label="Text"></textarea>
			<div class="acc">
				<Segmented
					bind:value={node.accessory}
					size="sm"
					options={[
						{ value: "thumbnail", label: "Thumbnail on the right" },
						{ value: "button", label: "Button on the right" }
					]}
				/>
			</div>
			{#if node.accessory === "thumbnail"}
				<MediaField bind:media={node.thumbnail} />
			{:else}
				<ButtonForm bind:button={node.button} />
			{/if}
		{:else if node.type === "gallery"}
			<DragList bind:items={node.items} id={m => m.id} gap={8}>
				{#snippet item(image, i)}
					<MediaField bind:media={node.items[i]} placeholder="https://… image {i + 1}" />
				{/snippet}
				{#snippet tools(image)}
					<button class="btn icon" title="Remove this image" aria-label="Remove this image" onclick={() => removeImage(image.id)}><Trash2 size={13} /></button>
				{/snippet}
			</DragList>
			<div class="row">
				<button class="btn sm" disabled={node.items.length >= MSG_LIMITS.gallery_items} onclick={addImage}><Plus size={13} /> Image</button>
				<span class="spacer"></span>
				<span class="faint">{node.items.length}/{MSG_LIMITS.gallery_items}</span>
			</div>
		{:else if node.type === "separator"}
			<div class="row">
				<Toggle bind:checked={node.divider} label="Show the line" />
				<span class="muted">Show the line</span>
				<span class="spacer"></span>
				<div class="spacing">
					<Segmented
						bind:value={node.spacing}
						size="sm"
						options={[
							{ value: "small", label: "Small gap" },
							{ value: "large", label: "Large gap" }
						]}
					/>
				</div>
			</div>
		{:else if node.type === "row"}
			<RowForm bind:row={node.row} />
		{:else if node.type === "file"}
			<MediaField bind:media={node.file} label="File URL" placeholder="https://… — any file, fetched and uploaded with the message" withAlt={false} />
			<div class="hint" style="margin: 0">
				The bot downloads this and uploads it to Discord, so it lands as a real attachment. A message with one of these can't be edited in place
				afterwards — it has to be posted again.
			</div>
		{:else if node.type === "container"}
			<div class="row">
				<span class="label" style="margin: 0">Stripe</span>
				<input type="color" class="swatch" aria-label="Accent colour" disabled={!node.accent} bind:value={node.accent} />
				<input class="input mono narrow" maxlength="7" placeholder="none" aria-label="Accent colour hex" bind:value={node.accent} />
				<button class="btn sm" onclick={() => (node.accent = node.accent ? "" : "#5865f2")}>{node.accent ? "No stripe" : "Add a stripe"}</button>
				<span class="spacer"></span>
				<Toggle bind:checked={node.spoiler} label="Spoiler" />
				<span class="muted">Spoiler</span>
			</div>

			<div class="children">
				<DragList bind:items={node.children} id={c => c.id} gap={10}>
					{#snippet item(child, i)}
						<NodeForm bind:node={node.children[i]} onremove={() => removeChild(child.id)} onduplicate={() => duplicateChild(i)} />
					{/snippet}
				</DragList>

				{#if !node.children.length}
					<div class="empty">Nothing in this container yet.</div>
				{/if}

				<div style="margin-top: 10px">
					<AddBar onadd={addChild} exclude={["container"]} />
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.node {
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
	}
	.node.container {
		border-color: rgba(194, 24, 91, 0.35);
	}
	.head {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 7px 8px 7px 11px;
		background: rgba(0, 0, 0, 0.18);
		border-bottom: 1px solid var(--border);
		font-size: 12.5px;
		color: var(--muted);
	}
	.head strong {
		color: var(--text);
		font-weight: 600;
	}
	.warnpill {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
		color: var(--warning);
		max-width: 320px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 11px;
	}
	.acc {
		max-width: 360px;
	}
	.spacing {
		width: 220px;
	}
	.narrow {
		width: 96px;
		flex: none;
	}
	.swatch {
		width: 38px;
		height: 32px;
		padding: 2px;
		border-radius: 6px;
		border: 1px solid var(--input-border);
		background: var(--input);
		flex: none;
	}
	.children {
		border-top: 1px solid var(--border);
		padding-top: 11px;
	}
</style>
