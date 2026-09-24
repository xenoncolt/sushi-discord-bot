<script lang="ts">
	import { ChartColumn, ExternalLink, Lock, Users } from "@lucide/svelte";
	import { api } from "$lib/api";
	import Card from "$lib/components/Card.svelte";
	import ChannelSelect from "$lib/components/ChannelSelect.svelte";
	import Segmented from "$lib/components/Segmented.svelte";
	import Toggle from "$lib/components/Toggle.svelte";
	import { Autosave, useGuild } from "$lib/guild.svelte";

	const g = useGuild();
	const s = new Autosave(g, "season");
	const v = $derived(s.value);

	const PERIOD_TEXT: Record<string, string> = {
		monthly: "Resets on the 1st of every month.",
		quarterly: "Resets on the 1st of January, April, July and October.",
		half: "Resets on the 1st of January and July.",
		yearly: "Resets on the 1st of January.",
		date: "Resets once on the date you pick, then auto-reset switches itself off."
	};

	const next = $derived(g.settings.meta.season_next);
	const tz = $derived(g.settings.server.timezone);

	let seasons = $state<{ id: number; target: string; ended_at: number }[]>([]);
	api<typeof seasons>(`/guilds/${g.guild.id}/seasons`).then(r => (seasons = r)).catch(() => {});

	function when(ms: number): string {
		return new Date(ms).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: tz });
	}
</script>

<svelte:head><title>Season · {g.guild.name}</title></svelte:head>

<div class="page-head">
	<h1>Season</h1>
	<p>Auto-reset EXP/attendance on the schedule you set.</p>
</div>

<div class="stack">
	<Card title="Season Auto-Reset" desc="Auto-reset EXP/attendance on your schedule">
		{#snippet aside()}<Toggle bind:checked={s.value.enabled} label="Season auto-reset" />{/snippet}
		<span class="label">Period ({tz})</span>
		<Segmented
			bind:value={s.value.period}
			options={[
				{ value: "monthly", label: "Monthly" },
				{ value: "quarterly", label: "Quarterly" },
				{ value: "half", label: "Half" },
				{ value: "yearly", label: "Yearly" },
				{ value: "date", label: "Date" }
			]}
		/>
		<div class="hint">{PERIOD_TEXT[v.period]}</div>
		<div class="row wrap" style="margin-top: 14px; align-items: flex-end">
			{#if v.period === "date"}
				<div>
					<label class="label" for="s-date">Date</label>
					<input id="s-date" class="input" type="date" bind:value={s.value.date} />
				</div>
			{/if}
			<div>
				<label class="label" for="s-time">Time (24h)</label>
				<input id="s-time" class="input" type="time" bind:value={s.value.time} style="width: 180px" />
			</div>
			<div class="next">
				{#if v.enabled && next}
					Next reset: <strong>{when(next)}</strong>
				{:else if v.enabled}
					<span class="faint">No upcoming reset{v.period === "date" ? " — pick a date in the future" : ""}.</span>
				{:else}
					<span class="faint">Auto-reset is off.</span>
				{/if}
			</div>
		</div>
		<div class="hint">The timezone comes from the Server page.</div>
	</Card>

	<Card title="Reset Targets" desc="What to reset">
		<div style="max-width: 260px">
			<Segmented
				bind:value={s.value.target}
				size="sm"
				options={[
					{ value: "exp", label: "EXP" },
					{ value: "attendance", label: "Attendance" },
					{ value: "both", label: "Both" }
				]}
			/>
		</div>
		<div class="hint">
			Level roles are automatically re-synced after an EXP reset.<br />
			Resetting attendance zeroes both total and streak counts, and both are archived in the past-season rankings.
		</div>
	</Card>

	<Card title="Season Announcement Channel" desc="Last season ranking & new season start notice">
		{#snippet aside()}<div class="aside-select"><ChannelSelect bind:value={s.value.announce_channel} compact /></div>{/snippet}
		<div class="note"><Users size={13} /> A public channel visible to all members is recommended. Last season's top ranks and the new-season announcement are posted here. (Set to None to skip announcements.)</div>
		<div class="warn-box note" style="margin-top: 10px">
			<ChartColumn size={14} /> The TOP 10 in the announcement follows your reset target — EXP ranking when EXP is reset, total-attendance ranking when only attendance is reset. The full rankings (EXP · total · streak) are always available via the "View full rankings" button attached to the announcement.
		</div>
		<div class="row" style="margin-top: 14px">
			<Toggle bind:checked={s.value.custom_announce} label="Customize announcement message" />
			<span>Customize announcement message</span>
		</div>
		{#if v.custom_announce}
			<div class="stack" style="margin-top: 12px; max-width: 760px">
				<div>
					<label class="label" for="a-title">Title</label>
					<input id="a-title" class="input" maxlength="200" placeholder="🏁 The season has ended!" bind:value={s.value.announce_title} />
				</div>
				<div>
					<label class="label" for="a-body">Message</label>
					<textarea id="a-body" class="input" rows="3" maxlength="1500" placeholder="Thanks for an amazing season, {'{server}'}!" bind:value={s.value.announce_body}></textarea>
					<div class="hint">Placeholders: {"{server}"}, {"{date}"}</div>
				</div>
			</div>
		{/if}
	</Card>

	<Card title="Reset Result Log Channel" desc="Reset & re-sync completion log">
		{#snippet aside()}<div class="aside-select"><ChannelSelect bind:value={s.value.log_channel} compact /></div>{/snippet}
		<div class="note"><Lock size={13} /> An admin-only private channel is recommended. (Set to None to skip the result log.)</div>
	</Card>

	<Card title="Past Seasons" desc="Archived rankings from previous resets">
		{#if seasons.length}
			<div class="seasons">
				{#each seasons as season (season.id)}
					<a class="chip" href="/leaderboard/{g.guild.id}/season/{season.id}" target="_blank" rel="noopener">
						<strong>#{season.id}</strong>
						<span class="muted">{when(season.ended_at)}</span>
						<span class="badge">{season.target}</span>
						<ExternalLink size={12} />
					</a>
				{/each}
			</div>
		{:else}
			<div class="empty">No seasons have ended yet. Resets from the Reset page are archived here too.</div>
		{/if}
	</Card>
</div>

<style>
	.aside-select {
		width: 220px;
	}
	.next {
		padding: 9px 4px;
		font-size: 13px;
	}
	.note {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		font-size: 12px;
		color: var(--muted);
	}
	.seasons {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
</style>
