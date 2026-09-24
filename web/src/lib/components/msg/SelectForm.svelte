<script lang="ts">
	import { Plus, Trash2, TriangleAlert } from "@lucide/svelte";
	import { MSG_LIMITS, type MsgSelect } from "$lib/api";
	import { newOption, selectProblem } from "$lib/msgdoc";
	import DragList from "../DragList.svelte";
	import NumberInput from "../NumberInput.svelte";
	import RoleSelect from "../RoleSelect.svelte";
	import Toggle from "../Toggle.svelte";

	let { select = $bindable() }: { select: MsgSelect } = $props();

	const problem = $derived(selectProblem(select));
	const usable = $derived(select.options.filter(o => o.label.trim() && o.role_id).length);
	// Roles already spoken for, so the same one can't be offered twice.
	const taken = $derived(select.options.map(o => o.role_id).filter((id): id is string => Boolean(id)));

	function add() {
		if (select.options.length >= MSG_LIMITS.select_options) return;
		select.options = [...select.options, newOption()];
	}

	function remove(id: string) {
		select.options = select.options.filter(o => o.id !== id);
	}

	// Discord refuses a menu that asks for more picks than it offers, so the
	// two numbers are kept inside each other's reach as they are typed.
	$effect(() => {
		const ceiling = Math.max(1, usable);
		if (select.max > ceiling) select.max = ceiling;
		if (select.min > select.max) select.min = select.max;
	});
</script>

<div class="form">
	<div class="grid grid-2">
		<div>
			<label class="label" for="sel-ph">Placeholder — what it says before anything is picked</label>
			<input id="sel-ph" class="input" maxlength={MSG_LIMITS.select_placeholder} placeholder="Pick your roles" bind:value={select.placeholder} />
		</div>
		<div>
			<span class="label">How many may be picked</span>
			<div class="row">
				<div class="num"><NumberInput bind:value={select.min} min={0} max={Math.max(1, usable)} /></div>
				<span class="faint">to</span>
				<div class="num"><NumberInput bind:value={select.max} min={1} max={Math.max(1, usable)} /></div>
				<span class="spacer"></span>
				<Toggle bind:checked={select.disabled} label="Greyed out" />
				<span class="muted">Greyed out</span>
			</div>
			<div class="hint">A minimum of 0 lets somebody clear the lot.</div>
		</div>
	</div>

	<div class="options">
		<DragList bind:items={select.options} id={o => o.id} gap={6}>
			{#snippet item(option, i)}
				<div class="option">
					<input class="input emoji" placeholder="🙂" maxlength="64" aria-label="Emoji" bind:value={select.options[i].emoji} />
					<input class="input name" placeholder="Option label" maxlength={MSG_LIMITS.option_label} aria-label="Option label" bind:value={select.options[i].label} />
					<div class="role">
						<RoleSelect
							bind:value={select.options[i].role_id}
							placeholder="Pick a role"
							allowNone={false}
							assignableOnly
							exclude={taken.filter(id => id !== option.role_id)}
						/>
					</div>
					<input class="input desc" placeholder="Description (optional)" maxlength={MSG_LIMITS.option_description} aria-label="Description" bind:value={select.options[i].description} />
				</div>
			{/snippet}
			{#snippet tools(option)}
				<button class="btn icon" title="Remove this option" aria-label="Remove this option" onclick={() => remove(option.id)}><Trash2 size={13} /></button>
			{/snippet}
		</DragList>

		{#if !select.options.length}
			<div class="empty">No options yet — a dropdown needs at least one.</div>
		{/if}

		<div class="row" style="margin-top: 8px">
			<button class="btn sm" disabled={select.options.length >= MSG_LIMITS.select_options} onclick={add}><Plus size={13} /> Option</button>
			<span class="spacer"></span>
			<span class="faint">{select.options.length}/{MSG_LIMITS.select_options} options</span>
		</div>
	</div>

	{#if problem}
		<div class="problem"><TriangleAlert size={12} /> {problem} — the whole row is left out until then.</div>
	{/if}

	<div class="hint" style="margin: 0">
		Picking an option gives the member that role and takes back the ones they unpicked, so the menu always matches what they chose. Saving is what makes it
		work — the bot reads the list back off this draft each time somebody uses it.
	</div>
</div>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.num {
		width: 74px;
	}
	.options {
		border-top: 1px solid var(--border);
		padding-top: 12px;
	}
	.option {
		display: grid;
		grid-template-columns: 52px minmax(0, 1fr) minmax(0, 1fr);
		grid-template-areas: "emoji name role" "desc desc desc";
		gap: 6px;
		background: rgba(0, 0, 0, 0.18);
		border: 1px solid var(--input-border);
		border-radius: 7px;
		padding: 7px;
	}
	.emoji {
		grid-area: emoji;
		text-align: center;
		padding: 0 4px;
	}
	.name {
		grid-area: name;
	}
	.role {
		grid-area: role;
		min-width: 0;
	}
	.desc {
		grid-area: desc;
		font-size: 12.5px;
	}
	.problem {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 11.5px;
		color: #ffa8a8;
	}
	@media (max-width: 760px) {
		.option {
			grid-template-columns: 52px minmax(0, 1fr);
			grid-template-areas: "emoji name" "role role" "desc desc";
		}
	}
</style>
