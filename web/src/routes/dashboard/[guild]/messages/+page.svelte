<script lang="ts">
	import {
		Braces, Check, Copy, Download, FileDown, Link2, Plus, Send, Sparkles, SquarePen, Trash2,
		TriangleAlert, Unlink
	} from "@lucide/svelte";
	import { api, MSG_LIMITS, type MessageDoc, type MessageSummary, type SavedMessage, type SendResult } from "$lib/api";
	import Card from "$lib/components/Card.svelte";
	import ChannelSelect from "$lib/components/ChannelSelect.svelte";
	import DragList from "$lib/components/DragList.svelte";
	import Modal from "$lib/components/Modal.svelte";
	import Segmented from "$lib/components/Segmented.svelte";
	import Toggle from "$lib/components/Toggle.svelte";
	import AddBar from "$lib/components/msg/AddBar.svelte";
	import EmbedForm from "$lib/components/msg/EmbedForm.svelte";
	import MessagePreview from "$lib/components/msg/MessagePreview.svelte";
	import NodeForm from "$lib/components/msg/NodeForm.svelte";
	import RowForm from "$lib/components/msg/RowForm.svelte";
	import MediaField from "$lib/components/msg/MediaField.svelte";
	import { useGuild } from "$lib/guild.svelte";
	import {
		countEmbedText, countFiles, countNodes, countV2Text, docProblems, emptyDoc, newEmbed, newMedia,
		newNode, newRow, reKey, rowProblem
	} from "$lib/msgdoc";
	import { session } from "$lib/session.svelte";
	import { toast } from "$lib/toast.svelte";
	import type { NodeType } from "$lib/api";

	const g = useGuild();

	let list = $state<MessageSummary[]>([]);
	let current = $state<SavedMessage | null>(null);
	let doc = $state<MessageDoc>(emptyDoc());
	let name = $state("");
	let loading = $state(true);
	let busy = $state("");

	// Where a Send would go. Starts from wherever this draft last landed.
	let channel = $state<string | null>(null);
	let last = $state<SendResult | null>(null);

	let show_json = $state(false);
	let show_import = $state(false);
	let json_text = $state("");
	let import_link = $state("");

	// ---- loading and saving -----------------------------------------------

	async function refresh() {
		list = await api<MessageSummary[]>(`/guilds/${g.guild.id}/messages`);
	}

	async function open(id: number) {
		await flush();
		const saved = await api<SavedMessage>(`/guilds/${g.guild.id}/messages/${id}`);
		adopt(saved);
	}

	function adopt(saved: SavedMessage) {
		current = saved;
		doc = saved.doc;
		name = saved.name;
		channel = saved.channel_id;
		saved_json = JSON.stringify({ name, doc });
		last = null;
	}

	$effect(() => {
		refresh()
			.then(() => {
				if (list.length) return open(list[0].id);
			})
			.catch(err => toast((err as Error).message, "error", 6000))
			.finally(() => (loading = false));
	});

	// Autosave, the same way the settings pages do it: whatever is on screen is
	// what is stored, a beat after the typing stops. A dropdown in a posted
	// message reads its roles back off the saved draft, so leaving an edit
	// unsaved would quietly change what that menu hands out.
	let saved_json = "";
	let timer: ReturnType<typeof setTimeout> | null = null;
	let saving = $state(false);

	const live_json = $derived(current ? JSON.stringify({ name, doc }) : "");
	const dirty = $derived(Boolean(current) && live_json !== saved_json);

	$effect(() => {
		if (!dirty) return;
		if (timer) clearTimeout(timer);
		timer = setTimeout(flush, 700);
	});

	async function flush() {
		if (timer) clearTimeout(timer);
		timer = null;
		if (!current) return;

		const body = { name, doc: JSON.parse(JSON.stringify(doc)) as MessageDoc };
		const sent = JSON.stringify(body);
		if (sent === saved_json) return;

		saving = true;
		try {
			const saved = await api<SavedMessage>(`/guilds/${g.guild.id}/messages/${current.id}`, { method: "PATCH", body });
			saved_json = sent;
			current = saved;
			// Keep the row in the sidebar in step without a second request.
			list = list.map(m => (m.id === saved.id ? { ...m, name: saved.name, mode: saved.mode, updated_at: saved.updated_at } : m));
		} catch (err) {
			toast((err as Error).message, "error", 6000);
		} finally {
			saving = false;
		}
	}

	// ---- the list ----------------------------------------------------------

	async function create() {
		busy = "new";
		try {
			const saved = await api<SavedMessage>(`/guilds/${g.guild.id}/messages`, {
				method: "POST",
				body: { name: `Message ${list.length + 1}`, doc: emptyDoc() }
			});
			list = [saved, ...list];
			adopt(saved);
		} catch (err) {
			toast((err as Error).message, "error", 6000);
		} finally {
			busy = "";
		}
	}

	async function duplicate() {
		if (!current) return;
		await flush();
		busy = "copy";
		try {
			const saved = await api<SavedMessage>(`/guilds/${g.guild.id}/messages`, {
				method: "POST",
				body: { name: `${current.name} (copy)`, doc: JSON.parse(JSON.stringify(doc)) }
			});
			list = [saved, ...list];
			adopt(saved);
			toast("Copied.");
		} catch (err) {
			toast((err as Error).message, "error", 6000);
		} finally {
			busy = "";
		}
	}

	async function remove(id: number, label: string) {
		if (!confirm(`Delete “${label}”? Anything already posted stays where it is — but its dropdowns stop working.`)) return;
		try {
			await api(`/guilds/${g.guild.id}/messages/${id}`, { method: "DELETE" });
			list = list.filter(m => m.id !== id);
			if (current?.id === id) {
				current = null;
				saved_json = "";
				if (list.length) await open(list[0].id);
			}
			toast("Deleted.");
		} catch (err) {
			toast((err as Error).message, "error", 6000);
		}
	}

	// ---- sending -----------------------------------------------------------

	const problems = $derived(docProblems(doc));

	async function send() {
		if (!current || !channel) return;
		await flush();
		busy = "send";
		try {
			const res = await api<SendResult>(`/guilds/${g.guild.id}/messages/${current.id}/send`, { method: "POST", body: { channel_id: channel } });
			last = res;
			current = { ...current, channel_id: res.channel_id, message_id: res.message_id };
			list = list.map(m => (m.id === current!.id ? { ...m, channel_id: res.channel_id, message_id: res.message_id } : m));
			toast(res.message);
		} catch (err) {
			toast((err as Error).message, "error", 8000);
		} finally {
			busy = "";
		}
	}

	async function update() {
		if (!current?.message_id) return;
		await flush();
		busy = "update";
		try {
			const res = await api<SendResult>(`/guilds/${g.guild.id}/messages/${current.id}/update`, { method: "POST", body: {} });
			last = res;
			toast(res.message);
		} catch (err) {
			toast((err as Error).message, "error", 8000);
			// The posted copy may have been deleted, in which case the bot has
			// already let go of it — reload so the buttons match reality.
			if (current) await open(current.id).catch(() => {});
		} finally {
			busy = "";
		}
	}

	async function attach(link: string | null) {
		if (!current) return;
		busy = "attach";
		try {
			const saved = await api<SavedMessage>(`/guilds/${g.guild.id}/messages/${current.id}/attach`, { method: "POST", body: { link } });
			current = saved;
			channel = saved.channel_id;
			list = list.map(m => (m.id === saved.id ? { ...m, channel_id: saved.channel_id, message_id: saved.message_id } : m));
			toast(link ? "Linked to that message — Update will rewrite it." : "Let go of the posted copy.");
		} catch (err) {
			toast((err as Error).message, "error", 8000);
		} finally {
			busy = "";
		}
	}

	async function importMessage() {
		busy = "import";
		try {
			const saved = await api<SavedMessage>(`/guilds/${g.guild.id}/messages/import`, { method: "POST", body: { link: import_link } });
			list = [saved, ...list];
			adopt(saved);
			show_import = false;
			import_link = "";
			toast("Read it in — this draft now edits that message.");
			for (const warning of saved.warnings ?? []) toast(warning, "error", 9000);
		} catch (err) {
			toast((err as Error).message, "error", 8000);
		} finally {
			busy = "";
		}
	}

	// ---- json in and out ----------------------------------------------------

	function openJson() {
		json_text = JSON.stringify(doc, null, 2);
		show_json = true;
	}

	function applyJson() {
		try {
			const parsed = JSON.parse(json_text);
			if (!parsed || typeof parsed !== "object") throw new Error("That isn't a message.");
			// Straight into the document: the bot sanitises everything it is
			// sent, so a stray field is dropped on the next save rather than
			// breaking anything here.
			doc = { ...emptyDoc(), ...parsed };
			show_json = false;
			toast("Loaded. Check it over before sending.");
		} catch (err) {
			toast((err as Error).message, "error", 6000);
		}
	}

	async function copyJson() {
		await navigator.clipboard.writeText(json_text).catch(() => {});
		toast("Copied to the clipboard.");
	}

	// ---- editing -------------------------------------------------------------

	function addNode(type: NodeType) {
		doc.nodes = [...doc.nodes, newNode(type)];
	}

	function removeNode(id: string) {
		doc.nodes = doc.nodes.filter(n => n.id !== id);
	}

	function duplicateNode(i: number) {
		doc.nodes = [...doc.nodes.slice(0, i + 1), reKey(doc.nodes[i]), ...doc.nodes.slice(i + 1)];
	}

	// ---- counters and the preview ---------------------------------------------

	const components = $derived(countNodes(doc.nodes));
	const v2_text = $derived(countV2Text(doc.nodes));
	const embed_text = $derived(countEmbedText(doc.embeds));
	const files = $derived(countFiles(doc));

	const me = $derived(session.me?.user);
	const mentions = $derived<Record<string, string>>({
		...Object.fromEntries(g.channels.map(c => [`#${c.id}`, c.name])),
		...Object.fromEntries(g.roles.map(r => [`&${r.id}`, r.name])),
		...(me ? { [me.id]: me.global_name ?? me.username } : {})
	});

	const posted_channel = $derived(g.channel(current?.channel_id)?.name ?? "a channel");
</script>

<svelte:head><title>Messages · {g.guild.name}</title></svelte:head>

<div class="page-head">
	<h1>Message Builder</h1>
	<p>
		Build anything the bot can post — a plain message, embeds, or a Components V2 layout — then pick a channel and send it. Drag the blocks into whatever
		order you want; the panel on the right is what lands in Discord.
	</p>
</div>

{#if loading}
	<div class="empty">Loading…</div>
{:else}
	<div class="mb">
		<aside class="side">
			<div class="side-head">
				<span class="label" style="margin: 0">Saved messages</span>
				<span class="faint">{list.length}</span>
			</div>

			<div class="rows">
				{#each list as m (m.id)}
					<button class="mrow" class:on={current?.id === m.id} onclick={() => open(m.id).catch(err => toast((err as Error).message, "error"))}>
						<span class="mname">{m.name}</span>
						<span class="mmeta">
							<span class="tag">{m.mode === "v2" ? "V2" : "classic"}</span>
							{#if m.message_id}<span class="tag posted">posted</span>{/if}
						</span>
					</button>
				{/each}
				{#if !list.length}
					<div class="empty" style="padding: 10px 0">Nothing saved yet.</div>
				{/if}
			</div>

			<div class="side-foot">
				<button class="btn sm primary" disabled={busy === "new"} onclick={create}><Plus size={13} /> New message</button>
				<button class="btn sm" onclick={() => (show_import = true)}><FileDown size={13} /> From a link</button>
			</div>
		</aside>

		{#if !current}
			<Card title="Nothing open" desc="Make a message, or read one the bot already posted back in to edit it.">
				<div class="row">
					<button class="btn primary" onclick={create}><Plus size={14} /> New message</button>
					<button class="btn" onclick={() => (show_import = true)}><FileDown size={14} /> Import from a message link</button>
				</div>
			</Card>
		{:else}
			<div class="edit">
				<Card title="This message" desc="A name only you see, and which of Discord's two message shapes to build.">
					{#snippet aside()}
						<div class="row">
							<span class="faint">{saving ? "Saving…" : dirty ? "Unsaved" : "Saved"}</span>
							<button class="btn icon" title="Duplicate this message" aria-label="Duplicate this message" disabled={busy === "copy"} onclick={duplicate}>
								<Copy size={14} />
							</button>
							<button class="btn icon" title="Delete this message" aria-label="Delete this message" onclick={() => remove(current!.id, current!.name)}>
								<Trash2 size={14} />
							</button>
						</div>
					{/snippet}

					<div class="grid grid-2">
						<div>
							<label class="label" for="m-name">Name</label>
							<input id="m-name" class="input" maxlength={MSG_LIMITS.name} bind:value={name} />
						</div>
						<div>
							<span class="label">Shape</span>
							<Segmented
								bind:value={doc.mode}
								options={[
									{ value: "v2", label: "Components V2" },
									{ value: "classic", label: "Text & embeds" }
								]}
							/>
							<div class="hint">
								{#if doc.mode === "v2"}
									Containers, sections, galleries and buttons anywhere. No plain text or embeds — Discord won't take both in one message.
								{:else}
									The familiar shape: a line of text, up to ten embeds, and button rows underneath.
								{/if}
							</div>
						</div>
					</div>
				</Card>

				<Card title="Send it" desc="Pick a channel and post. The draft is saved first, so what goes out is what you see.">
					<div class="row wrap">
						<div class="pick"><ChannelSelect bind:value={channel} types={["text", "announcement"]} placeholder="Pick a channel" /></div>
						<button class="btn primary" disabled={!channel || busy === "send" || problems.length > 0} onclick={send}>
							<Send size={14} />
							{busy === "send" ? "Posting…" : "Send"}
						</button>
						{#if current.message_id}
							<button class="btn" disabled={busy === "update" || problems.length > 0} onclick={update}>
								<SquarePen size={14} />
								{busy === "update" ? "Updating…" : "Update the posted copy"}
							</button>
						{/if}
					</div>

					{#if current.message_id}
						<div class="note">
							<Check size={13} /> Posted in <strong>#{posted_channel}</strong> ·
							<a class="link" href="https://discord.com/channels/{g.guild.id}/{current.channel_id}/{current.message_id}" target="_blank" rel="noopener">open it</a>
							<button class="btn icon" title="Stop editing that copy" aria-label="Stop editing that copy" onclick={() => attach(null)}><Unlink size={13} /></button>
						</div>
					{/if}

					{#if problems.length}
						<div class="warn-box" style="margin-top: 12px">
							<strong><TriangleAlert size={13} /> Not sendable yet</strong>
							<ul>{#each problems as p (p)}<li>{p}</li>{/each}</ul>
						</div>
					{/if}

					{#if last?.dropped.length}
						<div class="info-box" style="margin-top: 12px">
							<strong>Left out of the last send</strong>
							<ul>{#each last.dropped as d (d)}<li>{d}</li>{/each}</ul>
						</div>
					{/if}

					{#if files > 0}
						<div class="hint">
							{files} file{files === 1 ? "" : "s"} will be downloaded and uploaded with the message. A message with uploads can't be edited in place
							afterwards.
						</div>
					{/if}
				</Card>

				<Card title="Compose" desc={doc.mode === "v2" ? "Every block, in the order it will appear. Drag a handle to move one." : "Text, embeds and the rows of components underneath."}>
					{#snippet aside()}
						<span class="faint">
							{#if doc.mode === "v2"}
								{components}/{MSG_LIMITS.v2_total} components · {v2_text.toLocaleString()}/{MSG_LIMITS.v2_text.toLocaleString()} chars
							{:else}
								{embed_text.toLocaleString()}/{MSG_LIMITS.embed_total.toLocaleString()} embed chars
							{/if}
						</span>
					{/snippet}

					{#if doc.mode === "v2"}
						<DragList bind:items={doc.nodes} id={n => n.id} gap={10}>
							{#snippet item(n, i)}
								<NodeForm bind:node={doc.nodes[i]} onremove={() => removeNode(n.id)} onduplicate={() => duplicateNode(i)} />
							{/snippet}
						</DragList>

						{#if !doc.nodes.length}<div class="empty">Nothing here yet — add a block below.</div>{/if}

						<div style="margin-top: 12px">
							<AddBar onadd={addNode} disabled={doc.nodes.length >= MSG_LIMITS.v2_top} note="{doc.nodes.length}/{MSG_LIMITS.v2_top} at the top level" />
						</div>
						<div class="hint">
							Most messages want one container holding everything — it draws the card with the coloured stripe. Blocks at the top level sit bare on the
							channel background.
						</div>
					{:else}
						<div>
							<label class="label" for="m-content">Message text · {doc.content.length}/{MSG_LIMITS.content}</label>
							<textarea id="m-content" class="input" rows="4" maxlength={MSG_LIMITS.content} placeholder="What the bot says. Markdown works." bind:value={doc.content}></textarea>
						</div>

						<div class="block">
							<div class="row">
								<span class="label" style="margin: 0">Embeds</span>
								<span class="spacer"></span>
								<span class="faint">{doc.embeds.length}/{MSG_LIMITS.embeds}</span>
							</div>
							<DragList bind:items={doc.embeds} id={e => e.id} gap={10}>
								{#snippet item(e, i)}
									<div class="panel">
										<div class="panel-head">
											<strong>{e.title.trim() || `Embed ${i + 1}`}</strong>
											<span class="spacer"></span>
											<button class="btn icon" title="Remove this embed" aria-label="Remove this embed" onclick={() => (doc.embeds = doc.embeds.filter(x => x.id !== e.id))}>
												<Trash2 size={13} />
											</button>
										</div>
										<div class="panel-body"><EmbedForm bind:embed={doc.embeds[i]} /></div>
									</div>
								{/snippet}
							</DragList>
							<button class="btn sm" style="margin-top: 8px" disabled={doc.embeds.length >= MSG_LIMITS.embeds} onclick={() => (doc.embeds = [...doc.embeds, newEmbed()])}>
								<Plus size={13} /> Embed
							</button>
						</div>

						<div class="block">
							<div class="row">
								<span class="label" style="margin: 0">Component rows</span>
								<span class="spacer"></span>
								<span class="faint">{doc.rows.length}/{MSG_LIMITS.rows}</span>
							</div>
							<DragList bind:items={doc.rows} id={r => r.id} gap={10}>
								{#snippet item(r, i)}
									<div class="panel">
										<div class="panel-head">
											<strong>Row {i + 1}</strong>
											{#if rowProblem(r)}<span class="warnpill"><TriangleAlert size={11} /> {rowProblem(r)}</span>{/if}
											<span class="spacer"></span>
											<button class="btn icon" title="Remove this row" aria-label="Remove this row" onclick={() => (doc.rows = doc.rows.filter(x => x.id !== r.id))}>
												<Trash2 size={13} />
											</button>
										</div>
										<div class="panel-body"><RowForm bind:row={doc.rows[i]} /></div>
									</div>
								{/snippet}
							</DragList>
							<button class="btn sm" style="margin-top: 8px" disabled={doc.rows.length >= MSG_LIMITS.rows} onclick={() => (doc.rows = [...doc.rows, newRow()])}>
								<Plus size={13} /> Row
							</button>
						</div>

						<div class="block">
							<div class="row">
								<span class="label" style="margin: 0">Attachments</span>
								<span class="spacer"></span>
								<span class="faint">{doc.attachments.length}/{MSG_LIMITS.files}</span>
							</div>
							<DragList bind:items={doc.attachments} id={a => a.id} gap={8}>
								{#snippet item(a, i)}
									<MediaField bind:media={doc.attachments[i]} placeholder="https://… — downloaded and uploaded with the message" withAlt={false} />
								{/snippet}
								{#snippet tools(a)}
									<button class="btn icon" title="Remove this file" aria-label="Remove this file" onclick={() => (doc.attachments = doc.attachments.filter(x => x.id !== a.id))}>
										<Trash2 size={13} />
									</button>
								{/snippet}
							</DragList>
							<button class="btn sm" style="margin-top: 8px" disabled={doc.attachments.length >= MSG_LIMITS.files} onclick={() => (doc.attachments = [...doc.attachments, newMedia()])}>
								<Plus size={13} /> File
							</button>
						</div>
					{/if}
				</Card>

				<Card title="How it's posted" desc="The switches Discord puts on a message itself rather than on its contents.">
					<div class="grid grid-2">
						<div>
							<span class="label">Who the text may ping</span>
							<div class="pings">
								<div class="ping"><Toggle bind:checked={doc.mentions.users} label="Users" /> <span class="muted">People — <span class="mono">{"<@id>"}</span></span></div>
								<div class="ping"><Toggle bind:checked={doc.mentions.roles} label="Roles" /> <span class="muted">Roles — <span class="mono">{"<@&id>"}</span></span></div>
								<div class="ping"><Toggle bind:checked={doc.mentions.everyone} label="Everyone" /> <span class="muted">@everyone and @here</span></div>
							</div>
							<div class="hint">A mention that isn't allowed still shows up as a mention — it just doesn't notify anybody.</div>
						</div>
						<div>
							<span class="label">Delivery</span>
							<div class="pings">
								<div class="ping"><Toggle bind:checked={doc.silent} label="Silent" /> <span class="muted">Silent — no ping sound, no unread badge</span></div>
								<div class="ping"><Toggle bind:checked={doc.tts} label="Text to speech" /> <span class="muted">Read aloud to anyone in the channel</span></div>
								{#if doc.mode === "classic"}
									<div class="ping"><Toggle bind:checked={doc.suppress_embeds} label="Hide link previews" /> <span class="muted">Hide the automatic previews of links in the text</span></div>
								{/if}
							</div>
						</div>
					</div>

					<div class="row" style="margin-top: 16px">
						<button class="btn sm" onclick={openJson}><Braces size={13} /> JSON</button>
						<span class="hint" style="margin: 0">Copy this message out, or paste one in from somewhere else.</span>
					</div>
				</Card>
			</div>

			<div class="preview">
				<div class="sticky">
					<div class="prev-head">
						<Sparkles size={13} />
						<span>Preview</span>
						<span class="spacer"></span>
						<span class="faint">#{g.channel(channel)?.name ?? "nowhere yet"}</span>
					</div>
					<MessagePreview
						{doc}
						{mentions}
						bot_name={session.me?.bot?.name ?? "Bot"}
						bot_avatar={session.me?.bot?.avatar ?? "/favicon.svg"}
					/>
					<div class="hint">
						Custom emoji, timestamps like <span class="mono">{"<t:1700000000:R>"}</span> and channel mentions like <span class="mono">{"<#id>"}</span> all
						render here the way Discord shows them.
					</div>
				</div>
			</div>
		{/if}
	</div>
{/if}

{#if show_import}
	<Modal title="Import a posted message" onclose={() => (show_import = false)} width={520}>
		<p class="muted">
			Paste a link to a message <strong>I</strong> posted — right-click it in Discord and pick Copy Message Link. It comes in as a new draft, already
			pointed at that message, so Update rewrites it.
		</p>
		<input class="input" placeholder="https://discord.com/channels/…" bind:value={import_link} />
		<div class="hint">Buttons another part of the bot answers come in as dead labels, and anything uploaded with the original has to be added again by URL.</div>
		<div class="row" style="margin-top: 16px">
			<button class="btn primary" disabled={!import_link.trim() || busy === "import"} onclick={importMessage}><Link2 size={14} /> Import</button>
			<button class="btn" onclick={() => (show_import = false)}>Cancel</button>
			{#if current}
				<span class="spacer"></span>
				<button
					class="btn sm"
					disabled={!import_link.trim() || busy === "attach"}
					onclick={() => {
						attach(import_link);
						show_import = false;
					}}
				>
					Point this draft at it instead
				</button>
			{/if}
		</div>
	</Modal>
{/if}

{#if show_json}
	<Modal title="Message JSON" onclose={() => (show_json = false)} width={720}>
		<textarea class="input mono" rows="18" spellcheck="false" bind:value={json_text}></textarea>
		<div class="row" style="margin-top: 14px">
			<button class="btn primary" onclick={applyJson}><Download size={14} /> Load this into the builder</button>
			<button class="btn" onclick={copyJson}><Copy size={14} /> Copy</button>
			<span class="spacer"></span>
			<button class="btn" onclick={() => (show_json = false)}>Close</button>
		</div>
		<div class="hint">This is the builder's own format, not Discord's API payload — it round-trips everything, including the role buttons.</div>
	</Modal>
{/if}

<style>
	.mb {
		display: grid;
		grid-template-columns: 220px minmax(0, 1.35fr) minmax(0, 1fr);
		gap: 18px;
		align-items: start;
	}

	/* ---- the list ---- */
	.side {
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 12px;
		position: sticky;
		top: 18px;
	}
	.side-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 8px;
	}
	.rows {
		display: flex;
		flex-direction: column;
		gap: 4px;
		max-height: 46vh;
		overflow-y: auto;
	}
	.mrow {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 3px;
		width: 100%;
		text-align: left;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 6px;
		padding: 7px 9px;
		font-size: 13px;
	}
	.mrow:hover {
		background: var(--card-hover);
	}
	.mrow.on {
		background: var(--accent-soft);
		border-color: rgba(194, 24, 91, 0.4);
	}
	.mname {
		width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.mmeta {
		display: flex;
		gap: 4px;
	}
	.tag {
		font-size: 9.5px;
		font-weight: 700;
		letter-spacing: 0.4px;
		text-transform: uppercase;
		color: var(--faint);
		border: 1px solid var(--input-border);
		border-radius: 3px;
		padding: 0 4px;
	}
	.tag.posted {
		color: var(--success);
		border-color: rgba(55, 178, 77, 0.45);
	}
	.side-foot {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 12px;
		border-top: 1px solid var(--border);
		padding-top: 12px;
	}

	/* ---- the editor ---- */
	.edit {
		display: flex;
		flex-direction: column;
		gap: 16px;
		min-width: 0;
	}
	.block {
		border-top: 1px solid var(--border);
		margin-top: 16px;
		padding-top: 14px;
	}
	.panel {
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
	}
	.panel-head {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 8px 7px 11px;
		background: rgba(0, 0, 0, 0.18);
		border-bottom: 1px solid var(--border);
		font-size: 12.5px;
	}
	.panel-body {
		padding: 11px;
	}
	.warnpill {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
		color: var(--warning);
	}
	.pick {
		width: 260px;
		flex: none;
	}
	.pings {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.ping {
		display: flex;
		align-items: center;
		gap: 9px;
		font-size: 12.5px;
		cursor: pointer;
	}
	.note {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 12px;
		font-size: 12.5px;
		color: var(--muted);
	}
	.link {
		color: var(--info);
		text-decoration: underline;
	}
	.warn-box strong,
	.info-box strong {
		display: flex;
		align-items: center;
		gap: 5px;
		margin-bottom: 4px;
	}
	.warn-box ul,
	.info-box ul {
		margin: 0;
		padding-left: 20px;
	}

	/* ---- the preview ---- */
	.preview {
		min-width: 0;
	}
	.sticky {
		position: sticky;
		top: 18px;
	}
	.prev-head {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--muted);
		margin-bottom: 8px;
	}

	.row.wrap {
		flex-wrap: wrap;
	}

	@media (max-width: 1400px) {
		.mb {
			grid-template-columns: 200px minmax(0, 1fr);
		}
		.preview {
			grid-column: 1 / -1;
		}
		.sticky {
			position: static;
		}
	}
	@media (max-width: 900px) {
		.mb {
			grid-template-columns: minmax(0, 1fr);
		}
		.side {
			position: static;
		}
		.pick {
			width: 100%;
		}
	}
</style>
