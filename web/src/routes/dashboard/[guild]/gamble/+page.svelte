<script lang="ts">
	import { ChartBar, Gem, Lightbulb, Plus, Trash2 } from "@lucide/svelte";
	import type { WheelSegment } from "$lib/api";
	import ChannelSelect from "$lib/components/ChannelSelect.svelte";
	import Modal from "$lib/components/Modal.svelte";
	import NumberInput from "$lib/components/NumberInput.svelte";
	import Toggle from "$lib/components/Toggle.svelte";
	import { fmt } from "$lib/formula";
	import { Autosave, useGuild } from "$lib/guild.svelte";

	const g = useGuild();
	const s = new Autosave(g, "gamble");
	const games = $derived(s.value.games);
	const tower_safe = $derived((3 - games.tower.traps) / 3);

	// Fixed win chance of the two "match three" games (see commands/slot.ts).
	const MATCH_WIN = 0.47;

	const DEFAULT_WHEEL: WheelSegment[] = [
		{ emoji: "💀", multiplier: 0, weight: 35 },
		{ emoji: "🔸", multiplier: 0.5, weight: 25 },
		{ emoji: "⚡", multiplier: 1, weight: 18 },
		{ emoji: "⭐", multiplier: 2, weight: 12 },
		{ emoji: "💎", multiplier: 3, weight: 6 },
		{ emoji: "🔥", multiplier: 5, weight: 4 }
	];

	function wheelReturn(segments: WheelSegment[]): number {
		const total = segments.reduce((a, x) => a + (Number(x.weight) || 0), 0);
		return total > 0 ? segments.reduce((a, x) => a + (Number(x.weight) || 0) * (Number(x.multiplier) || 0), 0) / total : 0;
	}

	function pct(x: number): string {
		return `${Math.round(x * 1000) / 10}%`;
	}

	// High-Low pays fair odds minus the house edge, so a guess with `outs` of the
	// 13 ranks on its side is worth (1 - edge) / (outs / 13). See commands/highlow.ts.
	function hl_pay(outs: number): string {
		return outs <= 0 ? "—" : ((1 - games.highlow.house_edge / 100) / (outs / 13)).toFixed(2);
	}

	// Ranks pair up around the 7: an A and a K are the same bet from either end.
	const HL_CARDS = [
		{ v: 1, label: "A / K" },
		{ v: 3, label: "3 / J" },
		{ v: 5, label: "5 / 9" },
		{ v: 7, label: "7" }
	];

	function mineSurvival(mines: number, reveals: number): number {
		let p = 1;
		for (let i = 0; i < reveals; i++) p *= Math.max(0, 20 - mines - i) / (20 - i);
		return p;
	}

	// Chance to crack the bomb code on exactly the 1st, 2nd, ... guess, simulated
	// over all 648 codes. "Careful" always guesses a code that fits every clue
	// so far; "solver" picks the most informative guess every time.
	const BOMB_CAREFUL = [0.0014, 0.0121, 0.0614, 0.1937, 0.3475, 0.2712, 0.0858, 0.026, 0.0011];
	const BOMB_SOLVER = [0.0015, 0.0108, 0.0478, 0.162, 0.5679, 0.2083, 0.0015];

	// Same formula as payoutFor in commands/bomb.ts.
	function bombMult(tries: number): number {
		return Math.max(0, Math.round((games.bomb.first_try - games.bomb.try_drop * (tries - 1)) * 1000) / 1000);
	}

	function bombReturn(dist: number[]): number {
		return dist.reduce((a, p, i) => (i < games.bomb.attempts ? a + p * bombMult(i + 1) : a), 0);
	}

	function tone(p: number): string {
		return p >= 0.6 ? "#69db7c" : p >= 0.4 ? "#ffd43b" : p >= 0.2 ? "#ffa94d" : "#ff6b6b";
	}

	// ---- wheel editor
	let wheel_open = $state(false);
	let draft = $state<WheelSegment[]>([]);
	function openWheel() {
		draft = structuredClone($state.snapshot(games.wheel.segments));
		wheel_open = true;
	}
	function applyWheel() {
		s.value.games.wheel.segments = draft.map(d => ({ emoji: d.emoji || "❔", multiplier: Number(d.multiplier) || 0, weight: Math.max(0, Math.trunc(Number(d.weight) || 0)) }));
		wheel_open = false;
	}

	// ---- allowed channels
	let adding_channel = $state<string | null>(null);
</script>

<svelte:head><title>Gamble · {g.guild.name}</title></svelte:head>

{#snippet head(key: string, title: string, badge: "PVP" | "PVBOT", stat: string)}
	<div class="ghead">
		<h3>{title}</h3>
		<span class="badge" class:pvp={badge === "PVP"}>{badge}</span>
		<span class="spacer"></span>
		{#if stat}<span class="stat">{stat}</span>{/if}
		<Toggle bind:checked={s.value.games[key].enabled} label="{title} enabled" />
	</div>
{/snippet}

{#snippet limits(key: string, cooldown = true)}
	<div class="grid" style:grid-template-columns={cooldown ? "repeat(3, minmax(0, 1fr))" : "repeat(2, minmax(0, 1fr))"}>
		{#if cooldown}
			<div><span class="label">Cooldown (s)</span><NumberInput bind:value={s.value.games[key].cooldown} min={0} max={86400} /></div>
		{/if}
		<div><span class="label">Min Bet</span><NumberInput bind:value={s.value.games[key].min_bet} min={0} max={1000000000} /></div>
		<div><span class="label">Max Bet</span><NumberInput bind:value={s.value.games[key].max_bet} min={0} max={1000000000} /></div>
	</div>
	<div class="hint">Set to 0 to disable the limit.</div>
{/snippet}

{#snippet pvp(key: string, title: string, stat: string, rules: string[])}
	<section class="card game" class:off={!games[key].enabled}>
		{@render head(key, title, "PVP", stat)}
		<div class="grid grid-2">
			<div><span class="label" title="Taken from the winnings (the loser's bet)">Fee (%)</span><NumberInput bind:value={s.value.games[key].fee} min={0} max={50} step={0.1} /></div>
			<div><span class="label">Cooldown (s)</span><NumberInput bind:value={s.value.games[key].cooldown} min={0} max={86400} /></div>
		</div>
		<div style="margin-top: 12px">{@render limits(key, false)}</div>
		{#if rules.length}
			<div class="how">
				<div class="how-title"><ChartBar size={13} /> How it works</div>
				{#each rules as r}<div>{r}</div>{/each}
			</div>
		{/if}
	</section>
{/snippet}

<div class="page-head">
	<h1>Gamble</h1>
	<p>Configure gamble settings like fees, cooldowns, and bet limits per game.</p>
</div>

<div class="stack">
	<div class="warn-box row"><Lightbulb size={16} color="#ffd43b" /> We recommend keeping the default gambling settings.</div>

	<div class="grid grid-2">
		<section class="card">
			<div class="ghead">
				<h3>Gambling</h3>
				<span class="spacer"></span>
				<Toggle bind:checked={s.value.enabled} label="Gambling enabled" />
			</div>
			<div class="card-desc">Master switch for every game. Turn single games off with their own switch.</div>
		</section>
		<section class="card">
			<h3 class="title-sm">Game channels</h3>
			<div class="card-desc">Only allow games in these channels. Leave empty to allow them everywhere.</div>
			<div class="row wrap" style="margin-top: 10px">
				{#each s.value.channels as id, i (id)}
					<span class="chip"># {g.channel(id)?.name ?? "deleted"} <button class="btn icon" style="padding: 0" onclick={() => s.value.channels.splice(i, 1)} aria-label="Remove"><Trash2 size={13} /></button></span>
				{/each}
				<div style="width: 200px">
					<ChannelSelect
						bind:value={adding_channel}
						placeholder="+ Add channel"
						compact
						allowNone={false}
						exclude={s.value.channels}
						onpick={v => {
							if (v) s.value.channels.push(v);
							adding_channel = null;
						}}
					/>
				</div>
			</div>
		</section>
	</div>

	<div class="grid grid-3">
		{@render pvp("oddeven", "Odd-Even", "🎲 1v1", ["🎲 Both players pick Odd or Even", "🔢 A random number decides — matching side wins", "🤝 Same pick = bets returned"])}
		{@render pvp("dice", "Dice", "🎲 1v1", ["🎲 Both roll one die (1-6) — higher wins", "🔁 Ties are re-rolled automatically (no draws)"])}
		{@render pvp("baskin", "Baskin Robbins 31", "🍦 1v1", ["🍦 Take turns saying 1-3 numbers", "💀 Whoever is forced to say 31 loses"])}

		<section class="card game" class:off={!games.scratch.enabled}>
			{@render head("scratch", "Scratch Lottery", "PVBOT", `Return ${pct(MATCH_WIN * games.scratch.multiplier)}`)}
			<div class="grid grid-2">
				<div><span class="label">Win Multiplier</span><NumberInput bind:value={s.value.games.scratch.multiplier} min={1} max={100} step={0.01} /></div>
				<div><span class="label">Cooldown (s)</span><NumberInput bind:value={s.value.games.scratch.cooldown} min={0} max={86400} /></div>
			</div>
			<div style="margin-top: 12px">{@render limits("scratch", false)}</div>
			<div class="how">
				<div class="how-title"><ChartBar size={13} /> How it works</div>
				<div>🎫 3 buttons — scratch them one at a time</div>
				<div>🎯 All 3 symbols match = win ×{games.scratch.multiplier} (47% win rate)</div>
				<div>⌛ Not scratched within 5 minutes = bet lost</div>
			</div>
		</section>

		<section class="card game" class:off={!games.slot.enabled}>
			{@render head("slot", "Slot Machine", "PVBOT", `Return ${pct(MATCH_WIN * games.slot.multiplier)}`)}
			<div class="grid grid-2">
				<div><span class="label">Win Multiplier</span><NumberInput bind:value={s.value.games.slot.multiplier} min={1} max={100} step={0.01} /></div>
				<div><span class="label">Cooldown (s)</span><NumberInput bind:value={s.value.games.slot.cooldown} min={0} max={86400} /></div>
			</div>
			<div style="margin-top: 12px">{@render limits("slot", false)}</div>
		</section>

		<section class="card game" class:off={!games.wheel.enabled}>
			{@render head("wheel", "Spin Wheel", "PVBOT", `Return ${pct(wheelReturn(games.wheel.segments))}`)}
			<div class="grid grid-2">
				<div><span class="label">Wheel Config</span><button class="btn segs" onclick={openWheel}>{games.wheel.segments.length} Segments</button></div>
				<div><span class="label">Cooldown (s)</span><NumberInput bind:value={s.value.games.wheel.cooldown} min={0} max={86400} /></div>
			</div>
			<div style="margin-top: 12px">{@render limits("wheel", false)}</div>
		</section>
	</div>

	<h2 class="divider"><Gem size={16} /> More Games</h2>

	<div class="grid grid-3">
		<section class="card game premium" class:off={!games.minesweeper.enabled}>
			{@render head("minesweeper", "Minesweeper", "PVBOT", `💣 ${games.minesweeper.mines} / 20`)}
			<div class="grid grid-2">
				<div><span class="label">Mine Count</span><NumberInput bind:value={s.value.games.minesweeper.mines} min={1} max={19} /></div>
				<div><span class="label">Per Reveal ×</span><NumberInput bind:value={s.value.games.minesweeper.per_step} min={0.01} max={10} step={0.01} /></div>
			</div>
			<div style="margin-top: 12px">{@render limits("minesweeper")}</div>
			<div class="how">
				<div class="how-title"><ChartBar size={13} /> How it works</div>
				<div>💣 {games.minesweeper.mines} mines hidden in 20 cells, {20 - games.minesweeper.mines} are safe</div>
				<div>💎 +×{games.minesweeper.per_step} per safe reveal — cash out anytime</div>
				<div>💥 Step on a mine = lose entire bet</div>
				<table>
					<thead><tr><th>Reveals</th><th>Survival → Payout</th></tr></thead>
					<tbody>
						{#each [1, 2, 3, 5, 10].filter(n => n <= 20 - games.minesweeper.mines) as n}
							{@const p = mineSurvival(games.minesweeper.mines, n)}
							<tr><td>{n}</td><td><span style:color={tone(p)}>{pct(p)}</span> → ×{(1 + games.minesweeper.per_step * n).toFixed(1)}</td></tr>
						{/each}
					</tbody>
				</table>
				<div class="eg">e.g. Bet 1,000 → 3 reveals = {fmt(1000 * (1 + games.minesweeper.per_step * 3))} cashout</div>
			</div>
		</section>

		<section class="card game premium" class:off={!games.highlow.enabled}>
			{@render head("highlow", "High-Low", "PVBOT", `${games.highlow.house_edge}% edge`)}
			<div class="grid grid-2">
				<div><span class="label">House Edge (%)</span><NumberInput bind:value={s.value.games.highlow.house_edge} min={0} max={30} step={0.5} /></div>
				<div><span class="label">Max Rounds</span><NumberInput bind:value={s.value.games.highlow.max_rounds} min={1} max={50} /></div>
			</div>
			<div style="margin-top: 12px">{@render limits("highlow")}</div>
			<div class="how">
				<div class="how-title"><ChartBar size={13} /> How it works</div>
				<div>🃏 A card is shown. Guess if the next will be higher or lower</div>
				<div>🎯 Every guess pays fair odds minus the house edge — the harder the call, the bigger the multiplier</div>
				<div>✅ Multipliers stack each win — cash out anytime</div>
				<div>❌ Wrong or same number = lose entire bet</div>
				<table>
					<thead><tr><th>Card shown</th><th>Safe side</th><th>Risky side</th></tr></thead>
					<tbody>
						{#each HL_CARDS as c}
							<tr>
								<td>{c.label}</td>
								<td>×{hl_pay(13 - c.v)} <small>{pct((13 - c.v) / 13)}</small></td>
								<td>{c.v <= 1 ? "—" : `×${hl_pay(c.v - 1)}`} <small>{c.v <= 1 ? "" : pct((c.v - 1) / 13)}</small></td>
							</tr>
						{/each}
					</tbody>
				</table>
				<div class="eg">Players keep ~{(100 - games.highlow.house_edge).toFixed(0)}% of every guess however they play — no card is worth skipping, no strategy beats the house.</div>
			</div>
		</section>

		<section class="card game premium" class:off={!games.blackjack.enabled}>
			{@render head("blackjack", "Blackjack", "PVBOT", "🃏 21")}
			<div class="grid grid-2">
				<div><span class="label">Win Multiplier</span><NumberInput bind:value={s.value.games.blackjack.multiplier} min={1} max={100} step={0.01} /></div>
				<div><span class="label">Cooldown (s)</span><NumberInput bind:value={s.value.games.blackjack.cooldown} min={0} max={86400} /></div>
			</div>
			<div style="margin-top: 12px">{@render limits("blackjack", false)}</div>
			<div class="how">
				<div class="how-title"><ChartBar size={13} /> How it works</div>
				<div>🃏 1v1 vs dealer — closest to 21 wins</div>
				<div>🎯 Hit, Stand, or Double Down (2× bet + 1 card)</div>
				<div>💥 Over 21 = bust, instant loss</div>
				<div>🎉 Natural 21 on first 2 cards = Blackjack — 1.5× bonus!</div>
				<table>
					<thead><tr><th>Result</th><th>Payout</th></tr></thead>
					<tbody>
						<tr><td>Blackjack (21)</td><td>×{(1 + (games.blackjack.multiplier - 1) * 1.5).toFixed(2)}</td></tr>
						<tr><td>Win</td><td>×{games.blackjack.multiplier}</td></tr>
						<tr><td>Push</td><td>Return</td></tr>
						<tr><td>Lose/Bust</td><td>×0</td></tr>
					</tbody>
				</table>
			</div>
		</section>

		<section class="card game premium" class:off={!games.tower.enabled}>
			{@render head("tower", "Tower", "PVBOT", `🗼 ${games.tower.floors}F`)}
			<div class="grid grid-3">
				<div><span class="label">Total Floors</span><NumberInput bind:value={s.value.games.tower.floors} min={1} max={12} /></div>
				<div><span class="label">Traps (/floor)</span><NumberInput bind:value={s.value.games.tower.traps} min={1} max={2} /></div>
				<div><span class="label">Per Floor ×</span><NumberInput bind:value={s.value.games.tower.per_step} min={0.01} max={10} step={0.01} /></div>
			</div>
			<div style="margin-top: 12px">{@render limits("tower")}</div>
			<div class="how">
				<div class="how-title"><ChartBar size={13} /> How it works</div>
				<div>🚪 {3 - games.tower.traps} of 3 doors are safe per floor ({pct(tower_safe)})</div>
				<div>💀 Open a trap = fall, lose entire bet</div>
				<div>💰 +×{games.tower.per_step} per safe door — cash out anytime</div>
				<table>
					<thead><tr><th>Floor</th><th>Survival → Payout</th></tr></thead>
					<tbody>
						{#each [...new Set([1, 2, 3, 4, games.tower.floors])].filter(f => f <= games.tower.floors) as f}
							{@const p = Math.pow(tower_safe, f)}
							<tr><td>{f}F</td><td><span style:color={tone(p)}>{pct(p)}</span> → ×{(1 + games.tower.per_step * f).toFixed(1)}</td></tr>
						{/each}
					</tbody>
				</table>
				<div class="eg">e.g. Bet 1,000 → {games.tower.floors}F summit = {fmt(1000 * (1 + games.tower.per_step * games.tower.floors))} cashout</div>
			</div>
		</section>

		<section class="card game premium" class:off={!games.horserace.enabled}>
			{@render head("horserace", "Horse Race", "PVBOT", `🏇 ${games.horserace.horses}H`)}
			<div class="grid grid-2">
				<div><span class="label">Horse Count</span><NumberInput bind:value={s.value.games.horserace.horses} min={2} max={8} /></div>
				<div><span class="label">Win Multiplier</span><NumberInput bind:value={s.value.games.horserace.multiplier} min={1} max={100} step={0.01} /></div>
			</div>
			<div style="margin-top: 12px">{@render limits("horserace")}</div>
			<div class="how">
				<div class="how-title"><ChartBar size={13} /> How it works</div>
				<div>🏇 Pick the winner from {games.horserace.horses} horses with the buttons</div>
				<div>🏁 Race runs automatically after your pick</div>
				<div>🎯 Win rate: {pct(1 / games.horserace.horses)} (1/{games.horserace.horses})</div>
				<div>💰 Win = ×{games.horserace.multiplier} payout</div>
				<div class="row eg"><span>Expected Return</span><span class="spacer"></span><strong>{pct(games.horserace.multiplier / games.horserace.horses)}</strong></div>
			</div>
		</section>

		<section class="card game premium" class:off={!games.bomb.enabled}>
			{@render head("bomb", "Bomb Defusal", "PVBOT", `Return ${pct(bombReturn(BOMB_CAREFUL))}`)}
			<div class="grid grid-3">
				<div><span class="label">Max Attempts</span><NumberInput bind:value={s.value.games.bomb.attempts} min={1} max={15} /></div>
				<div><span class="label" title="Payout when the code is cracked on the first guess">1st Try ×</span><NumberInput bind:value={s.value.games.bomb.first_try} min={0.01} max={100} step={0.01} /></div>
				<div><span class="label" title="The payout drops by this much with every extra guess">Drop per Try ×</span><NumberInput bind:value={s.value.games.bomb.try_drop} min={0} max={100} step={0.01} /></div>
			</div>
			<div style="margin-top: 12px">{@render limits("bomb")}</div>
			<div class="how">
				<div class="how-title"><ChartBar size={13} /> How it works</div>
				<div>🔢 Guess the 3-digit code (unique digits, never starting with 0)</div>
				<div>🎯 S = correct digit+position, B = correct digit only, O = not in code</div>
				<div>💰 Faster = bigger payout: ×{games.bomb.first_try} on the 1st try, −{games.bomb.try_drop} per extra try</div>
				<div>💥 Not cracked in {games.bomb.attempts} tries, gave up or idle 5 min = lose entire bet</div>
				<table>
					<thead><tr><th>Try</th><th>Careful player's chance → Payout</th></tr></thead>
					<tbody>
						{#each Array.from({ length: Math.min(games.bomb.attempts, BOMB_CAREFUL.length) }, (_, i) => i + 1) as n}
							<tr><td>{n}</td><td>{pct(BOMB_CAREFUL[n - 1])} → ×{Math.round(bombMult(n) * 100) / 100}</td></tr>
						{/each}
					</tbody>
				</table>
				<div class="eg">e.g. Bet 1,000 → defused on try 4 = {fmt(Math.floor(1000 * bombMult(4)))} payout</div>
				<div class="row eg"><span>Expected Return</span><span class="spacer"></span><strong>{pct(bombReturn(BOMB_CAREFUL))}</strong></div>
				<div class="eg">A player using a solver program gets about {pct(bombReturn(BOMB_SOLVER))}. Keep that near 100% so the game can't be farmed.</div>
			</div>
		</section>

		{@render pvp("roulette", "Russian Roulette", "🔫 2~6P", ["🔫 2-6 players take turns pulling the trigger", "💥 1 bullet in 6! Hit = eliminated, bet lost", "🔄 Re-spin and a new random turn order after each elimination", "🏆 Last one standing wins the entire pot"])}
		{@render pvp("indianpoker", "Indian Poker", "🃏 1v1", ["🃏 See opponent's card, guess yours!", "👀 'See Opponent' button shows their card (only you)", "⬆️ 1 raise each — max pot is 6× the bet", "🔁 Same number = cards are redrawn", "💰 Requirement: must hold 3× the bet amount"])}
		{@render pvp("tictactoe", "Tic-Tac-Toe", "⭕❌ 1v1", ["⭕❌ Take turns on 3×3 board — 3 in a row wins!", "🎲 First turn is randomly decided", "🤝 Full board = draw, bets returned"])}
	</div>
</div>

{#if wheel_open}
	<Modal title="Wheel Segments" onclose={() => (wheel_open = false)} width={480}>
		<div class="row ret">
			<span>Expected Return <span class="faint">(Average return rate for users)</span></span>
			<span class="spacer"></span>
			<strong>{pct(wheelReturn(draft))}</strong>
		</div>
		<div class="seg-head"><span>Emoji</span><span>Multiplier (×)</span><span>Weight</span><span></span></div>
		{#each draft as seg, i (i)}
			<div class="seg-row">
				<input class="input emoji" maxlength="8" bind:value={seg.emoji} />
				<NumberInput bind:value={seg.multiplier} min={0} max={100} step={0.01} />
				<NumberInput bind:value={seg.weight} min={0} max={10000} />
				<button class="btn icon" disabled={draft.length <= 2} onclick={() => draft.splice(i, 1)} aria-label="Delete segment"><Trash2 size={15} /></button>
			</div>
		{/each}
		{#if draft.length < 12}
			<button class="add-tile" style="margin-top: 8px; min-height: 40px" onclick={() => draft.push({ emoji: "🎁", multiplier: 1, weight: 5 })}><Plus size={14} /> Add Segment</button>
		{/if}
		<div class="row" style="justify-content: flex-end; margin-top: 16px">
			<button class="btn" onclick={() => (draft = structuredClone(DEFAULT_WHEEL))}>Reset to Defaults</button>
			<button class="btn primary" onclick={applyWheel}>Apply</button>
		</div>
	</Modal>
{/if}

<style>
	.game {
		display: flex;
		flex-direction: column;
		gap: 12px;
		transition: opacity 0.15s;
	}
	.game.off {
		opacity: 0.55;
	}
	.ghead {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.ghead h3,
	.title-sm {
		font-size: 16px;
	}
	.stat {
		font-size: 11px;
		color: var(--muted);
		background: rgba(0, 0, 0, 0.2);
		border-radius: 4px;
		padding: 2px 6px;
	}
	.segs {
		width: 100%;
		padding: 9px;
		color: var(--boost);
		background: rgba(151, 117, 250, 0.08);
		border-color: rgba(151, 117, 250, 0.3);
	}
	.divider {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		font-size: 16px;
		color: var(--boost);
		margin: 14px 0 0;
	}
	.how {
		background: rgba(0, 0, 0, 0.18);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 12px;
		font-size: 12px;
		color: var(--muted);
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.how-title {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--text);
		font-weight: 600;
		margin-bottom: 4px;
	}
	.how table {
		width: 100%;
		margin-top: 8px;
		border-collapse: collapse;
		font-size: 11.5px;
	}
	.how th {
		text-align: left;
		font-weight: 500;
		color: var(--faint);
		padding-bottom: 3px;
	}
	.how th:last-child,
	.how td:last-child {
		text-align: right;
	}
	.how td {
		padding: 1px 0;
	}
	.eg {
		font-size: 11px;
		color: var(--faint);
		margin-top: 6px;
	}
	.ret {
		border-bottom: 1px dashed var(--border);
		padding-bottom: 10px;
		margin-bottom: 12px;
	}
	.ret strong {
		background: rgba(0, 0, 0, 0.25);
		border-radius: 6px;
		padding: 3px 10px;
	}
	.seg-head,
	.seg-row {
		display: grid;
		grid-template-columns: 52px 1fr 1fr 34px;
		gap: 8px;
		align-items: center;
	}
	.seg-head {
		font-size: 12px;
		color: var(--muted);
		margin-bottom: 6px;
	}
	.seg-row {
		margin-bottom: 8px;
	}
	.emoji {
		text-align: center;
		padding: 8px 4px;
	}
</style>
