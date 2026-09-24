<script lang="ts">
	import "../app.css";
	import Toasts from "$lib/components/Toasts.svelte";
	import { loadMe } from "$lib/session.svelte";

	let { children } = $props();
	loadMe();
</script>

{@render children()}
<Toasts />
