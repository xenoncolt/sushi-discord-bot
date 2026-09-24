<script lang="ts">
	import { Hash, House, Mic, MessageSquare, Star, Users } from "@lucide/svelte";
	import { api, type Stats } from "$lib/api";
	import AreaChart from "$lib/components/AreaChart.svelte";
	import Segmented from "$lib/components/Segmented.svelte";
	import { fmt } from "$lib/formula";
	import { useGuild } from "$lib/guild.svelte";

	const g = useGuild();

	// Dark-surface steps of the reference categorical palette (blue, orange,
	// aqua, violet), validated together against the card colour. Each chart is
	// a single series, so its title names it and no legend is needed.
	const BLUE = "#3987e5";
	const ORANGE = "#d95926";
	const AQUA = "#199e70";
	const VIOLET = "#9085e9";

	type Range = "day" | "week" | "month" | "year";
	let range = $state<Range>("week");
	let stats = $state<Stats | null>(null);
	let error = $state("");
	let by = $state<"messages" | "xp">("messages");

	$effect(() => {
		const r = range;
		error = "";
		api<Stats>(`/guilds/${g.guild.id}/stats?range=${r}`)
			.then(s => (stats = s))
			.catch(err => (error = err.message));
	});

	const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
	function xlabel(label: string): string {
		if (label.length === 13) return `${label.slice(11)}:00`;
		if (label.length === 7) return MONTHS[Number(label.slice(5, 7)) - 1];
		return `${Number(label.slice(5, 7))}/${Number(label.slice(8, 10))}`;
	}
	function full(label: string): string {
		if (label.length === 13) return `${label.slice(0, 10)} ${label.slice(11)}:00`;
		return label.length === 7 ? `${MONTHS[Number(label.slice(5, 7)) - 1]} ${label.slice(0, 4)}` : label;
	}

	const unit = $derived(range === "day" ? "Hourly" : range === "year" ? "Monthly" : "Daily");

	type Key = "messages" | "voice_hours" | "active_users" | "members";
	const charts = $derived.by(() => {
		if (!stats) return [];
		const list: { title: string; icon: typeof Users; color: string; key: Key; fmt: (n: number) => string }[] = [];
		if (range !== "day") list.push({ title: "Server Members", icon: House, color: VIOLET, key: "members", fmt: (n: number) => fmt(n) });
		list.push({ title: `${unit} Messages`, icon: MessageSquare, color: BLUE, key: "messages", fmt: (n: number) => fmt(n) });
		list.push({ title: `${unit} Voice (hours)`, icon: Mic, color: AQUA, key: "voice_hours", fmt: (n: number) => `${Math.round(n * 10) / 10}h` });
		if (range !== "day") list.push({ title: `${unit} Active Users`, icon: Users, color: ORANGE, key: "active_users", fmt: (n: number) => fmt(n) });
		return list;
	});

	function series(key: Key) {
		return (stats?.points ?? []).filter(p => p[key] !== null).map(p => ({ label: p.label, value: p[key] as number }));
	}

	const top = $derived(
		[...(stats?.channels ?? [])]
			.sort((a, b) => b[by] - a[by])
			.filter(c => c[by] > 0)
			.slice(0, 10)
	);
	const top_max = $derived(Math.max(1, ...top.map(c => c[by])));
</script>

<svelte:head><title>Statistics · {g.guild.name}</title></svelte:head>

<div class="page-head">
	<h1>Statistics</h1>
	<p>View server activity statistics.</p>
</div>

<div class="row head">
	<h2>Server Activity Statistics</h2>
	<span class="spacer"></span>
	<div style="width: 280px">
		<Segmented bind:value={range} size="sm" options={[{ value: "day", label: "Today" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }, { value: "year", label: "Year" }]} />
	</div>
</div>

{#if error}
	<div class="warn-box">{error}</div>
{:else if !stats}
	<div class="faint">Loading…</div>
{:else}
	<div class="tiles">
		<div class="tile">
			<House size={18} />
			<strong>{stats.member_change > 0 ? "+" : ""}{fmt(stats.member_change)}</strong>
			<span>Member Changes · {fmt(stats.member_count)} now</span>
			<span class="sub">+{fmt(stats.joins)} joined · −{fmt(stats.leaves)} left</span>
		</div>
		<div class="tile"><MessageSquare size={18} /><strong>{fmt(stats.messages)}</strong><span>Messages</span></div>
		<div class="tile"><Mic size={18} /><strong>{fmt(stats.voice_hours)}h</strong><span>Voice</span></div>
		<div class="tile"><Star size={18} /><strong>{fmt(stats.xp)}</strong><span>XP Generated</span></div>
		<div class="tile"><Users size={18} /><strong>{fmt(stats.avg_active_users)}</strong><span>{range === "day" ? "Active Users today" : "Avg. Active Users"}</span></div>
	</div>

	<div class="stack" style="margin-top: 14px">
		{#each charts as c (c.key)}
			{@const data = series(c.key)}
			<section class="card plain">
				<div class="card-title"><c.icon size={14} /> {c.title}</div>
				{#if data.length >= 2}
					<div style="margin-top: 12px">
						<AreaChart points={data} color={c.color} format={c.fmt} {xlabel} />
					</div>
					<details>
						<summary>View as table</summary>
						<table class="table">
							<thead><tr><th>{range === "day" ? "Hour" : range === "year" ? "Month" : "Day"}</th><th>{c.title.replace(/^(Hourly|Daily|Monthly) /, "")}</th></tr></thead>
							<tbody>
								{#each data as p (p.label)}
									<tr><td>{full(p.label)}</td><td>{c.fmt(p.value)}</td></tr>
								{/each}
							</tbody>
						</table>
					</details>
				{:else}
					<div class="empty">Not enough data yet — this fills in as the bot keeps running.</div>
				{/if}
			</section>
		{/each}

		<section class="card plain">
			<div class="row">
				<div class="card-title"><Hash size={14} /> Activity by Channel</div>
				<span class="spacer"></span>
				<div style="width: 190px">
					<Segmented bind:value={by} size="sm" options={[{ value: "messages", label: "Messages" }, { value: "xp", label: "XP" }]} />
				</div>
			</div>
			{#if top.length}
				<div class="bars">
					{#each top as ch (ch.channel_id)}
						<div class="bar-row" title="{g.channel(ch.channel_id)?.name ?? 'deleted channel'}: {fmt(ch[by])} {by === 'xp' ? 'XP' : 'messages'}">
							<span class="bar-name"># {g.channel(ch.channel_id)?.name ?? "deleted channel"}</span>
							<div class="bar-track">
								<div class="bar" style:width="{(ch[by] / top_max) * 100}%"></div>
							</div>
							<span class="bar-val">{fmt(ch[by])}</span>
						</div>
					{/each}
				</div>
			{:else}
				<div class="empty">No channel activity in this period yet.</div>
			{/if}
		</section>
	</div>
	<div class="hint">Counts are saved once a minute. Active users = members who chatted or sat in voice that day. Days follow the server timezone ({g.settings.server.timezone}).</div>
{/if}

<style>
	.head {
		margin-bottom: 12px;
	}
	.head h2 {
		font-size: 15px;
		color: var(--muted);
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 12px;
	}
	.tile {
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 2px;
		color: var(--muted);
		min-width: 0;
	}
	.tile strong {
		color: var(--text);
		font-size: 22px;
		margin-top: 8px;
	}
	.tile span {
		font-size: 12px;
	}
	.tile .sub {
		font-size: 11px;
		color: var(--faint);
	}
	details {
		margin-top: 8px;
		font-size: 12px;
		color: var(--muted);
	}
	summary {
		cursor: pointer;
		width: fit-content;
	}
	details .table {
		margin-top: 8px;
		max-width: 420px;
	}
	.bars {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-top: 14px;
	}
	.bar-row {
		display: grid;
		grid-template-columns: minmax(90px, 200px) 1fr 70px;
		gap: 12px;
		align-items: center;
		font-size: 12.5px;
	}
	.bar-name {
		color: var(--muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.bar-track {
		height: 14px;
	}
	.bar {
		height: 100%;
		min-width: 3px;
		background: #3987e5;
		border-radius: 0 4px 4px 0;
	}
	.bar-val {
		color: var(--text);
		text-align: right;
	}
	@media (max-width: 1100px) {
		.tiles {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	@media (max-width: 760px) {
		.tiles {
			grid-template-columns: 1fr 1fr;
		}
	}
</style>
