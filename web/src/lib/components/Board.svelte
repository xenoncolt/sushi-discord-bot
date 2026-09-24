<script lang="ts">
	import { CalendarCheck, CalendarDays, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "@lucide/svelte";
	import type { BoardEntry } from "$lib/api";
	import { fmt } from "$lib/formula";

	type Kind = "xp" | "monthly" | "streak" | "total";

	let {
		entries,
		page,
		pages,
		kind,
		xp_name,
		onpage
	}: { entries: BoardEntry[]; page: number; pages: number; kind: Kind; xp_name: string; onpage: (p: number) => void } = $props();

	const podium = $derived(page === 1 ? entries.slice(0, 3) : []);
	const rest = $derived(page === 1 ? entries.slice(3) : entries);
	// Visual order: 2nd, 1st, 3rd.
	const podium_order = $derived([podium[1], podium[0], podium[2]].filter(Boolean));

	function fallback(e: BoardEntry): string {
		return `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(e.user_id) >> 22n) % 6}.png`;
	}
</script>

{#snippet value(e: BoardEntry, big: boolean)}
	{#if kind === "xp"}
		<div class="lvl" class:big>LEVEL {e.level}</div>
		<div class="sub">{fmt(e.value)} {xp_name}</div>
	{:else if kind === "monthly"}
		<div class="amount" class:big>{fmt(e.value)} <span>{xp_name}</span></div>
	{:else if kind === "streak"}
		<div class="amount" class:big><CalendarCheck size={big ? 15 : 14} /> {fmt(e.value)} <span>streak days</span></div>
	{:else}
		<div class="amount" class:big><CalendarDays size={big ? 15 : 14} /> {fmt(e.value)} <span>days</span></div>
	{/if}
{/snippet}

{#if !entries.length}
	<div class="empty-board">Nobody is on this board yet.</div>
{:else}
	{#if podium_order.length}
		<div class="podium">
			{#each podium_order as e (e.user_id)}
				<div class="place r{e.rank}">
					<div class="medal">{e.rank === 1 ? "🥇" : e.rank === 2 ? "🥈" : "🥉"}</div>
					<img class="pa" src={e.avatar ?? fallback(e)} alt="" onerror={ev => ((ev.currentTarget as HTMLImageElement).src = fallback(e))} />
					<div class="pname">{e.name}</div>
					{@render value(e, true)}
				</div>
			{/each}
		</div>
	{/if}

	<div class="rows">
		{#each rest as e (e.user_id)}
			<div class="entry">
				<span class="rank">{e.rank}</span>
				<img class="ra" src={e.avatar ?? fallback(e)} alt="" onerror={ev => ((ev.currentTarget as HTMLImageElement).src = fallback(e))} />
				<span class="rname">{e.name}</span>
				<div class="right">{@render value(e, false)}</div>
			</div>
		{/each}
	</div>

	{#if pages > 1}
		<div class="pager">
			<button disabled={page <= 1} onclick={() => onpage(1)} aria-label="First page"><ChevronsLeft size={16} /></button>
			<button disabled={page <= 1} onclick={() => onpage(page - 1)} aria-label="Previous page"><ChevronLeft size={16} /></button>
			<span>{page}/{pages}</span>
			<button disabled={page >= pages} onclick={() => onpage(page + 1)} aria-label="Next page"><ChevronRight size={16} /></button>
			<button disabled={page >= pages} onclick={() => onpage(pages)} aria-label="Last page"><ChevronsRight size={16} /></button>
		</div>
	{/if}
{/if}

<style>
	.podium {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 10px;
		align-items: end;
		margin-bottom: 12px;
	}
	.place {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		border-radius: 8px;
		padding: 14px 10px 16px;
		text-align: center;
		min-width: 0;
		color: #fff;
	}
	.r1 {
		background: linear-gradient(160deg, #c98a0c, #a86d05);
		padding-top: 20px;
		min-height: 190px;
	}
	.r2 {
		background: linear-gradient(160deg, #56606b, #414a54);
		min-height: 162px;
	}
	.r3 {
		background: linear-gradient(160deg, #a45f2e, #7e4520);
		min-height: 162px;
	}
	.medal {
		font-size: 18px;
		line-height: 1;
	}
	.pa {
		width: 54px;
		height: 54px;
		border-radius: 50%;
		object-fit: cover;
		background: rgba(0, 0, 0, 0.2);
	}
	.r1 .pa {
		width: 60px;
		height: 60px;
	}
	.pname {
		font-weight: 600;
		font-size: 13.5px;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.lvl {
		font-weight: 700;
		font-size: 14px;
	}
	.lvl.big {
		font-size: 17px;
	}
	.r1 .lvl.big {
		font-size: 19px;
	}
	.sub {
		font-size: 11px;
		font-weight: 600;
		opacity: 0.85;
	}
	.amount {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 5px;
		font-weight: 700;
	}
	.amount span {
		font-size: 11px;
		font-weight: 500;
		opacity: 0.8;
	}
	.amount.big {
		justify-content: center;
		font-size: 17px;
	}
	.rows {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.entry {
		display: flex;
		align-items: center;
		gap: 14px;
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 12px 16px;
	}
	.rank {
		width: 26px;
		text-align: center;
		font-weight: 700;
		font-size: 16px;
		color: var(--muted);
	}
	.ra {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		object-fit: cover;
		background: #3a3d42;
	}
	.rname {
		flex: 1;
		min-width: 0;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.right {
		text-align: right;
	}
	.right .sub {
		color: var(--muted);
		opacity: 1;
		font-weight: 500;
	}
	.pager {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		margin-top: 18px;
		color: var(--muted);
	}
	.pager button {
		border: 0;
		background: transparent;
		color: var(--muted);
		padding: 4px;
		border-radius: 4px;
	}
	.pager button:hover:not(:disabled) {
		color: var(--text);
		background: rgba(255, 255, 255, 0.05);
	}
	.pager span {
		min-width: 40px;
		text-align: center;
		font-size: 13px;
	}
	.empty-board {
		text-align: center;
		color: var(--faint);
		padding: 50px 0;
	}
	@media (max-width: 560px) {
		.podium {
			gap: 6px;
		}
		.place {
			padding: 12px 6px;
		}
		.pa {
			width: 42px;
			height: 42px;
		}
		.r1 .pa {
			width: 48px;
			height: 48px;
		}
		.entry {
			gap: 10px;
			padding: 10px 12px;
		}
	}
</style>
