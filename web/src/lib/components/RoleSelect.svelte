<script lang="ts">
	import { useGuild } from "$lib/guild.svelte";
	import Select, { type Option } from "./Select.svelte";

	let {
		value = $bindable(null),
		placeholder = "None",
		noneLabel = "None",
		allowNone = true,
		assignableOnly = false,
		exclude = [],
		onpick
	}: {
		value?: string | null;
		placeholder?: string;
		noneLabel?: string;
		allowNone?: boolean;
		assignableOnly?: boolean;
		exclude?: string[];
		onpick?: (value: string | null) => void;
	} = $props();

	const g = useGuild();

	const options = $derived(
		g.roles
			.filter(r => !r.managed && !exclude.includes(r.id))
			.map(
				(r): Option => ({
					value: r.id,
					label: r.name,
					kind: "role",
					color: r.color,
					note: r.assignable ? undefined : "above bot",
					disabled: assignableOnly && !r.assignable
				})
			)
	);
</script>

<Select bind:value {options} {placeholder} {noneLabel} {allowNone} {onpick} />
