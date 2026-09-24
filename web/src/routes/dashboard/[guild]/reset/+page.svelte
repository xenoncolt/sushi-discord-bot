<script lang="ts">
	import { TriangleAlert, Search } from "@lucide/svelte";
	import { api, type MemberRow, type Settings } from "$lib/api";
	import Card from "$lib/components/Card.svelte";
	import Modal from "$lib/components/Modal.svelte";
	import Segmented from "$lib/components/Segmented.svelte";
	import { fmt } from "$lib/formula";
	import { useGuild } from "$lib/guild.svelte";
	import { toast } from "$lib/toast.svelte";

	const g = useGuild();

	let target = $state<"exp" | "attendance" | "both">("exp");
	let confirming = $state<null | { title: string; text: string; body: Record<string, unknown>; typed?: boolean }>(null);
	let typed = $state("");
	let busy = $state(false);

	// member lookup
	let q = $state("");
	let found = $state<MemberRow[]>([]);
	let timer: ReturnType<typeof setTimeout>;
	function search() {
		clearTimeout(timer);
		timer = setTimeout(async () => {
			if (!q.trim()) return (found = []);
			const r = await api<{ members: MemberRow[] }>(`/guilds/${g.guild.id}/members?q=${encodeURIComponent(q.trim())}`).catch(() => ({ members: [] }));
			found = r.members.slice(0, 8);
		}, 300);
	}

	const LABEL = { exp: "EXP", attendance: "attendance (total & streak)", both: "EXP and attendance" };

	async function run() {
		if (!confirming) return;
		busy = true;
		try {
			const r = await api<{ message: string }>(`/guilds/${g.guild.id}/reset`, { method: "POST", body: { ...confirming.body, confirm: typed } });
			toast(r.message, "success", 5000);
			if (confirming.body.target === "settings" || confirming.body.target === "everything") {
				g.settings = await api<Settings>(`/guilds/${g.guild.id}/settings`);
			}
			found = [];
			q = "";
			confirming = null;
		} catch (err) {
			toast((err as Error).message, "error", 6000);
		} finally {
			busy = false;
		}
	}

	function ask(title: string, text: string, body: Record<string, unknown>, needs_name = false) {
		typed = "";
		confirming = { title, text, body, typed: needs_name };
	}
</script>

<svelte:head><title>Reset · {g.guild.name}</title></svelte:head>

<div class="page-head">
	<h1>Reset</h1>
	<p>Wipe XP, attendance, a single member, or settings. These can't be undone.</p>
</div>

{#if !g.isAdmin}
	<div class="warn-box">Only server admins (Manage Server) can reset data.</div>
{:else}
	<div class="stack">
		<Card title="Reset the season now" desc="The current rankings are archived as a past season (viewable on the web leaderboard) and announced in the Season Announcement Channel if one is set.">
			<div class="row wrap" style="align-items: flex-end">
				<div style="width: 300px">
					<span class="label">What to reset</span>
					<Segmented bind:value={target} options={[{ value: "exp", label: "EXP" }, { value: "attendance", label: "Attendance" }, { value: "both", label: "Both" }]} />
				</div>
				<button class="btn danger" onclick={() => ask("Reset season", `Everyone's ${LABEL[target]} goes back to 0. The current rankings are saved as a past season first.`, { target })}>Reset now</button>
			</div>
		</Card>

		<Card title="Reset one member" desc="Delete all XP and attendance of a single member.">
			<div class="search">
				<Search size={15} />
				<input placeholder="Search a member" bind:value={q} oninput={search} />
			</div>
			{#each found as m (m.user_id)}
				<div class="member">
					{#if m.avatar}<img class="avatar" src={m.avatar} alt="" />{/if}
					<span class="spacer">{m.name} <span class="faint">· level {m.level} · {fmt(m.xp)} XP</span></span>
					<button class="btn danger sm" onclick={() => ask(`Reset ${m.name}`, `All of ${m.name}'s XP, level and attendance will be deleted.`, { target: "user", user_id: m.user_id })}>Reset</button>
				</div>
			{/each}
		</Card>

		<Card title="Reset settings" desc="Put every dashboard setting back to its default. Member data and the shop stay as they are.">
			<button class="btn danger" onclick={() => ask("Reset settings", "Every setting on every page returns to its default value.", { target: "settings" })}>Reset settings</button>
		</Card>

		<section class="card danger-zone">
			<div class="card-title"><TriangleAlert size={16} /> Delete everything</div>
			<div class="card-desc">Members, attendance, activity, statistics, shop items, purchases, past seasons and settings — all of it, for this server only.</div>
			<button class="btn danger" style="margin-top: 12px" onclick={() => ask("Delete everything", "This wipes all leveling data for this server. Type the server name to confirm.", { target: "everything" }, true)}>Delete everything</button>
		</section>
	</div>
{/if}

{#if confirming}
	<Modal title={confirming.title} onclose={() => (confirming = null)}>
		<p class="muted" style="margin-top: 0">{confirming.text}</p>
		{#if confirming.typed}
			<label class="label" for="confirm-name">Type <strong>{g.guild.name}</strong></label>
			<input id="confirm-name" class="input" bind:value={typed} />
		{/if}
		<div class="row" style="justify-content: flex-end; margin-top: 16px">
			<button class="btn" onclick={() => (confirming = null)}>Cancel</button>
			<button class="btn danger" disabled={busy || (confirming.typed && typed !== g.guild.name)} onclick={run}>Yes, reset</button>
		</div>
	</Modal>
{/if}

<style>
	.search {
		display: flex;
		align-items: center;
		gap: 8px;
		max-width: 360px;
		background: var(--input);
		border: 1px solid var(--input-border);
		border-radius: 6px;
		padding: 7px 10px;
		color: var(--muted);
	}
	.search input {
		flex: 1;
		border: 0;
		background: transparent;
		outline: none;
		color: var(--text);
		font: inherit;
	}
	.member {
		display: flex;
		align-items: center;
		gap: 10px;
		max-width: 560px;
		padding: 8px 0;
		border-bottom: 1px solid var(--border);
	}
	.danger-zone {
		border-color: rgba(224, 49, 49, 0.45);
		border-left-color: var(--danger);
		background: rgba(224, 49, 49, 0.06);
	}
	.danger-zone .card-title {
		color: #ff8787;
	}
</style>
