<script lang="ts">
	import { TriangleAlert } from "@lucide/svelte";
	import { MSG_LIMITS, type MsgMedia } from "$lib/api";
	import { isHttps } from "$lib/msgdoc";

	let {
		media = $bindable(),
		label = "Image URL",
		placeholder = "https://…",
		withAlt = true,
		withSpoiler = true,
		required = true
	}: {
		media: MsgMedia;
		label?: string;
		placeholder?: string;
		withAlt?: boolean;
		withSpoiler?: boolean;
		required?: boolean;
	} = $props();

	const bad = $derived(media.url.trim() !== "" && !isHttps(media.url));
	const missing = $derived(required && !media.url.trim());
</script>

<div class="media">
	<div class="line">
		<input class="input" {placeholder} maxlength={MSG_LIMITS.url} aria-label={label} bind:value={media.url} />
		{#if withSpoiler}
			<label class="spoil" title="Hide it behind a click until somebody taps it">
				<input type="checkbox" bind:checked={media.spoiler} />
				Spoiler
			</label>
		{/if}
	</div>

	{#if withAlt}
		<input class="input alt" placeholder="Alt text — shown on hover and read out to screen readers" maxlength="256" aria-label="Alt text" bind:value={media.alt} />
	{/if}

	{#if bad}
		<div class="problem"><TriangleAlert size={12} /> Discord only fetches https:// links, so this one would be left out.</div>
	{:else if missing}
		<div class="problem soft"><TriangleAlert size={12} /> Nothing here yet — this block won't be posted.</div>
	{/if}
</div>

<style>
	.media {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.line {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.line .input {
		flex: 1;
		min-width: 0;
	}
	.alt {
		font-size: 12.5px;
	}
	.spoil {
		display: flex;
		align-items: center;
		gap: 5px;
		flex: none;
		font-size: 12px;
		color: var(--muted);
		white-space: nowrap;
		cursor: pointer;
	}
	.problem {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 11.5px;
		color: #ffa8a8;
	}
	.problem.soft {
		color: var(--warning);
	}
</style>
