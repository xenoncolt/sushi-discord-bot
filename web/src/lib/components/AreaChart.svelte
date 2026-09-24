<script lang="ts">
	// Single-series area chart: 2px line over a soft fill, recessive grid, one
	// y-axis, and a crosshair + tooltip on hover. The title outside names the
	// series, so there is no legend.
	let {
		points,
		color,
		format = (n: number) => n.toLocaleString("en-US"),
		xlabel = (s: string) => s,
		height = 170
	}: {
		points: { label: string; value: number }[];
		color: string;
		format?: (n: number) => string;
		xlabel?: (s: string) => string;
		height?: number;
	} = $props();

	let width = $state(600);
	let hover = $state<number | null>(null);

	const pad = { top: 10, right: 12, bottom: 24, left: 40 };
	const uid = `g${Math.random().toString(36).slice(2, 8)}`;

	// Four equal steps of a round size, so every tick label is a round number.
	function niceStep(v: number): number {
		if (v <= 0) return 1;
		const raw = v / 4;
		const pow = Math.pow(10, Math.floor(Math.log10(raw)));
		for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * pow >= raw) return m * pow;
		return 10 * pow;
	}

	const step = $derived(niceStep(Math.max(...points.map(p => p.value), 0)));
	const max = $derived(step * 4);
	const ticks = $derived([0, 1, 2, 3, 4].map(i => i * step));
	const iw = $derived(Math.max(10, width - pad.left - pad.right));
	const ih = $derived(height - pad.top - pad.bottom);

	const xy = $derived(
		points.map((p, i) => ({
			x: pad.left + (points.length > 1 ? (i / (points.length - 1)) * iw : iw / 2),
			y: pad.top + ih - (p.value / max) * ih
		}))
	);

	// Monotone cubic (Fritsch–Carlson): smooth, but never dips below zero or
	// overshoots a peak the way a plain spline does.
	const line = $derived.by(() => {
		const n = xy.length;
		if (n === 0) return "";
		if (n === 1) return `M${xy[0].x},${xy[0].y}`;
		const dx = xy.slice(1).map((p, i) => p.x - xy[i].x);
		const s = xy.slice(1).map((p, i) => (p.y - xy[i].y) / dx[i]);
		const m = xy.map((_, i) => (i === 0 ? s[0] : i === n - 1 ? s[n - 2] : s[i - 1] * s[i] <= 0 ? 0 : (s[i - 1] + s[i]) / 2));
		for (let i = 0; i < n - 1; i++) {
			if (s[i] === 0) {
				m[i] = m[i + 1] = 0;
				continue;
			}
			const a = m[i] / s[i], b = m[i + 1] / s[i];
			const h = a * a + b * b;
			if (h > 9) {
				const t = 3 / Math.sqrt(h);
				m[i] = t * a * s[i];
				m[i + 1] = t * b * s[i];
			}
		}
		let d = `M${xy[0].x},${xy[0].y}`;
		for (let i = 0; i < n - 1; i++) {
			const h = dx[i] / 3;
			d += `C${xy[i].x + h},${xy[i].y + m[i] * h} ${xy[i + 1].x - h},${xy[i + 1].y - m[i + 1] * h} ${xy[i + 1].x},${xy[i + 1].y}`;
		}
		return d;
	});

	const area = $derived(xy.length ? `${line}L${xy[xy.length - 1].x},${pad.top + ih}L${xy[0].x},${pad.top + ih}Z` : "");

	// Label roughly every 70px so they never collide.
	const every = $derived(Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(iw / 70)))));

	function onmove(e: PointerEvent) {
		const svg = e.currentTarget as SVGSVGElement;
		const r = svg.getBoundingClientRect();
		const x = e.clientX - r.left - pad.left;
		const i = points.length > 1 ? Math.round((x / iw) * (points.length - 1)) : 0;
		hover = Math.min(points.length - 1, Math.max(0, i));
	}
</script>

<div class="chart" bind:clientWidth={width}>
	<svg {width} {height} role="img" aria-label="Chart" onpointermove={onmove} onpointerleave={() => (hover = null)}>
		<defs>
			<linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
				<stop offset="0" stop-color={color} stop-opacity="0.28" />
				<stop offset="1" stop-color={color} stop-opacity="0.03" />
			</linearGradient>
		</defs>

		{#each ticks as t}
			{@const y = pad.top + ih - (t / max) * ih}
			<line x1={pad.left} x2={pad.left + iw} y1={y} y2={y} class="grid" class:base={t === 0} />
			<text x={pad.left - 8} y={y + 3.5} class="ytick">{format(t)}</text>
		{/each}

		{#each points as p, i}
			{#if i % every === 0 || i === points.length - 1}
				<text x={xy[i].x} y={height - 6} class="xtick">{xlabel(p.label)}</text>
			{/if}
		{/each}

		<path d={area} fill="url(#{uid})" />
		<path d={line} fill="none" stroke={color} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />

		{#if hover !== null && xy[hover]}
			<line x1={xy[hover].x} x2={xy[hover].x} y1={pad.top} y2={pad.top + ih} class="cross" />
			<circle cx={xy[hover].x} cy={xy[hover].y} r="5" fill={color} stroke="var(--card)" stroke-width="2" />
		{/if}
	</svg>

	{#if hover !== null && xy[hover]}
		<div class="tip" style:left="{Math.min(Math.max(xy[hover].x, 70), width - 70)}px" style:top="{Math.max(0, xy[hover].y - 52)}px">
			<span class="tl">{xlabel(points[hover].label)}</span>
			<span class="tv"><span class="sw" style:background={color}></span>{format(points[hover].value)}</span>
		</div>
	{/if}
</div>

<style>
	.chart {
		position: relative;
		width: 100%;
		touch-action: pan-y;
	}
	svg {
		display: block;
		overflow: visible;
	}
	.grid {
		stroke: #34373c;
		stroke-width: 1;
	}
	.grid.base {
		stroke: #45484e;
	}
	.ytick {
		fill: var(--faint);
		font-size: 10.5px;
		text-anchor: end;
	}
	.xtick {
		fill: var(--faint);
		font-size: 10.5px;
		text-anchor: middle;
	}
	.cross {
		stroke: var(--muted);
		stroke-width: 1;
		stroke-dasharray: 3 3;
	}
	.tip {
		position: absolute;
		transform: translateX(-50%);
		pointer-events: none;
		background: #1f2124;
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 6px 9px;
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 12px;
		white-space: nowrap;
		box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
	}
	.tl {
		color: var(--muted);
	}
	.tv {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--text);
		font-weight: 600;
	}
	.sw {
		width: 8px;
		height: 8px;
		border-radius: 2px;
	}
</style>
