<script lang="ts">
	import { Info, Trash2, TriangleAlert } from "@lucide/svelte";
	import { MSG_LIMITS, type ButtonStyleName, type MsgButton } from "$lib/api";
	import { badEmoji, buttonProblem, buttonWarning } from "$lib/msgdoc";
	import ChannelSelect from "../ChannelSelect.svelte";
	import Segmented from "../Segmented.svelte";
	import Toggle from "../Toggle.svelte";
	import RoleChips from "./RoleChips.svelte";

	let { button = $bindable(), onremove }: { button: MsgButton; onremove?: () => void } = $props();

	const STYLES: { value: ButtonStyleName; label: string }[] = [
		{ value: "primary", label: "Blurple" },
		{ value: "secondary", label: "Grey" },
		{ value: "success", label: "Green" },
		{ value: "danger", label: "Red" }
	];

	const problem = $derived(buttonProblem(button));
	const warning = $derived(buttonWarning(button));

	// Discord only lets a button carry a URL when it is styled as a link, so
	// the colour is not a choice on the two kinds that open one. Everything
	// else is answered by the bot, which is also what makes it colourable.
	const answered = $derived(button.kind === "role" || button.kind === "reply" || button.kind === "none");
</script>

<div class="form">
	<div class="line">
		<div class="kind">
			<Segmented
				bind:value={button.kind}
				size="sm"
				options={[
					{ value: "link", label: "Link" },
					{ value: "channel", label: "Channel" },
					{ value: "role", label: "Role" },
					{ value: "reply", label: "Reply" },
					{ value: "none", label: "Label" }
				]}
			/>
		</div>
		<input class="input emoji" placeholder="🙂" maxlength="64" aria-label="Emoji" bind:value={button.emoji} />
		<input class="input" placeholder="Button label" maxlength={MSG_LIMITS.button_label} aria-label="Button label" bind:value={button.label} />
		{#if onremove}
			<button class="btn icon" title="Remove this button" aria-label="Remove this button" onclick={onremove}><Trash2 size={14} /></button>
		{/if}
	</div>

	{#if button.kind === "link"}
		<input class="input" placeholder="https://example.com" maxlength={MSG_LIMITS.url} aria-label="Link" bind:value={button.url} />
		<div class="hint" style="margin: 0">Opens in the browser. Discord handles it without me ever hearing about the press.</div>
	{:else if button.kind === "channel"}
		<ChannelSelect bind:value={button.channel_id} types={["text", "announcement", "forum", "voice", "stage"]} placeholder="Pick a channel" allowNone={false} compact />
		<div class="hint" style="margin: 0">Becomes a jump link, so renaming or moving the channel later doesn't break it.</div>
	{/if}

	{#if answered}
		<div class="line">
			<div class="styles"><Segmented bind:value={button.style} size="sm" options={STYLES} /></div>
			<div class="off">
				<Toggle bind:checked={button.disabled} label="Posted greyed out" />
				<span class="muted">Posted greyed out</span>
			</div>
		</div>
	{/if}

	{#if button.kind === "role"}
		<div class="sub">
			<div class="subhead">A press…</div>
			<div class="mode">
				<Segmented
					bind:value={button.role_mode}
					size="sm"
					options={[
						{ value: "add", label: "Gives" },
						{ value: "remove", label: "Takes away" },
						{ value: "toggle", label: "Toggles" }
					]}
				/>
			</div>
			<RoleChips bind:roles={button.role_ids} max={MSG_LIMITS.button_roles} exclude={button.remove_ids} />

			{#if button.role_mode !== "remove"}
				<div class="subhead">…and also takes away</div>
				<RoleChips bind:roles={button.remove_ids} max={MSG_LIMITS.button_roles} placeholder="Add a role to remove" exclude={button.role_ids} />
				<div class="hint" style="margin: 0">
					This is how a set of buttons that should be exclusive works — a green <em>Yes</em> that gives <em>Attending</em> and takes away
					<em>Not attending</em>, and a red <em>No</em> that does the opposite.
				</div>
			{/if}

			{#if button.role_mode === "toggle"}
				<div class="hint" style="margin: 0">Pressing it again hands the role back, so the same button works as on and off.</div>
			{/if}
		</div>
	{/if}

	{#if button.kind === "role" || button.kind === "reply"}
		<div class="sub">
			<label class="subhead" for="b-reply">What the presser is told</label>
			<textarea
				id="b-reply"
				class="input"
				rows="2"
				maxlength={MSG_LIMITS.reply_text}
				placeholder={button.kind === "reply" ? "Say something back — this is all a Reply button does." : "Leave empty and I'll describe what I changed."}
				bind:value={button.reply_text}
			></textarea>
			<div class="row">
				<Toggle bind:checked={button.reply_public} label="Post it in the channel" />
				<span class="muted">Post it in the channel, where everybody sees it</span>
			</div>
			<div class="hint" style="margin: 0">
				Off — the usual — is a private note only the presser sees. Placeholders: <span class="mono">{"{user}"}</span> <span class="mono">{"{name}"}</span>
				<span class="mono">{"{added}"}</span> <span class="mono">{"{removed}"}</span> <span class="mono">{"{server}"}</span>. On a public reply,
				remember every single press posts another message.
			</div>
		</div>
	{/if}

	{#if answered}
		<div class="sub">
			<div class="subhead">After a press</div>
			<div class="after">
				<Segmented
					bind:value={button.after.mode}
					size="sm"
					options={[
						{ value: "nothing", label: "Leave the button alone" },
						{ value: "everyone", label: "Change it, for everyone" }
					]}
				/>
			</div>

			{#if button.after.mode === "everyone"}
				<div class="line">
					<input class="input" placeholder="New label (leave empty to keep it)" maxlength={MSG_LIMITS.button_label} aria-label="New label" bind:value={button.after.label} />
					<div class="afterstyle">
						<Segmented bind:value={button.after.style} size="sm" options={[{ value: "keep", label: "Same colour" }, ...STYLES]} />
					</div>
				</div>
				<div class="row">
					<Toggle bind:checked={button.after.disable} label="Grey it out" />
					<span class="muted">Grey it out so nobody can press it again</span>
				</div>
				<div class="note">
					<Info size={13} />
					<span>
						Discord shows everyone the same buttons, so this changes it for the whole channel, not just the person who pressed it. That makes it right
						for a one-shot — claim a prize, close a thread, lock a sign-up — and wrong for anything more than one person should be able to do. For
						"you've already done this", use the private reply above instead.
					</span>
				</div>
			{/if}
		</div>
	{:else if button.kind === "none"}
		<div class="hint" style="margin: 0">Does nothing at all. Leave it ungreyed to use as a plain label, or grey it out to show something is unavailable.</div>
	{/if}

	{#if problem}
		<div class="problem"><TriangleAlert size={12} /> {problem} — left out of the message until it's filled in.</div>
	{:else if badEmoji(button.emoji)}
		<div class="problem soft">
			<TriangleAlert size={12} /> That isn't an emoji Discord takes, so the button goes out with just its label. Paste one emoji, or a custom one as
			<span class="mono">{"<:name:id>"}</span>.
		</div>
	{:else if warning}
		<div class="problem soft"><TriangleAlert size={12} /> {warning}.</div>
	{/if}
</div>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: 8px;
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
		width: 270px;
		flex: none;
	}
	.styles {
		width: 260px;
		flex: none;
	}
	.afterstyle {
		width: 320px;
		flex: none;
	}
	.mode {
		width: 240px;
	}
	.after {
		max-width: 360px;
	}
	.emoji {
		width: 52px;
		flex: none;
		text-align: center;
		padding: 0 4px;
	}
	.off {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 12px;
	}
	.sub {
		display: flex;
		flex-direction: column;
		gap: 7px;
		border-top: 1px solid var(--input-border);
		padding-top: 9px;
	}
	.subhead {
		font-size: 12px;
		color: var(--muted);
	}
	.note {
		display: flex;
		align-items: flex-start;
		gap: 7px;
		background: rgba(77, 171, 247, 0.06);
		border: 1px solid rgba(77, 171, 247, 0.28);
		border-radius: 7px;
		padding: 9px 11px;
		font-size: 11.5px;
		color: var(--muted);
		line-height: 1.45;
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
	@media (max-width: 760px) {
		.line {
			flex-wrap: wrap;
		}
		.kind,
		.styles,
		.afterstyle,
		.mode {
			width: 100%;
		}
	}
</style>
