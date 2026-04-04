<script lang="ts">
	import MapView from '$lib/components/Map.svelte';
	import H3Layer from '$lib/components/H3Layer.svelte';
	import AnalysisPanel from '$lib/components/AnalysisPanel.svelte';
	import Legend from '$lib/components/Legend.svelte';
	import DataTable from '$lib/components/DataTable.svelte';
	import { layerListStore, activeLayerStore, updateLayer } from '$lib/stores/layerList';
	import { getMetricScale } from '$lib/stores/filters';
	import { mapStore, viewStateStore, selectedH3Cell } from '$lib/stores/map';
	import { cellToLatLng } from 'h3-js';

	let error = $state<string | null>(null);
	let showTable = $state(false);

	const h3PointSizeMap: Record<number, number> = {
		8: 230,
		9: 90,
		10: 35,
		11: 10,
		12: 4,
		13: 1,
		14: 1,
		15: 1
	};

	let hasAnyLayers = $derived($layerListStore.length > 0);
	let hasAnyCells = $derived($layerListStore.some(l => l.cellCount > 0));

	function handleError(msg: string) {
		error = msg;
	}

	let is3D = $state(true);

	function updateViewState(changes: Partial<import('$lib/stores/map').ViewState>) {
		const deck = $mapStore as any;
		if (!deck) return;
		const current = $viewStateStore;
		deck.setProps({
			initialViewState: {
				longitude: current.longitude,
				latitude: current.latitude,
				zoom: current.zoom,
				pitch: current.pitch,
				bearing: current.bearing,
				...changes,
				transitionDuration: 300
			}
		});
	}

	function toggle3D() {
		is3D = !is3D;
		updateViewState({
			pitch: is3D ? 45 : 0,
			bearing: is3D ? $viewStateStore.bearing : 0
		});
	}

	function rotateBearing(delta: number) {
		updateViewState({ bearing: $viewStateStore.bearing + delta });
	}

	function adjustPitch(delta: number) {
		const newPitch = Math.max(0, Math.min(75, $viewStateStore.pitch + delta));
		updateViewState({ pitch: newPitch });
		is3D = newPitch > 0;
	}

	function handleKeydown(e: KeyboardEvent) {
		if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
		switch (e.key) {
			case 'ArrowLeft':
				e.preventDefault();
				rotateBearing(10);
				break;
			case 'ArrowRight':
				e.preventDefault();
				rotateBearing(-10);
				break;
			case 'ArrowUp':
				e.preventDefault();
				adjustPitch(-10);
				break;
			case 'ArrowDown':
				e.preventDefault();
				adjustPitch(10);
				break;
		}
	}

	// Zoom to selected H3 cell
	$effect(() => {
		const cellId = $selectedH3Cell;
		if (!cellId) return;
		try {
			const [lat, lng] = cellToLatLng(cellId);
			updateViewState({ longitude: lng, latitude: lat });
		} catch {
			// invalid cell id
		}
	});

	// Z-height for active layer
	let activeZHeight = $derived($activeLayerStore?.zHeight ?? 5);
	let activeLayerName = $derived($activeLayerStore?.name ?? '');

	function handleZChange(e: Event) {
		const val = Number((e.target as HTMLInputElement).value);
		const active = $activeLayerStore;
		if (active) {
			updateLayer(active.id, { zHeight: val });
		}
	}

	const defaultCenter: [number, number] = [-121.9694, 37.4033];
</script>

<svelte:head>
	<title>GeoViz — Map</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

<div class="app-root">
	<MapView center={defaultCenter} zoom={16} />

	<!-- Render H3Layer per layer -->
	{#each $layerListStore as layer (layer.id)}
		{#if layer.h3Data && layer.cellCount > 0}
			<H3Layer
				layerId={layer.id}
				layerName={layer.name}
				data={layer.h3Data}
				visible={layer.visible}
				zHeight={layer.zHeight}
				opacity={layer.opacity}
				metric={layer.metric}
				metricScale={getMetricScale(layer.metric, layer.metricRanges)}
				rangeMin={layer.rangeMin}
				rangeMax={layer.rangeMax}
				h3Resolution={layer.h3Resolution}
				pointSize={h3PointSizeMap[layer.h3Resolution] ?? 4}
			/>
		{/if}
	{/each}

	{#if showTable && hasAnyCells}
		<DataTable onClose={() => (showTable = false)} />
	{/if}

	<!-- Controls overlay -->
	<div class="absolute top-4 left-4 right-4 flex items-start justify-between pointer-events-none">
		<div class="flex flex-col gap-3 pointer-events-auto">
			<!-- App header -->
			<div class="app-header">
				<a href="/" class="app-logo">
					<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
						<path d="M12 2L4 7v10l8 5 8-5V7l-8-5z" fill="none" stroke="url(#app-logo-g)" stroke-width="1.5"/>
						<path d="M12 7L7 10v6l5 3 5-3v-6l-5-3z" fill="url(#app-logo-g)" opacity="0.3"/>
						<circle cx="12" cy="12" r="2" fill="url(#app-logo-g)"/>
						<defs><linearGradient id="app-logo-g" x1="4" y1="2" x2="20" y2="22"><stop stop-color="#22c55e"/><stop offset="1" stop-color="#3b82f6"/></linearGradient></defs>
					</svg>
					<span class="app-logo-text">GeoViz</span>
				</a>
				<div class="app-header-right">
					{#if hasAnyCells}
						<button
							class="app-table-btn"
							onclick={() => (showTable = !showTable)}
						>
							<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M3 12h18"/><rect width="18" height="18" x="3" y="3" rx="2"/></svg>
							{showTable ? 'Hide' : 'Table'}
						</button>
					{/if}
				</div>
			</div>

			<AnalysisPanel onError={handleError} />
		</div>

		{#if hasAnyCells}
			<div class="pointer-events-auto">
				<Legend />
			</div>
		{/if}
	</div>

	<!-- Navigation controls + Z height -->
	<div class="absolute bottom-6 right-6 flex items-end gap-3 pointer-events-auto">
		{#if hasAnyCells && $activeLayerStore}
			<div class="z-control">
				<span class="z-label">Z</span>
				<input type="range" min="0" max="200" step="5" value={activeZHeight}
					oninput={handleZChange}
					orient="vertical"
					class="z-slider" />
				<span class="z-value">{activeZHeight}m</span>
			</div>
		{/if}
		<div class="flex flex-col items-center gap-1">
			<button
				class="nav-arrow"
				onclick={() => adjustPitch(-10)}
				title="Tilt down"
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>
			</button>
			<div class="flex items-center gap-1">
				<button
					class="nav-arrow"
					onclick={() => rotateBearing(15)}
					title="Rotate left"
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
				</button>
				<button
					class="nav-3d {is3D ? 'nav-3d-active' : ''}"
					onclick={toggle3D}
					title={is3D ? 'Switch to 2D' : 'Switch to 3D'}
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
						stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<circle cx="12" cy="12" r="10"/>
						<path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/>
						<path d="M2 12h20"/>
					</svg>
				</button>
				<button
					class="nav-arrow"
					onclick={() => rotateBearing(-15)}
					title="Rotate right"
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
				</button>
			</div>
			<button
				class="nav-arrow"
				onclick={() => adjustPitch(10)}
				title="Tilt up"
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
			</button>
		</div>
	</div>

	{#if error}
		<div class="absolute bottom-4 left-4 right-4 flex justify-center pointer-events-none">
			<div class="error-toast pointer-events-auto">
				<span>{error}</span>
				<button
					class="error-close"
					onclick={() => (error = null)}
				>
					&times;
				</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.app-root {
		position: relative;
		width: 100vw;
		height: 100vh;
	}

	/* ---- Header ---- */
	.app-header {
		background: var(--wt-bg-card);
		border: 1px solid var(--wt-border-subtle);
		border-radius: 12px;
		padding: 8px 14px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		backdrop-filter: blur(12px);
	}
	.app-logo {
		display: flex;
		align-items: center;
		gap: 8px;
		text-decoration: none;
	}
	.app-logo-text {
		font-family: var(--font-display);
		font-size: 1rem;
		font-weight: 700;
		color: var(--wt-text-bright);
		letter-spacing: -0.02em;
	}
	.app-header-right {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.app-table-btn {
		display: flex;
		align-items: center;
		gap: 5px;
		background: var(--wt-bg-surface);
		border: 1px solid var(--wt-border);
		border-radius: 6px;
		padding: 5px 10px;
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 500;
		color: var(--wt-text-muted);
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
	}
	.app-table-btn:hover {
		color: var(--wt-text-bright);
		border-color: var(--wt-text-muted);
	}

	/* ---- Nav controls ---- */
	.nav-arrow {
		width: 28px;
		height: 28px;
		background: var(--wt-bg-card);
		border: 1px solid var(--wt-border-subtle);
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--wt-text-muted);
		cursor: pointer;
		transition: background-color 0.15s, color 0.15s, border-color 0.15s;
	}
	.nav-arrow:hover {
		background: var(--wt-bg-card-hover);
		color: var(--wt-green);
		border-color: var(--wt-border);
	}
	.nav-arrow:active {
		background: var(--wt-bg-surface);
	}

	.nav-3d {
		width: 36px;
		height: 36px;
		background: var(--wt-bg-card);
		border: 1px solid var(--wt-border-subtle);
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--wt-text-muted);
		cursor: pointer;
		transition: all 0.15s;
	}
	.nav-3d:hover { color: var(--wt-text-bright); border-color: var(--wt-border); }
	.nav-3d-active {
		color: var(--wt-green);
		border-color: var(--wt-green);
		box-shadow: 0 0 12px rgba(34, 197, 94, 0.15);
	}

	/* ---- Z-height slider ---- */
	.z-control {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		background: var(--wt-bg-card);
		border: 1px solid var(--wt-border-subtle);
		border-radius: 10px;
		padding: 8px 6px;
	}
	.z-label {
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 600;
		color: var(--wt-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.z-slider {
		writing-mode: vertical-lr;
		direction: rtl;
		width: 14px;
		height: 80px;
		cursor: pointer;
		appearance: slider-vertical;
		accent-color: var(--wt-green);
	}
	.z-value {
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 600;
		color: var(--wt-green);
	}

	/* ---- Error toast ---- */
	.error-toast {
		background: rgba(127, 29, 29, 0.9);
		border: 1px solid rgba(239, 68, 68, 0.4);
		color: #fca5a5;
		padding: 10px 16px;
		border-radius: 10px;
		backdrop-filter: blur(12px);
		display: flex;
		align-items: center;
		gap: 12px;
		font-size: 13px;
	}
	.error-close {
		color: #fca5a5;
		background: none;
		border: none;
		font-size: 18px;
		font-weight: bold;
		cursor: pointer;
		line-height: 1;
	}
	.error-close:hover { color: #ffffff; }
</style>
