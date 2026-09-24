<script lang="ts">
	let { checked = $bindable(false), disabled = false, label = "" }: { checked?: boolean; disabled?: boolean; label?: string } = $props();
</script>

<button
	type="button"
	class="toggle"
	class:on={checked}
	role="switch"
	aria-checked={checked}
	aria-label={label}
	{disabled}
	onclick={() => (checked = !checked)}
>
	<span class="knob"></span>
</button>

<style>
	.toggle {
		position: relative;
		width: 38px;
		height: 21px;
		border-radius: 999px;
		border: 1px solid #45484e;
		background: #33363b;
		padding: 0;
		flex: none;
		transition: background 0.18s, border-color 0.18s;
	}
	.toggle.on {
		background: var(--accent);
		border-color: var(--accent);
	}
	.knob {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 15px;
		height: 15px;
		border-radius: 50%;
		background: #202226;
		transition: transform 0.18s;
	}
	.on .knob {
		transform: translateX(17px);
		background: #fff;
	}
</style>
