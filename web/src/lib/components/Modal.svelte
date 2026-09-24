<script lang="ts">
	import type { Snippet } from "svelte";
	import { X } from "@lucide/svelte";

	let { title, onclose, width = 440, children }: { title: string; onclose: () => void; width?: number; children: Snippet } = $props();
</script>

<svelte:window onkeydown={e => e.key === "Escape" && onclose()} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onclose}>
	<div class="modal" style:max-width="{width}px" role="dialog" aria-modal="true" aria-label={title} tabindex="-1" onclick={e => e.stopPropagation()}>
		<div class="head">
			<h3>{title}</h3>
			<button class="btn icon" onclick={onclose} aria-label="Close"><X size={18} /></button>
		</div>
		{@render children()}
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(10, 11, 13, 0.62);
		display: grid;
		place-items: center;
		z-index: 50;
		padding: 16px;
		animation: fade 0.12s ease-out;
	}
	.modal {
		width: 100%;
		max-height: calc(100vh - 32px);
		overflow: auto;
		background: linear-gradient(145deg, #3a1a22, #2b2e32 55%);
		border: 1px solid #4a3a40;
		border-radius: 12px;
		padding: 22px;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 16px;
	}
	h3 {
		font-size: 17px;
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
</style>
