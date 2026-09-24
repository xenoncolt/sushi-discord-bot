<script lang="ts">
	import { CalendarCheck, CalendarDays, ExternalLink, Info, RefreshCw } from "@lucide/svelte";
	import { api } from "$lib/api";
	import Card from "$lib/components/Card.svelte";
	import ChannelSelect from "$lib/components/ChannelSelect.svelte";
	import V2Preview, { renderMarkdown } from "$lib/components/V2Preview.svelte";
	import { Autosave, useGuild } from "$lib/guild.svelte";
	import { session } from "$lib/session.svelte";
	import { toast } from "$lib/toast.svelte";

	const g = useGuild();
	const s = new Autosave(g, "leaderboard");
	let refreshing = $state(false);

	const name = $derived(g.guild.name);
	const xp = $derived(g.settings.server.xp_name);
	const defaults = $derived({
		xp: `${name} leaderboard`,
		monthly: `${name} monthly leaderboard`,
		total: `${name} Attendance Total Leaderboard`,
		streak: `${name} Attendance Streak Leaderboard`
	});

	const samples = $derived({
		xp: [`🥇 <@a> · Level 42 · 15,230 ${xp}`, `🥈 <@b> · Level 38 · 12,100 ${xp}`, `🥉 <@c> · Level 35 · 10,500 ${xp}`],
		monthly: [`🥇 <@b> · Level 38 · 3,200 ${xp}`, `🥈 <@a> · Level 42 · 2,850 ${xp}`, `🥉 <@c> · Level 30 · 2,100 ${xp}`],
		total: ["🥇 <@a> · 127 times", "🥈 <@b> · 98 times", "🥉 <@c> · 85 times"],
		streak: ["🥇 <@b> · 23 days", "🥈 <@a> · 15 days", "🥉 <@c> · 7 days"]
	});
	const names = { a: "Duckko", b: "Alice", c: "Bob" };

	function preview(type: "xp" | "monthly" | "total" | "streak"): string {
		const title = s.value.titles[type].trim() || defaults[type];
		return renderMarkdown(`## ${title}\n${samples[type].join("\n")}`, names);
	}

	const channels = [
		{ key: "xp_channel", title: "Leaderboard channel", desc: "Channel to display leaderboard embed", icon: null },
		{ key: "monthly_channel", title: "Monthly leaderboard channel", desc: "Channel to display monthly leaderboard embed", icon: null },
		{ key: "total_channel", title: "Total attendance leaderboard channel", desc: "Channel to display total attendance leaderboard embed", icon: CalendarDays },
		{ key: "streak_channel", title: "Streak attendance leaderboard channel", desc: "Channel to display streak attendance leaderboard embed", icon: CalendarCheck }
	] as const;

	async function refresh() {
		await s.flush();
		refreshing = true;
		try {
			const r = await api<{ message: string }>(`/guilds/${g.guild.id}/test/leaderboard`, { method: "POST", body: {} });
			toast(r.message);
		} catch (err) {
			toast((err as Error).message, "error");
		} finally {
			refreshing = false;
		}
	}
</script>

<svelte:head><title>Leaderboard · {g.guild.name}</title></svelte:head>

<div class="page-head row">
	<div>
		<h1>Leaderboard</h1>
		<p>Set up leaderboard display channels and options.</p>
	</div>
	<span class="spacer"></span>
	<a class="btn" href="/leaderboard/{g.guild.id}" target="_blank" rel="noopener"><ExternalLink size={14} /> Web leaderboard</a>
</div>

<div class="stack">
	{#each channels as c (c.key)}
		<section class="card">
			<div class="row">
				<div class="spacer">
					<div class="card-title">{#if c.icon}<c.icon size={15} />{/if}{c.title}</div>
					<div class="card-desc">{c.desc}</div>
				</div>
				<div class="aside-select"><ChannelSelect bind:value={s.value[c.key]} compact /></div>
			</div>
		</section>
	{/each}

	<Card title="Leaderboard Custom" desc="Titles and colour of the leaderboard posts. Leave a title empty to use the default." premium>
		<div class="grid grid-2">
			<div>
				<label class="label" for="t-xp">XP Leaderboard Title</label>
				<input id="t-xp" class="input" maxlength="100" placeholder={defaults.xp} bind:value={s.value.titles.xp} />
			</div>
			<div>
				<label class="label" for="t-mo">Monthly Leaderboard Title</label>
				<input id="t-mo" class="input" maxlength="100" placeholder={defaults.monthly} bind:value={s.value.titles.monthly} />
			</div>
			<div>
				<label class="label" for="t-to">Attendance Total Title</label>
				<input id="t-to" class="input" maxlength="100" placeholder={defaults.total} bind:value={s.value.titles.total} />
			</div>
			<div>
				<label class="label" for="t-st">Attendance Streak Title</label>
				<input id="t-st" class="input" maxlength="100" placeholder={defaults.streak} bind:value={s.value.titles.streak} />
			</div>
			<div>
				<label class="label" for="t-color">Accent colour</label>
				<div class="row">
					<input id="t-color" type="color" class="swatch" bind:value={s.value.color} />
					<input class="input mono" maxlength="7" bind:value={s.value.color} />
				</div>
			</div>
		</div>

		<span class="label" style="margin-top: 18px">Preview</span>
		<div class="previews">
			{#each ["xp", "monthly", "total", "streak"] as const as type (type)}
				<V2Preview
					color={s.value.color}
					html={preview(type)}
					footer={renderMarkdown("Updated 5 minutes ago · refreshes every hour")}
					bot_name={session.me?.bot?.name ?? "LeaderBoard"}
					bot_avatar={session.me?.bot?.avatar ?? "/favicon.svg"}
				/>
			{/each}
		</div>
	</Card>

	<div class="info-box row">
		<Info size={16} color="#4dabf7" />
		<div class="spacer">
			The leaderboard is updated every hour.<br />
			<span class="muted">If the leaderboard is not updated, please check that the bot can view and send messages in the channel.</span>
		</div>
		<button class="btn" disabled={refreshing} onclick={refresh}><RefreshCw size={14} /> Refresh now</button>
	</div>
</div>

<style>
	.aside-select {
		width: 220px;
	}
	.swatch {
		width: 42px;
		height: 38px;
		border: 1px solid var(--input-border);
		border-radius: 6px;
		background: var(--input);
		padding: 3px;
		flex: none;
	}
	.previews {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 12px;
	}
	@media (max-width: 1100px) {
		.previews {
			grid-template-columns: 1fr;
		}
	}
</style>
