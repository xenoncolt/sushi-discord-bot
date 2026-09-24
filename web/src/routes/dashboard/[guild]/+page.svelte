<script lang="ts">
	import { goto } from "$app/navigation";
	import { page } from "$app/state";

	goto(`/dashboard/${page.params.guild}/server`, { replaceState: true });
</script>
