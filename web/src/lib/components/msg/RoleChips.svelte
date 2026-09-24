<script lang="ts">
	import { Plus, X } from "@lucide/svelte";
	import { useGuild } from "$lib/guild.svelte";
	import RoleSelect from "../RoleSelect.svelte";

	let {
		roles = $bindable(),
		max = 10,
		placeholder = "Add a role",
		// Roles already spoken for elsewhere on the same button, so the two
		// lists can't be made to fight over one.
		exclude = []
	}: {
		roles: string[];
		max?: number;
		placeholder?: string;
		exclude?: string[];
	} = $props();

	const g = useGuild();

	let adding = $state(false);
	let picked = $state<string | null>(null);

	function add(id: string | null) {
		if (id && !roles.includes(id)) roles = [...roles, id];
		picked = null;
		adding = false;
	}
</script>

<div class="chips">
	{#each roles as id (id)}
		{@const role = g.role(id)}
		<span class="rchip" class:gone={!role}>
			<span class="dot" style:background={role?.color ?? "#6f737a"}></span>
			<span class="rname">{role?.name ?? "deleted role"}</span>
			<button class="x" title="Remove" aria-label="Remove {role?.name ?? 'role'}" onclick={() => (roles = roles.filter(r => r !== id))}>
				<X size={12} />
			</button>
		</span>
	{/each}

	{#if adding}
		<div class="picker">
			<!-- svelte-ignore a11y_autofocus -->
			<RoleSelect bind:value={picked} {placeholder} allowNone={false} assignableOnly exclude={[...roles, ...exclude]} onpick={add} />
		</div>
	{:else if roles.length < max}
		<button class="rchip add" onclick={() => (adding = true)}><Plus size={12} /> Role</button>
	{/if}
</div>

<style>
	.chips {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}
	.rchip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		max-width: 220px;
		background: var(--input);
		border: 1px solid var(--input-border);
		border-radius: 20px;
		padding: 3px 4px 3px 10px;
		font-size: 12.5px;
	}
	.rchip.add {
		padding: 4px 11px;
		border-style: dashed;
		color: var(--muted);
	}
	.rchip.add:hover {
		color: var(--text);
		border-color: var(--accent);
	}
	.rchip.gone .rname {
		color: #ffa8a8;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex: none;
	}
	.rname {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.x {
		display: flex;
		align-items: center;
		border: 0;
		background: transparent;
		color: var(--faint);
		border-radius: 50%;
		padding: 3px;
	}
	.x:hover {
		color: #ff8787;
		background: rgba(224, 49, 49, 0.15);
	}
	.picker {
		width: 220px;
	}
</style>
