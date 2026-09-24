import { getContext, onDestroy, setContext } from "svelte";
import { api, type Channel, type GuildInfo, type Role, type Section, type Settings } from "./api";
import { toast } from "./toast.svelte";

// Everything the settings pages share: the server, its settings, and the
// channel / role lists for the pickers. Loaded once by the dashboard layout.
export class GuildContext {
	guild = $state() as GuildInfo;
	settings = $state() as Settings;
	channels = $state<Channel[]>([]);
	roles = $state<Role[]>([]);

	constructor(guild: GuildInfo, settings: Settings, channels: Channel[], roles: Role[]) {
		this.guild = guild;
		this.settings = settings;
		this.channels = channels;
		this.roles = roles;
	}

	get isAdmin(): boolean {
		return this.guild.access === "admin";
	}

	channel(id: string | null | undefined): Channel | undefined {
		return id ? this.channels.find(c => c.id === id) : undefined;
	}

	role(id: string | null | undefined): Role | undefined {
		return id ? this.roles.find(r => r.id === id) : undefined;
	}
}

const KEY = Symbol("guild");

export function provideGuild(ctx: GuildContext): void {
	setContext(KEY, ctx);
}

export function useGuild(): GuildContext {
	return getContext<GuildContext>(KEY);
}

// Autosave for one settings section. Edit `value` freely; changes are sent
// 600ms after the last keystroke. If the bot adjusts a value (clamping a
// number, say) and nothing was typed meanwhile, the adjusted value is shown.
export class Autosave<S extends Section> {
	value = $state() as Settings[S];
	saving = $state(false);
	private saved: string;
	private timer: ReturnType<typeof setTimeout> | null = null;

	constructor(private g: GuildContext, private section: S) {
		this.value = structuredClone($state.snapshot(g.settings[section])) as Settings[S];
		this.saved = JSON.stringify(this.value);

		$effect(() => {
			const now = JSON.stringify(this.value);
			if (now !== this.saved) this.schedule();
		});

		// Leaving the page mid-debounce still saves.
		onDestroy(() => {
			if (this.timer) this.flush();
		});
	}

	private schedule(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => this.flush(), 600);
	}

	async flush(): Promise<void> {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;

		const body = $state.snapshot(this.value);
		const sent = JSON.stringify(body);
		if (sent === this.saved) return;

		this.saving = true;
		try {
			const res = await api<Settings>(`/guilds/${this.g.guild.id}/settings/${this.section}`, { method: "PATCH", body });
			this.g.settings = res;
			const server = JSON.stringify(res[this.section]);
			this.saved = server;
			if (JSON.stringify($state.snapshot(this.value)) === sent && server !== sent) {
				this.value = structuredClone(res[this.section]) as Settings[S];
			}
			toast("Saved");
		} catch (err) {
			toast((err as Error).message, "error", 5000);
		} finally {
			this.saving = false;
		}
	}
}
