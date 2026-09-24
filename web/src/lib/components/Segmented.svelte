<script lang="ts" generics="T extends string">
	let {
		value = $bindable(),
		options,
		disabled = false,
		size = "md"
	}: { value: T; options: { value: T; label: string }[]; disabled?: boolean; size?: "sm" | "md" } = $props();
</script>

<div class="seg" class:sm={size === "sm"} role="radiogroup">
	{#each options as o (o.value)}
		<button type="button" role="radio" aria-checked={value === o.value} class:active={value === o.value} {disabled} onclick={() => (value = o.value)}>
			{o.label}
		</button>
	{/each}
</div>

<style>
	.seg {
		display: flex;
		width: 100%;
		border: 1px solid var(--input-border);
		border-radius: 6px;
		overflow: hidden;
		background: var(--input);
	}
	button {
		flex: 1;
		border: 0;
		border-left: 1px solid var(--input-border);
		background: transparent;
		color: var(--muted);
		padding: 8px 10px;
		font-size: 13px;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	button:first-child {
		border-left: 0;
	}
	button:hover:not(.active):not(:disabled) {
		background: rgba(255, 255, 255, 0.03);
		color: var(--text);
	}
	button.active {
		background: var(--accent-grad);
		color: #fff;
		font-weight: 500;
	}
	.sm button {
		padding: 5px 8px;
		font-size: 12px;
	}
</style>
