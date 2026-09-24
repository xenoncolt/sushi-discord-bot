<script lang="ts" module>
	import type { WelcomeButton } from "$lib/api";

	// Mirrors resolveEmoji in welcome/send.ts: Discord refuses the whole
	// message over an emoji it doesn't know, so the bot drops unrecognisable
	// ones and this says so before anybody wonders where theirs went.
	const CUSTOM_EMOJI = /^<a?:\w{2,32}:\d{15,21}>$/u;
	const EMOJI_PARTS = /^[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\u200d\ufe0f\u20e3\d#*]{1,20}$/u;
	const EMOJI_CORE = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u;

	export function badEmoji(raw: string): boolean {
		const e = raw.trim();
		if (!e) return false;
		return !CUSTOM_EMOJI.test(e) && !(EMOJI_PARTS.test(e) && EMOJI_CORE.test(e));
	}

	// Mirrors buttonIsLive in welcome/send.ts.
	export function buttonProblem(b: WelcomeButton): string {
		if (!b.label.trim()) return "Needs a label";
		if (b.kind === "channel" && !b.channel_id) return "Pick a channel";
		if (b.kind === "url" && !/^https?:\/\/\S+$/.test(b.url.trim())) return "Needs a full https:// link";
		return "";
	}
</script>

<script lang="ts">
	import { Trash2, TriangleAlert } from "@lucide/svelte";
	import ChannelSelect from "./ChannelSelect.svelte";
	import Segmented from "./Segmented.svelte";

	let { button = $bindable(), onremove }: { button: WelcomeButton; onremove: () => void } = $props();

	const problem = $derived(buttonProblem(button));
</script>

<div class="editor">
	<div class="line">
		<div class="kind">
			<Segmented
				bind:value={button.kind}
				size="sm"
				options={[
					{ value: "channel", label: "Channel" },
					{ value: "url", label: "Link" }
				]}
			/>
		</div>
		<input class="input emoji" placeholder="🙂" maxlength="64" aria-label="Emoji" bind:value={button.emoji} />
		<input class="input" placeholder="Button label" maxlength="80" aria-label="Button label" bind:value={button.label} />
		<button class="btn icon" title="Remove this button" aria-label="Remove this button" onclick={onremove}><Trash2 size={14} /></button>
	</div>
	<div class="line">
		{#if button.kind === "channel"}
			<ChannelSelect bind:value={button.channel_id} types={["text", "announcement", "forum", "voice"]} placeholder="Pick a channel" allowNone={false} compact />
		{:else}
			<input class="input" placeholder="https://example.com" maxlength="500" aria-label="Link" bind:value={button.url} />
		{/if}
	</div>
	{#if problem}
		<div class="problem"><TriangleAlert size={12} /> {problem} — left out of the message until it's filled in.</div>
	{:else if badEmoji(button.emoji)}
		<div class="problem soft">
			<TriangleAlert size={12} /> That isn't an emoji Discord takes, so the button goes out with just its label. Paste one emoji, or a custom one as <span class="mono">{"<:name:id>"}</span>.
		</div>
	{/if}
</div>

<style>
	.editor {
		display: flex;
		flex-direction: column;
		gap: 7px;
		background: rgba(0, 0, 0, 0.22);
		border: 1px solid var(--input-border);
		border-radius: 8px;
		padding: 10px;
	}
	.line {
		display: flex;
		align-items: center;
		gap: 7px;
	}
	.kind {
		width: 140px;
		flex: none;
	}
	.emoji {
		width: 52px;
		flex: none;
		text-align: center;
		padding: 0 4px;
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
	@media (max-width: 700px) {
		.line {
			flex-wrap: wrap;
		}
		.kind {
			width: 100%;
		}
	}
</style>
