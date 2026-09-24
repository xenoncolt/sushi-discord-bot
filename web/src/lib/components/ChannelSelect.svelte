<script lang="ts">
	import type { Channel } from "$lib/api";
	import { useGuild } from "$lib/guild.svelte";
	import Select, { type Option } from "./Select.svelte";

	type Kind = Channel["type"];

	let {
		value = $bindable(null),
		types = ["text", "announcement"],
		placeholder = "None",
		noneLabel = "None",
		allowNone = true,
		compact = false,
		exclude = [],
		onpick
	}: {
		value?: string | null;
		types?: Kind[];
		placeholder?: string;
		noneLabel?: string;
		allowNone?: boolean;
		compact?: boolean;
		exclude?: string[];
		onpick?: (value: string | null) => void;
	} = $props();

	const g = useGuild();

	// Discord's own order: uncategorised channels first, then each category
	// with its channels underneath.
	const options = $derived.by((): Option[] => {
		const cats = g.channels.filter(c => c.type === "category");
		const catName = new Map(cats.map(c => [c.id, c.name]));
		const pickable = g.channels.filter(c => types.includes(c.type) && !exclude.includes(c.id));
		const orderOf = (c: Channel) => {
			const cat = c.type === "category" ? c : cats.find(x => x.id === c.parent_id);
			return [cat ? cat.position + 1 : 0, c.type === "category" ? -1 : c.position];
		};
		return pickable
			.sort((a, b) => {
				const [a1, a2] = orderOf(a);
				const [b1, b2] = orderOf(b);
				return a1 - b1 || a2 - b2;
			})
			.map(c => ({
				value: c.id,
				label: c.name,
				kind: c.type,
				group: types.includes("category") ? undefined : c.parent_id ? catName.get(c.parent_id) : undefined
			}));
	});
</script>

<Select bind:value {options} {placeholder} {noneLabel} {allowNone} {compact} {onpick} />
