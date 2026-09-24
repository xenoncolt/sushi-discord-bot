<script lang="ts">
	import type { Snippet } from "svelte";
	import { Crown } from "@lucide/svelte";

	let {
		title,
		desc = "",
		badge = "",
		premium = false,
		aside,
		children
	}: { title: string; desc?: string; badge?: string; premium?: boolean; aside?: Snippet; children?: Snippet } = $props();
</script>

<section class="card" class:premium>
	<div class="top">
		<div class="text">
			<div class="card-title">
				{title}
				{#if badge}<span class="badge" class:pvp={badge === "PVP"}>{badge}</span>{/if}
			</div>
			{#if desc}<div class="card-desc">{desc}</div>{/if}
		</div>
		{#if aside}<div class="aside">{@render aside()}</div>{/if}
		{#if premium}<Crown size={16} color="#f06595" />{/if}
	</div>
	{#if children}<div class="card-body">{@render children()}</div>{/if}
</section>

<style>
	.top {
		display: flex;
		align-items: flex-start;
		gap: 12px;
	}
	.text {
		flex: 1;
		min-width: 0;
	}
	.aside {
		flex: none;
		display: flex;
		align-items: center;
		gap: 8px;
		max-width: 50%;
	}
</style>
