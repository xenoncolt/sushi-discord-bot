<script lang="ts">
	import { Folder, Hash, Megaphone, MessagesSquare, Volume2 } from "@lucide/svelte";
	import type { Option } from "./Select.svelte";

	let { option }: { option: Option } = $props();
</script>

{#if option.kind === "role"}
	<span class="dot" style:background={option.color ?? "#7b7f86"}></span>
{:else if option.kind === "text"}
	<Hash size={14} class="oi" />
{:else if option.kind === "announcement"}
	<Megaphone size={14} class="oi" />
{:else if option.kind === "voice" || option.kind === "stage"}
	<Volume2 size={14} class="oi" />
{:else if option.kind === "category"}
	<Folder size={14} class="oi" />
{:else if option.kind === "forum"}
	<MessagesSquare size={14} class="oi" />
{/if}

<style>
	.dot {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		flex: none;
	}
	:global(.oi) {
		color: var(--muted);
		flex: none;
	}
</style>
