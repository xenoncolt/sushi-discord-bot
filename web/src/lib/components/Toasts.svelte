<script lang="ts">
	import { toasts } from "$lib/toast.svelte";
	import { Check, CircleAlert, Info } from "@lucide/svelte";
</script>

<div class="toasts" aria-live="polite">
	{#each toasts as t (t.id)}
		<div class="toast {t.kind}">
			{#if t.kind === "success"}<Check size={15} />{:else if t.kind === "error"}<CircleAlert size={15} />{:else}<Info size={15} />{/if}
			<span>{t.text}</span>
		</div>
	{/each}
</div>

<style>
	.toasts {
		position: fixed;
		right: 18px;
		bottom: 18px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		z-index: 100;
		max-width: min(420px, calc(100vw - 36px));
	}
	.toast {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 14px;
		border-radius: 8px;
		background: #2f3237;
		border: 1px solid var(--border);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
		font-size: 13px;
		animation: slide 0.18s ease-out;
	}
	.success {
		border-left: 3px solid var(--success);
	}
	.success :global(svg) {
		color: var(--success);
	}
	.error {
		border-left: 3px solid var(--danger);
	}
	.error :global(svg) {
		color: #ff8787;
	}
	@keyframes slide {
		from {
			transform: translateY(8px);
			opacity: 0;
		}
	}
</style>
