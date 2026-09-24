<script lang="ts">
	import { CircleAlert, Pencil, Plus, RefreshCw, Trash2 } from "@lucide/svelte";
	import {
		api, ApiError, parseOptions, QUESTION_LIMITS,
		type AppQuestion, type ApplicationsPayload, type QuestionOption, type QuestionType, type QuestionVisibility
	} from "$lib/api";
	import Card from "$lib/components/Card.svelte";
	import ChannelSelect from "$lib/components/ChannelSelect.svelte";
	import DragList from "$lib/components/DragList.svelte";
	import Modal from "$lib/components/Modal.svelte";
	import NumberInput from "$lib/components/NumberInput.svelte";
	import RoleSelect from "$lib/components/RoleSelect.svelte";
	import Toggle from "$lib/components/Toggle.svelte";
	import { useGuild } from "$lib/guild.svelte";
	import { toast } from "$lib/toast.svelte";

	const g = useGuild();

	let data = $state<ApplicationsPayload | null>(null);
	let error = $state("");
	let busy = $state(false);

	// Settings are edited in place and saved with the button, not on every
	// keystroke: saving re-posts the panel, which is too loud to autosave.
	let form = $state({
		panel_channel_id: null as string | null,
		review_channel_id: null as string | null,
		reviewer_role_id: null as string | null,
		accepted_role_id: null as string | null,
		panel_title: "",
		panel_body: "",
		panel_button: "",
		panel_note: ""
	});

	const TYPE_LABELS: Record<QuestionType, string> = {
		text: "Written answer",
		select: "Dropdown",
		radio: "Pick one",
		checkbox: "Tick any",
		file: "Image upload"
	};

	const WHO_LABELS: Record<QuestionVisibility, string> = {
		always: "Everyone",
		gvg: "GvG only",
		gve: "GvE only"
	};

	function load() {
		api<ApplicationsPayload>(`/guilds/${g.guild.id}/applications`)
			.then(res => {
				apply(res);
				if (res.settings) {
					form = {
						panel_channel_id: res.settings.panel_channel_id,
						review_channel_id: res.settings.review_channel_id,
						reviewer_role_id: res.settings.reviewer_role_id,
						accepted_role_id: res.settings.accepted_role_id,
						panel_title: res.settings.panel_title ?? "",
						panel_body: res.settings.panel_body ?? "",
						panel_button: res.settings.panel_button ?? "",
						panel_note: res.settings.panel_note ?? ""
					};
				}
			})
			.catch(err => (error = err.message));
	}

	$effect(() => {
		if (g.guild.id) load();
	});

	async function send<T>(path: string, method: string, body?: unknown, ok = "Saved"): Promise<void> {
		busy = true;
		try {
			apply(await api<ApplicationsPayload>(path, { method, body }));
			toast(ok);
		} catch (err) {
			toast(err instanceof ApiError ? err.message : (err as Error).message, "error", 6000);
			// A refused change (a rejected drag, most likely) leaves the page
			// showing something the bot did not accept, so snap back to reality.
			load();
		} finally {
			busy = false;
		}
	}

	const saveSettings = () =>
		send(`/guilds/${g.guild.id}/applications/settings`, "PUT", { ...form }, "Saved, panel updated");

	// DragList mutates the array it is given, so each list is held locally and
	// pushed back to the bot whenever the order actually changes.
	let stage0 = $state<AppQuestion[]>([]);
	let stage1 = $state<AppQuestion[]>([]);

	// Plain variable on purpose: the watcher below must not depend on this, or
	// setting it would retrigger the watcher.
	let synced = "";

	function key(a: AppQuestion[], b: AppQuestion[]): string {
		return `${a.map(q => q.id).join(",")}|${b.map(q => q.id).join(",")}`;
	}

	// Filling the lists happens here rather than in an effect. An effect that
	// wrote these and then read them back would depend on what it had just
	// written, and since filter() returns a new array every run it would never
	// settle.
	function apply(res: ApplicationsPayload): void {
		data = res;
		stage0 = res.questions.filter(q => q.stage === 0);
		stage1 = res.questions.filter(q => q.stage !== 0);
		synced = key(stage0, stage1);
	}

	// Read only, so dragging a row is the only thing that can trip it.
	$effect(() => {
		const now = key(stage0, stage1);
		if (!synced || now === synced) return;
		synced = now;
		saveOrder();
	});

	// What an applicant actually sees, given Discord only takes five per form.
	function formsFor(picked: QuestionVisibility[]): AppQuestion[][] {
		const asked = stage1.filter(q => q.enabled === 1 && (q.shown_when === "always" || picked.includes(q.shown_when)));
		const out: AppQuestion[][] = [];
		for (let i = 0; i < asked.length; i += QUESTION_LIMITS.per_form) out.push(asked.slice(i, i + QUESTION_LIMITS.per_form));
		return out;
	}

	async function saveOrder() {
		const order = [
			...stage0.map(q => ({ id: q.id, stage: 0 })),
			...stage1.map(q => ({ id: q.id, stage: 1 }))
		];
		await send(`/guilds/${g.guild.id}/applications/questions/reorder`, "POST", { order }, "Order saved");
	}

	// ---- question editor ---------------------------------------------------

	let editing = $state<AppQuestion | null>(null);
	let creating = $state(false);
	let draft = $state(blank());
	let options = $state<QuestionOption[]>([]);

	function blank() {
		return {
			field_id: "",
			type: "text" as QuestionType,
			label: "",
			description: "",
			placeholder: "",
			required: true,
			paragraph: false,
			stage: 1,
			shown_when: "always" as QuestionVisibility,
			role: "" as string,
			min_values: null as number | null,
			max_values: null as number | null,
			min_length: null as number | null,
			max_length: null as number | null,
			enabled: true
		};
	}

	function openEditor(q: AppQuestion | null) {
		editing = q;
		creating = q === null;
		options = q ? parseOptions(q) : [];
		draft = q
			? {
					field_id: q.field_id,
					type: q.type,
					label: q.label,
					description: q.description ?? "",
					placeholder: q.placeholder ?? "",
					required: q.required === 1,
					paragraph: q.paragraph === 1,
					stage: q.stage,
					shown_when: q.shown_when,
					role: q.role ?? "",
					min_values: q.min_values,
					max_values: q.max_values,
					min_length: q.min_length,
					max_length: q.max_length,
					enabled: q.enabled === 1
				}
			: blank();
	}

	const needsOptions = $derived(QUESTION_LIMITS.options[draft.type] > 0);

	async function saveQuestion() {
		const body = { ...draft, role: draft.role || null, options: needsOptions ? options : [] };
		const path = creating
			? `/guilds/${g.guild.id}/applications/questions`
			: `/guilds/${g.guild.id}/applications/questions/${editing!.id}`;

		const before = data;
		await send(path, creating ? "POST" : "PATCH", body, creating ? "Question added" : "Question saved");
		// send() swallows the error to show a toast, so only close on a change.
		if (data !== before) editing = null, creating = false;
	}

	async function removeQuestion(q: AppQuestion) {
		if (!confirm(`Delete "${q.label}"? Applications already sent keep their answers.`)) return;
		await send(`/guilds/${g.guild.id}/applications/questions/${q.id}`, "DELETE", undefined, "Question deleted");
	}

	function addOption() {
		options = [...options, { label: "", value: "" }];
	}
</script>

<svelte:head><title>Applications · {g.guild.name}</title></svelte:head>

<div class="page-head">
	<h1>Applications</h1>
	<p>The join form people fill in, and where it gets sent for review.</p>
</div>

{#if error}
	<div class="warn-box">{error}</div>
{:else if !data}
	<div class="faint">Loading…</div>
{:else}
	{#if !data.settings}
		<div class="warn-box">
			<CircleAlert size={15} /> Applications aren't set up yet. Pick both channels below and save to post the panel.
		</div>
	{/if}

	<Card title="Where it lives" desc="The button applicants press, and the channel officers review in">
		<div class="rows">
			<label class="row" for="panel-ch">
				<span>Panel channel<small>Where the Start Application button is posted.</small></span>
				<ChannelSelect bind:value={form.panel_channel_id} allowNone={false} types={["text"]} />
			</label>
			<label class="row" for="review-ch">
				<span>Review channel<small>Finished applications land here. Keep it officers only.</small></span>
				<ChannelSelect bind:value={form.review_channel_id} allowNone={false} />
			</label>
			<label class="row" for="officer">
				<span>Officer role<small>Can accept, reject and message applicants. Admins always can.</small></span>
				<RoleSelect bind:value={form.reviewer_role_id} />
			</label>
			<label class="row" for="accepted">
				<span>Role on accept<small>Handed to anyone an officer accepts.</small></span>
				<RoleSelect bind:value={form.accepted_role_id} assignableOnly />
			</label>
		</div>
	</Card>

	<Card title="Panel wording" desc="What people read before they start. Leave blank for the default.">
		<div class="rows">
			<label class="row" for="p-title">
				<span>Heading</span>
				<input id="p-title" bind:value={form.panel_title} placeholder={data.defaults.title} maxlength="200" />
			</label>
			<label class="stack" for="p-body">
				<span>Body<small>Markdown works, same as a Discord message.</small></span>
				<textarea id="p-body" rows="6" bind:value={form.panel_body} placeholder={data.defaults.body} maxlength="2000"></textarea>
			</label>
			<label class="stack" for="p-note">
				<span>Requirement notice<small>Shown under the body. Clear it to drop the notice entirely.</small></span>
				<textarea id="p-note" rows="3" bind:value={form.panel_note} placeholder={data.defaults.note} maxlength="1000"></textarea>
			</label>
			<label class="row" for="p-btn">
				<span>Button label</span>
				<input id="p-btn" bind:value={form.panel_button} placeholder={data.defaults.button} maxlength="80" />
			</label>
		</div>

		<div class="actions">
			<button class="btn primary" onclick={saveSettings} disabled={busy}>Save and update panel</button>
			{#if data.settings}
				<button class="btn" onclick={() => send(`/guilds/${g.guild.id}/applications/panel`, "POST", undefined, "Panel updated")} disabled={busy}>
					<RefreshCw size={14} /> Re-post panel
				</button>
			{/if}
		</div>
	</Card>

	<Card title="First form" desc="Asked before anyone says what they're applying for, so everyone sees these. Discord allows {QUESTION_LIMITS.per_form}.">
		{#if stage0.length === 0}
			<div class="faint">No questions yet.</div>
		{:else}
			<DragList bind:items={stage0} id={(q: AppQuestion) => String(q.id)}>
				{#snippet item(q: AppQuestion)}
					{@render questionRow(q)}
				{/snippet}
				{#snippet tools(q: AppQuestion)}
					{@render questionTools(q)}
				{/snippet}
			</DragList>
		{/if}
		<div class="hint">{stage0.length} of {QUESTION_LIMITS.per_form} used.</div>
	</Card>

	<Card title="Later forms" desc="Everything after. These are split into forms of {QUESTION_LIMITS.per_form} automatically.">
		{#if stage1.length === 0}
			<div class="faint">No questions yet.</div>
		{:else}
			<DragList bind:items={stage1} id={(q: AppQuestion) => String(q.id)}>
				{#snippet item(q: AppQuestion)}
					{@render questionRow(q)}
				{/snippet}
				{#snippet tools(q: AppQuestion)}
					{@render questionTools(q)}
				{/snippet}
			</DragList>
		{/if}

		<button class="add-tile" onclick={() => openEditor(null)}><Plus size={16} /> Add question</button>

		<div class="preview">
			<div class="preview-title">What applicants get</div>
			{#each [["GvG only", ["gvg"]], ["GvE only", ["gve"]], ["Both", ["gvg", "gve"]]] as [name, picked] (name)}
				{@const forms = formsFor(picked as QuestionVisibility[])}
				<div class="preview-row">
					<span class="who">{name}</span>
					<span class="faint">{forms.length + 1} form{forms.length === 0 ? "" : "s"}:</span>
					<span class="shape">part 1 ({stage0.length}){#each forms as f, i}<span> → part {i + 2} ({f.length})</span>{/each}</span>
				</div>
			{/each}
		</div>
	</Card>
{/if}

{#snippet questionRow(q: AppQuestion)}
	<div class="q" class:off={q.enabled !== 1}>
		<span class="q-label">{q.label || q.field_id}</span>
		<span class="tags">
			<span class="tag">{TYPE_LABELS[q.type]}</span>
			{#if q.shown_when !== "always"}<span class="tag who">{WHO_LABELS[q.shown_when]}</span>{/if}
			{#if q.required !== 1}<span class="tag">optional</span>{/if}
			{#if q.role}<span class="tag role">{q.role}</span>{/if}
			{#if q.enabled !== 1}<span class="tag off-tag">hidden</span>{/if}
		</span>
	</div>
{/snippet}

{#snippet questionTools(q: AppQuestion)}
	<button class="btn icon" onclick={() => openEditor(q)} aria-label="Edit"><Pencil size={14} /></button>
	<button class="btn icon" onclick={() => removeQuestion(q)} aria-label="Delete"><Trash2 size={14} /></button>
{/snippet}

{#if editing !== null || creating}
	<Modal title={creating ? "Add question" : "Edit question"} width={560} onclose={() => ((editing = null), (creating = false))}>
		<div class="rows">
			<label class="row" for="q-label">
				<span>Question<small>Max {QUESTION_LIMITS.label} characters — Discord's limit.</small></span>
				<input id="q-label" bind:value={draft.label} maxlength={QUESTION_LIMITS.label} />
			</label>
			<label class="row" for="q-desc">
				<span>Hint<small>Smaller text under the question. Max {QUESTION_LIMITS.description}.</small></span>
				<input id="q-desc" bind:value={draft.description} maxlength={QUESTION_LIMITS.description} />
			</label>
			<label class="row" for="q-id">
				<span>Field id<small>Stored with each answer. Letters, numbers, underscores.</small></span>
				<input id="q-id" bind:value={draft.field_id} disabled={!creating} placeholder="app_region" />
			</label>
			<label class="row" for="q-type">
				<span>Type</span>
				<select id="q-type" bind:value={draft.type} disabled={!creating}>
					{#each Object.entries(TYPE_LABELS) as [value, label] (value)}<option {value}>{label}</option>{/each}
				</select>
			</label>
			<label class="row" for="q-who">
				<span>Shown to</span>
				<select id="q-who" bind:value={draft.shown_when} disabled={draft.stage === 0}>
					{#each Object.entries(WHO_LABELS) as [value, label] (value)}<option {value}>{label}</option>{/each}
				</select>
			</label>
			<label class="row" for="q-stage">
				<span>Asked in<small>The first form can't depend on the GvG/GvE answer.</small></span>
				<select id="q-stage" bind:value={draft.stage}>
					<option value={0}>First form</option>
					<option value={1}>Later forms</option>
				</select>
			</label>

			{#if draft.type === "text"}
				<label class="row" for="q-ph">
					<span>Placeholder</span>
					<input id="q-ph" bind:value={draft.placeholder} maxlength={QUESTION_LIMITS.placeholder} />
				</label>
				<label class="row" for="q-para">
					<span>Multi-line box</span>
					<Toggle bind:checked={draft.paragraph} label="Multi-line" />
				</label>
				<div class="row">
					<span>Answer length</span>
					<span class="pair">
						<NumberInput bind:value={draft.min_length as number} min={0} max={4000} placeholder="min" />
						<NumberInput bind:value={draft.max_length as number} min={1} max={4000} placeholder="max" />
					</span>
				</div>
			{/if}

			{#if draft.type === "file"}
				<div class="row">
					<span>Images allowed<small>Up to {QUESTION_LIMITS.uploads}, Discord's own cap.</small></span>
					<NumberInput bind:value={draft.max_values as number} min={1} max={QUESTION_LIMITS.uploads} placeholder="10" />
				</div>
			{/if}

			{#if draft.type === "select" || draft.type === "checkbox"}
				<div class="row">
					<span>Picks allowed</span>
					<span class="pair">
						<NumberInput bind:value={draft.min_values as number} min={0} max={25} placeholder="min" />
						<NumberInput bind:value={draft.max_values as number} min={1} max={25} placeholder="max" />
					</span>
				</div>
			{/if}

			<label class="row" for="q-req">
				<span>Must be answered</span>
				<Toggle bind:checked={draft.required} label="Required" />
			</label>
			<label class="row" for="q-on">
				<span>Ask this question<small>Turn off to keep it without showing it.</small></span>
				<Toggle bind:checked={draft.enabled} label="Enabled" />
			</label>
		</div>

		{#if needsOptions}
			<div class="opts">
				<div class="opts-head">
					<span>Options<small class="faint"> — at least {QUESTION_LIMITS.min_options[draft.type]}, at most {QUESTION_LIMITS.options[draft.type]}</small></span>
					<button class="btn small" onclick={addOption} disabled={options.length >= QUESTION_LIMITS.options[draft.type]}>
						<Plus size={13} /> Add
					</button>
				</div>
				{#each options as opt, i (i)}
					<div class="opt">
						<input bind:value={opt.label} placeholder="Label shown to applicants" maxlength="100" />
						<input bind:value={opt.value} placeholder="value (auto)" maxlength="100" class="val" />
						<button class="btn icon" onclick={() => (options = options.filter((_, j) => j !== i))} aria-label="Remove option">
							<Trash2 size={13} />
						</button>
					</div>
				{/each}
				{#if !creating}
					<div class="hint">Renaming an option only changes new applications — ones already sent keep the wording they were given.</div>
				{/if}
			</div>
		{/if}

		<div class="actions">
			<button class="btn primary" onclick={saveQuestion} disabled={busy}>{creating ? "Add question" : "Save"}</button>
			<button class="btn" onclick={() => ((editing = null), (creating = false))}>Cancel</button>
		</div>
	</Modal>
{/if}

<style>
	.rows {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		min-width: 0;
	}
	.stack {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.row > span:first-child,
	.stack > span:first-child {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-weight: 500;
		min-width: 0;
	}
	small {
		font-weight: 400;
		font-size: 11.5px;
		opacity: 0.65;
	}
	.row input,
	.row select {
		flex: 0 1 260px;
		min-width: 0;
	}
	textarea {
		width: 100%;
		resize: vertical;
		font: inherit;
	}
	.pair {
		display: flex;
		gap: 6px;
		flex: 0 1 260px;
	}
	.actions {
		display: flex;
		gap: 8px;
		margin-top: 14px;
	}
	.q {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		flex: 1;
	}
	.q.off {
		opacity: 0.5;
	}
	.q-label {
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tags {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
	}
	.tag {
		font-size: 10.5px;
		text-transform: uppercase;
		letter-spacing: 0.4px;
		padding: 2px 6px;
		border-radius: 5px;
		background: var(--input);
		border: 1px solid var(--input-border);
	}
	.tag.who {
		border-color: #6f8dd6;
	}
	.tag.role {
		border-color: #d69b6f;
	}
	.tag.off-tag {
		border-color: #d66f6f;
	}
	.opts {
		margin-top: 16px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.opts-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-weight: 500;
	}
	.opt {
		display: flex;
		gap: 6px;
	}
	.opt input {
		flex: 1;
		min-width: 0;
	}
	.opt .val {
		flex: 0 1 140px;
	}
	.preview {
		margin-top: 16px;
		padding-top: 14px;
		border-top: 1px solid var(--input-border);
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.preview-title {
		font-weight: 500;
		margin-bottom: 2px;
	}
	.preview-row {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		font-size: 13px;
	}
	.who {
		min-width: 70px;
		font-weight: 500;
	}
	.shape {
		font-family: var(--mono, monospace);
		font-size: 12px;
		opacity: 0.85;
	}
</style>
