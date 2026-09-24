<script lang="ts">
	import { Crown, Info, Megaphone, Plus, Trash2 } from "@lucide/svelte";
	import Card from "$lib/components/Card.svelte";
	import ChannelSelect from "$lib/components/ChannelSelect.svelte";
	import Modal from "$lib/components/Modal.svelte";
	import NumberInput from "$lib/components/NumberInput.svelte";
	import RoleSelect from "$lib/components/RoleSelect.svelte";
	import Segmented from "$lib/components/Segmented.svelte";
	import Toggle from "$lib/components/Toggle.svelte";
	import { Autosave, useGuild } from "$lib/guild.svelte";
	import { toast } from "$lib/toast.svelte";

	const g = useGuild();
	const s = new Autosave(g, "roles");

	let adding = $state<"admin" | "level" | "attendance" | null>(null);
	let pick_role = $state<string | null>(null);
	let pick_level = $state(5);
	let pick_type = $state<"total" | "streak">("total");
	let pick_threshold = $state(7);

	function open(kind: "admin" | "level" | "attendance") {
		pick_role = null;
		adding = kind;
	}

	function add() {
		if (!pick_role) return toast("Pick a role first.", "error");
		if (adding === "admin") {
			if (!s.value.admin_roles.includes(pick_role)) s.value.admin_roles.push(pick_role);
		} else if (adding === "level") {
			s.value.level_roles.push({ level: pick_level, role_id: pick_role });
			s.value.level_roles.sort((a, b) => a.level - b.level);
		} else if (adding === "attendance") {
			s.value.attendance_roles.push({ type: pick_type, threshold: pick_threshold, role_id: pick_role });
			s.value.attendance_roles.sort((a, b) => a.threshold - b.threshold);
		}
		adding = null;
	}

	function roleName(id: string) {
		return g.role(id)?.name ?? "deleted role";
	}
	function roleColor(id: string) {
		return g.role(id)?.color ?? "#7b7f86";
	}
	function warn(id: string) {
		const r = g.role(id);
		return r && !r.assignable ? "The bot's role is below this role, so it can't hand it out." : "";
	}
</script>

<svelte:head><title>Roles · {g.guild.name}</title></svelte:head>

<div class="page-head">
	<h1>Roles</h1>
	<p>Auto-assign roles at specific levels and configure admin roles.</p>
</div>

{#if !g.isAdmin}
	<div class="warn-box" style="margin-bottom: 14px">Role settings can only be changed by server admins (Manage Server). You can look but not edit.</div>
{/if}

<fieldset class="bare" disabled={!g.isAdmin}>
	<div class="stack">
		<Card title="Admin Roles" desc="Holders can access the dashboard and use XP management tools. Role settings, data reset, and shop management stay Administrator-only.">
			<div class="chips">
				{#each s.value.admin_roles as id, i (id)}
					<div class="chip">
						<Crown size={13} color="#f06595" />
						<span class="dot" style:background={roleColor(id)}></span>
						<span class="name">{roleName(id)}</span>
						<button class="btn icon" onclick={() => s.value.admin_roles.splice(i, 1)} aria-label="Remove"><Trash2 size={14} /></button>
					</div>
				{/each}
			</div>
			<button class="add-tile" onclick={() => open("admin")}><Plus size={16} /> Add</button>
		</Card>

		<Card title="Level Role Announcement Channel" desc="Channel that announces role assignment when a member levels up.">
			{#snippet aside()}<div class="aside-select"><ChannelSelect bind:value={s.value.role_channel} compact /></div>{/snippet}
		</Card>

		<Card title="Level Role" desc="Roles that are given to members every time they level up.">
			<div class="chips">
				{#each s.value.level_roles as r, i (i)}
					<div class="chip" title={warn(r.role_id)}>
						<span class="lvl">Lv {r.level}</span>
						<span class="dot" style:background={roleColor(r.role_id)}></span>
						<span class="name">{roleName(r.role_id)}</span>
						{#if warn(r.role_id)}<span class="warn">!</span>{/if}
						<button class="btn icon" onclick={() => s.value.level_roles.splice(i, 1)} aria-label="Remove"><Trash2 size={14} /></button>
					</div>
				{/each}
			</div>
			<button class="add-tile" onclick={() => open("level")}><Plus size={16} /> Add</button>
			<div class="row" style="margin-top: 12px">
				<Toggle bind:checked={s.value.level_highest_only} label="Highest only" />
				<span class="muted small">Highest only — lower roles are removed on level up.</span>
			</div>
			<div class="row note">
				<Megaphone size={14} color="#f06595" />
				<span>Customize level-up and role notifications in the Notifications tab.</span>
				<span class="spacer"></span>
				<a class="btn ghost-accent sm" href="/dashboard/{g.guild.id}/notifications">Notifications →</a>
			</div>
		</Card>

		<Card title="Attendance Roles" desc="Automatically assign roles when attendance count or streak reaches the threshold." premium>
			<div class="chips">
				{#each s.value.attendance_roles as r, i (i)}
					<div class="chip" title={warn(r.role_id)}>
						<span class="lvl">{r.type === "total" ? `${r.threshold} check-ins` : `${r.threshold}-day streak`}</span>
						<span class="dot" style:background={roleColor(r.role_id)}></span>
						<span class="name">{roleName(r.role_id)}</span>
						<button class="btn icon" onclick={() => s.value.attendance_roles.splice(i, 1)} aria-label="Remove"><Trash2 size={14} /></button>
					</div>
				{/each}
			</div>
			<button class="add-tile" onclick={() => open("attendance")}><Plus size={16} /> Add</button>
			<div class="row" style="margin-top: 12px">
				<Toggle bind:checked={s.value.attendance_highest_only} label="Highest only" />
				<span class="muted small">Highest only — lower roles per type are removed.</span>
			</div>
			<div class="row note">
				<Megaphone size={14} color="#f06595" />
				<span>Customize attendance role notification messages in the Notifications tab.</span>
				<span class="spacer"></span>
				<a class="btn ghost-accent sm" href="/dashboard/{g.guild.id}/notifications">Notifications →</a>
			</div>
			<div class="hint">Roles are automatically removed on the next check-in if below the threshold.</div>
		</Card>

		<div class="info-box">
			<div class="row" style="margin-bottom: 8px"><Info size={16} color="#4dabf7" /><strong>Information about level role assignment</strong></div>
			<ul>
				<li>Roles won't be assigned if the bot's role isn't higher than the level role to be assigned.</li>
				<li>Roles won't be assigned if the bot doesn't have role management permissions{g.guild.bot.can_manage_roles ? "" : " — and right now it doesn't!"}.</li>
				<li>After setting this up, roles aren't assigned to everyone immediately. Members get them as they chat or level up, or run <span class="mono">/levelsync</span> to update everyone now.</li>
			</ul>
		</div>
	</div>
</fieldset>

{#if adding}
	<Modal title={adding === "admin" ? "Add Admin Role" : adding === "level" ? "Add Level Role" : "Add Attendance Role"} onclose={() => (adding = null)}>
		<div class="stack">
			{#if adding === "level"}
				<div>
					<label class="label" for="lvl">Level</label>
					<NumberInput id="lvl" bind:value={pick_level} min={1} max={10000} />
				</div>
			{:else if adding === "attendance"}
				<div>
					<span class="label">Type</span>
					<Segmented bind:value={pick_type} options={[{ value: "total", label: "Total check-ins" }, { value: "streak", label: "Streak days" }]} />
				</div>
				<div>
					<label class="label" for="thr">{pick_type === "total" ? "Check-ins needed" : "Streak days needed"}</label>
					<NumberInput id="thr" bind:value={pick_threshold} min={1} max={100000} />
				</div>
			{/if}
			<div>
				<span class="label">Role</span>
				<RoleSelect bind:value={pick_role} placeholder="Pick a role" allowNone={false} assignableOnly={adding !== "admin"} exclude={adding === "admin" ? s.value.admin_roles : []} />
			</div>
			<div class="row" style="justify-content: flex-end">
				<button class="btn primary" onclick={add}>Add</button>
			</div>
		</div>
	</Modal>
{/if}

<style>
	.bare {
		border: 0;
		margin: 0;
		padding: 0;
		min-width: 0;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-bottom: 10px;
	}
	.chips:empty {
		display: none;
	}
	.chip .name {
		max-width: 200px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.chip .btn.icon {
		padding: 2px;
	}
	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex: none;
	}
	.lvl {
		font-size: 11.5px;
		font-weight: 600;
		color: #f06595;
		background: var(--accent-soft);
		border-radius: 4px;
		padding: 1px 6px;
	}
	.warn {
		color: var(--warning);
		font-weight: 700;
	}
	.aside-select {
		width: 220px;
	}
	.small {
		font-size: 12px;
	}
	.note {
		margin-top: 12px;
		font-size: 13px;
	}
	ul {
		margin: 0;
		padding-left: 20px;
		color: var(--muted);
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
</style>
