<script lang="ts">
	import { Plus, Trash2, TriangleAlert } from "@lucide/svelte";
	import { MSG_LIMITS, type MsgEmbed } from "$lib/api";
	import { countEmbedText, embedProblem, newField } from "$lib/msgdoc";
	import DragList from "../DragList.svelte";
	import Segmented from "../Segmented.svelte";
	import Toggle from "../Toggle.svelte";

	let { embed = $bindable() }: { embed: MsgEmbed } = $props();

	const problem = $derived(embedProblem(embed));
	const used = $derived(countEmbedText([embed]));

	function addField() {
		if (embed.fields.length >= MSG_LIMITS.embed_fields) return;
		embed.fields = [...embed.fields, newField()];
	}

	function removeField(id: string) {
		embed.fields = embed.fields.filter(f => f.id !== id);
	}

	// An embed with no colour is a different thing from one that happens to be
	// grey, so clearing it is its own action rather than a shade of the picker.
	function toggleColor() {
		embed.color = embed.color ? "" : "#5865f2";
	}
</script>

<div class="embed">
	<div class="line">
		<span class="label" style="margin: 0">Stripe</span>
		<input type="color" class="swatch" aria-label="Embed colour" disabled={!embed.color} bind:value={embed.color} />
		<input class="input mono narrow" maxlength="7" aria-label="Embed colour hex" placeholder="none" bind:value={embed.color} />
		<button class="btn sm" onclick={toggleColor}>{embed.color ? "No stripe" : "Add a stripe"}</button>
		<span class="spacer"></span>
		<span class="faint">{used.toLocaleString()} chars</span>
	</div>

	<div class="grid grid-2">
		<div>
			<label class="label" for="em-author">Author line</label>
			<input id="em-author" class="input" maxlength={MSG_LIMITS.embed_author} placeholder="Small line above the title" bind:value={embed.author.name} />
		</div>
		<div>
			<label class="label" for="em-authorico">Author icon URL</label>
			<input id="em-authorico" class="input" maxlength={MSG_LIMITS.url} placeholder="https://…" bind:value={embed.author.icon_url} />
		</div>
	</div>
	{#if embed.author.name}
		<div>
			<label class="label" for="em-authorurl">Author link</label>
			<input id="em-authorurl" class="input" maxlength={MSG_LIMITS.url} placeholder="https://… — makes the author line clickable" bind:value={embed.author.url} />
		</div>
	{/if}

	<div class="grid grid-2">
		<div>
			<label class="label" for="em-title">Title</label>
			<input id="em-title" class="input" maxlength={MSG_LIMITS.embed_title} bind:value={embed.title} />
		</div>
		<div>
			<label class="label" for="em-url">Title link</label>
			<input id="em-url" class="input" maxlength={MSG_LIMITS.url} placeholder="https://… — makes the title clickable" bind:value={embed.url} />
		</div>
	</div>

	<div>
		<label class="label" for="em-desc">Description · {embed.description.length}/{MSG_LIMITS.embed_description}</label>
		<textarea id="em-desc" class="input" rows="5" maxlength={MSG_LIMITS.embed_description} bind:value={embed.description}></textarea>
	</div>

	<div class="fields">
		<div class="row">
			<span class="label" style="margin: 0">Fields</span>
			<span class="spacer"></span>
			<span class="faint">{embed.fields.length}/{MSG_LIMITS.embed_fields}</span>
		</div>

		<DragList bind:items={embed.fields} id={f => f.id} gap={6}>
			{#snippet item(field, i)}
				<div class="field">
					<input class="input" placeholder="Field name" maxlength={MSG_LIMITS.field_name} aria-label="Field name" bind:value={embed.fields[i].name} />
					<div class="inline" title="Sits beside the neighbouring inline fields instead of on its own line">
						<Toggle bind:checked={embed.fields[i].inline} label="Inline" />
						<span class="muted">Inline</span>
					</div>
					<textarea class="input value" rows="2" placeholder="Field value" maxlength={MSG_LIMITS.field_value} aria-label="Field value" bind:value={embed.fields[i].value}></textarea>
				</div>
			{/snippet}
			{#snippet tools(field)}
				<button class="btn icon" title="Remove this field" aria-label="Remove this field" onclick={() => removeField(field.id)}><Trash2 size={13} /></button>
			{/snippet}
		</DragList>

		<button class="btn sm" style="margin-top: 8px" disabled={embed.fields.length >= MSG_LIMITS.embed_fields} onclick={addField}><Plus size={13} /> Field</button>
	</div>

	<div class="grid grid-2">
		<div>
			<label class="label" for="em-image">Big image URL</label>
			<input id="em-image" class="input" maxlength={MSG_LIMITS.url} placeholder="https://…" bind:value={embed.image} />
		</div>
		<div>
			<label class="label" for="em-thumb">Thumbnail URL</label>
			<input id="em-thumb" class="input" maxlength={MSG_LIMITS.url} placeholder="https://… — small, top right" bind:value={embed.thumbnail} />
		</div>
	</div>

	<div class="grid grid-2">
		<div>
			<label class="label" for="em-footer">Footer</label>
			<input id="em-footer" class="input" maxlength={MSG_LIMITS.embed_footer} bind:value={embed.footer.text} />
		</div>
		<div>
			<label class="label" for="em-footerico">Footer icon URL</label>
			<input id="em-footerico" class="input" maxlength={MSG_LIMITS.url} placeholder="https://…" bind:value={embed.footer.icon_url} />
		</div>
	</div>

	<div>
		<span class="label">Timestamp — shown beside the footer</span>
		<div class="row">
			<div class="stamp">
				<Segmented
					bind:value={embed.timestamp}
					size="sm"
					options={[
						{ value: "none", label: "None" },
						{ value: "now", label: "When sent" },
						{ value: "custom", label: "A set moment" }
					]}
				/>
			</div>
			{#if embed.timestamp === "custom"}
				<input
					class="input"
					type="datetime-local"
					aria-label="Timestamp"
					value={embed.timestamp_at ? embed.timestamp_at.slice(0, 16) : ""}
					oninput={e => {
						const v = (e.currentTarget as HTMLInputElement).value;
						embed.timestamp_at = v ? new Date(v).toISOString() : "";
					}}
				/>
			{/if}
		</div>
	</div>

	{#if problem}
		<div class="problem"><TriangleAlert size={12} /> {problem}.</div>
	{/if}
</div>

<style>
	.embed {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.line {
		display: flex;
		align-items: center;
		gap: 8px;
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
	.fields {
		border-top: 1px solid var(--border);
		border-bottom: 1px solid var(--border);
		padding: 12px 0;
	}
	.field {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 6px;
		background: rgba(0, 0, 0, 0.18);
		border: 1px solid var(--input-border);
		border-radius: 7px;
		padding: 7px;
	}
	.field .value {
		grid-column: 1 / -1;
		min-height: 0;
		font-size: 13px;
	}
	.inline {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		white-space: nowrap;
	}
	.stamp {
		width: 280px;
		flex: none;
	}
	.problem {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 11.5px;
		color: #ffa8a8;
	}
</style>
