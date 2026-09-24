<script lang="ts" module>
	// Kept as a re-export so the pages that grew up around this component can
	// go on importing it from here; the renderer itself moved to $lib/markdown
	// once a second preview needed it.
	export { renderMarkdown } from "$lib/markdown";
</script>

<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		color = "#d6336c",
		html,
		thumbnail = null,
		image = null,
		footer = "",
		bot_name = "LeaderBoard",
		bot_avatar = "/favicon.svg",
		blocks,
		extra,
		below
	}: {
		color?: string;
		html: string;
		thumbnail?: string | null;
		image?: string | null;
		footer?: string;
		bot_name?: string;
		bot_avatar?: string;
		// Inside the container, straight after the first block of text: more
		// text and button rows, for a message that interleaves them.
		blocks?: Snippet;
		// Inside the container, under the image.
		extra?: Snippet;
		// Outside it: action rows hang off the message, not the card.
		below?: Snippet;
	} = $props();
</script>

<div class="msg">
	<img class="bot" src={bot_avatar} alt="" />
	<div class="body">
		<div class="who"><strong>{bot_name}</strong> <span class="app">APP</span> <span class="time">Today</span></div>
		<div class="container" style:border-left-color={color}>
			<div class="section">
				<div class="text">{@html html}</div>
				{#if thumbnail}<img class="thumb" src={thumbnail} alt="" />{/if}
			</div>
			{#if blocks}{@render blocks()}{/if}
			{#if image}<img class="image" src={image} alt="" />{/if}
			{#if extra}{@render extra()}{/if}
			{#if footer}
				<hr />
				<div class="sub">{@html footer}</div>
			{/if}
		</div>
		{#if below}{@render below()}{/if}
	</div>
</div>

<style>
	.msg {
		display: flex;
		gap: 12px;
		background: #313338;
		border-radius: 8px;
		padding: 14px;
		font-family: "gg sans", "Noto Sans", var(--font);
		font-size: 14.5px;
		color: #dbdee1;
	}
	.bot {
		width: 38px;
		height: 38px;
		border-radius: 50%;
		flex: none;
	}
	.body {
		flex: 1;
		min-width: 0;
	}
	.who {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 4px;
	}
	.who strong {
		color: #f2f3f5;
	}
	.app {
		background: #5865f2;
		color: #fff;
		font-size: 10px;
		font-weight: 700;
		border-radius: 3px;
		padding: 0 4px;
	}
	.time {
		color: #949ba4;
		font-size: 12px;
	}
	.container {
		background: #2b2d31;
		border: 1px solid #3a3c42;
		border-left: 4px solid;
		border-radius: 8px;
		padding: 14px 16px;
		max-width: 520px;
	}
	.section {
		display: flex;
		gap: 14px;
		align-items: flex-start;
	}
	.text {
		flex: 1;
		min-width: 0;
		line-height: 1.4;
		overflow-wrap: anywhere;
	}
	.thumb {
		width: 76px;
		height: 76px;
		border-radius: 8px;
		object-fit: cover;
		flex: none;
	}
	.image {
		display: block;
		width: 100%;
		max-height: 220px;
		object-fit: cover;
		border-radius: 8px;
		margin-top: 10px;
	}
	hr {
		border: 0;
		border-top: 1px solid #3f4147;
		margin: 10px 0;
	}
	.sub {
		font-size: 12px;
		color: #949ba4;
	}
</style>
