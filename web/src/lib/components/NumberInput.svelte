<script lang="ts">
	// Keeps its own text so a half-typed or empty field never reaches the
	// setting; the bound number only changes when the text is a valid number.
	let {
		value = $bindable(0),
		min = -Infinity,
		max = Infinity,
		step = 1,
		disabled = false,
		placeholder = "",
		id = undefined
	}: { value?: number; min?: number; max?: number; step?: number; disabled?: boolean; placeholder?: string; id?: string } = $props();

	let text = $state(String(value ?? ""));
	let focused = $state(false);

	$effect(() => {
		const v = value;
		if (!focused) text = String(v ?? "");
	});

	function oninput(e: Event) {
		text = (e.target as HTMLInputElement).value;
		const n = Number(text);
		if (text.trim() !== "" && Number.isFinite(n) && n >= min && n <= max) {
			value = step >= 1 ? Math.trunc(n) : n;
		}
	}
</script>

<input
	{id}
	class="input"
	type="text"
	inputmode={step >= 1 ? "numeric" : "decimal"}
	{disabled}
	{placeholder}
	value={text}
	{oninput}
	onfocus={() => (focused = true)}
	onblur={() => {
		focused = false;
		text = String(value ?? "");
	}}
/>
