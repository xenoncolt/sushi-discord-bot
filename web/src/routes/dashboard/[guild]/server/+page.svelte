<script lang="ts">
	import Card from "$lib/components/Card.svelte";
	import Modal from "$lib/components/Modal.svelte";
	import NumberInput from "$lib/components/NumberInput.svelte";
	import Segmented from "$lib/components/Segmented.svelte";
	import Select from "$lib/components/Select.svelte";
	import Toggle from "$lib/components/Toggle.svelte";
	import { fmt, xpForLevel } from "$lib/formula";
	import { Autosave, useGuild } from "$lib/guild.svelte";

	const g = useGuild();
	const s = new Autosave(g, "server");
	const v = $derived(s.value);

	let details = $state(false);

	const DEFAULT_FORMULA = { multiplier: 2, offset: 5, divider: 10 };

	const zones = (() => {
		try {
			return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
		} catch {
			return ["UTC"];
		}
	})();
	const zoneOptions = ["UTC", ...zones.filter(z => z !== "UTC")].map(z => ({ value: z, label: z.replace(/_/g, " ") }));

	const table = $derived(
		Array.from({ length: 60 }, (_, i) => {
			const level = i + 1;
			const at = xpForLevel(level, v.formula);
			return { level, at, step: at - xpForLevel(level - 1, v.formula) };
		})
	);
</script>

<svelte:head><title>Server · {g.guild.name}</title></svelte:head>

<div class="page-head">
	<h1>Server</h1>
	<p>Manage core server settings like XP rates, cooldowns, and level formulas.</p>
</div>

<div class="stack">
	<div class="grid grid-3">
		<Card title="XP Name" desc="Name representing the user's XP">
			<input class="input" maxlength="20" bind:value={s.value.xp_name} />
		</Card>
		<Card title="Chat XP" desc="XP amount given every time a user chats">
			<NumberInput bind:value={s.value.chat_xp} min={0} max={100000} />
		</Card>
		<Card title="Voice XP" desc="XP amount given every 5 minutes a user is in a voice channel">
			<NumberInput bind:value={s.value.voice_xp} min={0} max={100000} />
		</Card>
	</div>

	<div class="grid grid-2">
		<Card title="Daily XP" desc="XP amount given every time a user uses the daily command">
			<NumberInput bind:value={s.value.daily_xp} min={0} max={1000000} />
		</Card>
		<Card title="Chat cooldown" desc="Chat XP cooldown (seconds)">
			<NumberInput bind:value={s.value.chat_cooldown} min={0} max={3600} />
		</Card>
	</div>

	<Card title="Level-up Experience Formula">
		<div class="row">
			<button class="btn ghost-accent sm" onclick={() => (details = true)}>View Details</button>
			<button class="btn danger sm" onclick={() => (s.value.formula = { ...DEFAULT_FORMULA })}>Reset</button>
		</div>
		<div class="formula">
			Cumulative XP = (({v.formula.divider} × current level)² − {v.formula.offset}) ÷ {v.formula.multiplier} + 1
		</div>
		<div class="grid grid-3">
			<div>
				<label class="label" for="f-mul">Multiplier</label>
				<NumberInput id="f-mul" bind:value={s.value.formula.multiplier} min={0.01} max={1000} step={0.01} />
			</div>
			<div>
				<label class="label" for="f-off">Offset</label>
				<NumberInput id="f-off" bind:value={s.value.formula.offset} min={-1000000} max={1000000} step={0.01} />
			</div>
			<div>
				<label class="label" for="f-div">Divider</label>
				<NumberInput id="f-div" bind:value={s.value.formula.divider} min={0.01} max={1000} step={0.01} />
			</div>
		</div>
		<div class="hint">
			Level 1 at {fmt(xpForLevel(1, v.formula))} · Level 10 at {fmt(xpForLevel(10, v.formula))} · Level 50 at {fmt(xpForLevel(50, v.formula))} XP.
			Changing the formula recalculates everyone's level right away.
		</div>
	</Card>

	<Card title="Voice Mute/Deafen XP Restriction" desc="Restrict XP gain for users who self-mute/deafen in voice channels. (Server mute is not affected)">
		<div class="mute">
			<div>
				<span class="label">Mode</span>
				<Segmented
					bind:value={s.value.voice_mute_mode}
					options={[
						{ value: "disabled", label: "Disabled" },
						{ value: "block", label: "Block XP" },
						{ value: "reduce", label: "Reduce XP" }
					]}
				/>
			</div>
			<div>
				<label class="label" for="reduce">Reduction Rate (%)</label>
				<NumberInput id="reduce" bind:value={s.value.voice_mute_reduction} min={0} max={100} disabled={v.voice_mute_mode !== "reduce"} />
				<div class="hint">XP is reduced by this percentage when muted. (e.g., 50% → half XP) Decimals are truncated.</div>
			</div>
		</div>
	</Card>

	<div class="grid grid-2">
		<Card title="Gift Command" desc="Whether to allow users to gift XP to each other">
			{#snippet aside()}<Toggle bind:checked={s.value.gift_enabled} label="Gift command" />{/snippet}
		</Card>
		<Card title="Loan Command" desc="Whether users can lend XP to each other with interest (/loan). Loans already running are still collected when turned off">
			{#snippet aside()}<Toggle bind:checked={s.value.loan_enabled} label="Loan command" />{/snippet}
		</Card>
		<Card title="Reset XP of left users" desc="Whether to reset the XP of left users">
			{#snippet aside()}<Toggle bind:checked={s.value.reset_left_users} label="Reset XP of left users" />{/snippet}
		</Card>
		<Card title="Daily/bonus command private response" desc="Whether to respond privately when using the daily/bonus command">
			{#snippet aside()}<Toggle bind:checked={s.value.private_daily} label="Private daily response" />{/snippet}
		</Card>
		<Card title="Voice XP needs company" desc="Only give voice XP when at least 2 people are in the channel (stops solo AFK farming)">
			{#snippet aside()}<Toggle bind:checked={s.value.voice_require_company} label="Voice XP needs company" />{/snippet}
		</Card>
	</div>

	<div class="grid grid-2">
		<Card title="Bonus" desc="Extra XP members collect once a day with /bonus">
			{#snippet aside()}<Toggle bind:checked={s.value.bonus_enabled} label="Bonus" />{/snippet}
			<label class="label" for="bonus-xp">Bonus XP</label>
			<NumberInput id="bonus-xp" bind:value={s.value.bonus_xp} min={0} max={1000000} disabled={!v.bonus_enabled} />
			<div class="hint">If a bot-list token (<span class="mono">TOPGG_TOKEN</span> or <span class="mono">KOREANBOTS_TOKEN</span>) is set in the bot's .env, members have to vote for the bot before claiming.</div>
		</Card>
		<Card title="Timezone" desc="When a new day starts for /daily, /bonus, streaks, monthly XP, statistics and seasons">
			<Select bind:value={s.value.timezone} options={zoneOptions} allowNone={false} placeholder="UTC" />
		</Card>
	</div>
</div>

{#if details}
	<Modal title="Level requirements" onclose={() => (details = false)} width={520}>
		<div class="faint" style="margin-bottom: 10px">
			(({v.formula.divider} × level)² − {v.formula.offset}) ÷ {v.formula.multiplier} + 1
		</div>
		<div class="table-wrap">
			<table class="table">
				<thead><tr><th>Level</th><th>Total {v.xp_name}</th><th>From previous level</th></tr></thead>
				<tbody>
					{#each table as r (r.level)}
						<tr><td>{r.level}</td><td>{fmt(r.at)}</td><td class="muted">+{fmt(r.step)}</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	</Modal>
{/if}

<style>
	.formula {
		font-weight: 600;
		margin: 12px 0 14px;
	}
	.mute {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 14px;
	}
	.table-wrap {
		max-height: 60vh;
		overflow: auto;
	}
	@media (max-width: 760px) {
		.mute {
			grid-template-columns: 1fr;
		}
	}
</style>
