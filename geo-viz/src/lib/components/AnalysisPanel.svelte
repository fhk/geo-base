<script lang="ts">
	import { layerListStore, activeLayerStore, selectLayer, updateLayer, removeLayer, runLayerAnalysis, startAnimation, stopAnimation, globalOverridesStore, availableSourceFilesStore, availableFloorsStore, selectedFloorStore, globalTimeRangeStore, globalAnimating, playbackStepStore, setGlobalH3Resolution, setGlobalMetric, setGlobalFilePattern, setTimeSync, syncTimeToAllLayers, setGlobalTime, resetGlobalTimeToFull, startGlobalAnimation, stopGlobalAnimation, setSelectedFloor, showAllFloors, type LayerState } from '$lib/stores/layerList';
	import { getMetricScale } from '$lib/stores/filters';
	import { dropLayerTables } from '$lib/services/duckdb';
	import { layerStore } from '$lib/stores/layers';
	import DataLoader from './DataLoader.svelte';

	interface Props {
		onError: (error: string) => void;
	}

	let { onError }: Props = $props();

	/** Build the metric options for a layer: its discovered columns + always 'count'. */
	function layerMetrics(layer: LayerState): { value: string; label: string }[] {
		const cols = layer.availableMetrics.map((c) => ({ value: c, label: c }));
		return [...cols, { value: 'count', label: 'Count' }];
	}

	/** Resolve the color scale for the layer's current metric. */
	function layerScale(layer: LayerState) {
		return getMetricScale(layer.metric, layer.metricRanges);
	}

	// Debounce timers per layer
	const analysisTimers = new Map<string, ReturnType<typeof setTimeout>>();

	function debouncedAnalysis(layerId: string) {
		const existing = analysisTimers.get(layerId);
		if (existing) clearTimeout(existing);
		analysisTimers.set(layerId, setTimeout(() => {
			runLayerAnalysis(layerId);
			analysisTimers.delete(layerId);
		}, 300));
	}

	function handleMetricChange(layer: LayerState, newMetric: string) {
		const scale = getMetricScale(newMetric, layer.metricRanges);
		updateLayer(layer.id, { metric: newMetric, rangeMin: scale.min, rangeMax: scale.max });
	}

	function groupSourceFiles(files: string[]): Map<string, string[]> {
		const groups = new Map<string, string[]>();
		for (const f of files) {
			const lastSlash = f.lastIndexOf('/');
			const folder = lastSlash > 0 ? f.substring(0, lastSlash) : '';
			const list = groups.get(folder) || [];
			list.push(f);
			groups.set(folder, list);
		}
		return groups;
	}

	function fileName(path: string): string {
		const name = path.split('/').pop() ?? path;
		return name.replace(/\.csv$/i, '');
	}

	function handleSourceFileChange(layer: LayerState, sourceFile: string | null) {
		updateLayer(layer.id, { selectedSourceFile: sourceFile });
		debouncedAnalysis(layer.id);
	}

	function handleResolutionChange(layer: LayerState, resolution: number) {
		updateLayer(layer.id, { h3Resolution: resolution });
		debouncedAnalysis(layer.id);
	}

	// Global time debounce
	let globalTimeTimer: ReturnType<typeof setTimeout> | null = null;
	function debouncedGlobalTime(start: number | null, end: number | null) {
		if (globalTimeTimer) clearTimeout(globalTimeTimer);
		globalTimeTimer = setTimeout(() => {
			setGlobalTime(start, end);
			globalTimeTimer = null;
		}, 300);
	}

	// Track current global time window for the sliders
	let globalTimeStart = $state<number | null>(null);
	let globalTimeEnd = $state<number | null>(null);

	// Seed global time from first layer that has time data, and track during animation
	$effect(() => {
		const range = $globalTimeRangeStore;
		if (range && globalTimeStart === null) {
			globalTimeStart = range[0];
			globalTimeEnd = range[1];
		}
	});

	// Keep global slider in sync when animation moves the layers
	$effect(() => {
		if ($globalAnimating) {
			const ref = $layerListStore.find((l) => l.timeStart !== null);
			if (ref && ref.timeStart !== null && ref.timeEnd !== null) {
				globalTimeStart = ref.timeStart;
				globalTimeEnd = ref.timeEnd;
			}
		}
	});

	function handleTimeChange(layer: LayerState, startTime: number | null, endTime: number | null) {
		updateLayer(layer.id, { timeStart: startTime, timeEnd: endTime });
		debouncedAnalysis(layer.id);
		if ($globalOverridesStore.timeSync) {
			syncTimeToAllLayers(layer.id, startTime, endTime);
		}
	}

	function togglePlay(layer: LayerState) {
		if (layer.isAnimating) {
			stopAnimation(layer.id);
		} else {
			startAnimation(layer.id);
		}
	}

	function resetToFullRange(layer: LayerState) {
		if (layer.timeRange) {
			handleTimeChange(layer, layer.timeRange[0], layer.timeRange[1]);
		}
	}

	async function handleRemoveLayer(layer: LayerState) {
		// Cleanup DuckDB tables
		if (layer.duckdbTables.length > 0) {
			await dropLayerTables(layer.duckdbTables, layer.duckdbView);
		}
		// Cleanup deck.gl layers
		layerStore.register(`h3-layer-${layer.id}`, null);
		if (layer.rasterOverlay) {
			layerStore.register(`raster-${layer.id}`, null);
			if (layer.rasterOverlay.imageUrl.startsWith('blob:')) {
				URL.revokeObjectURL(layer.rasterOverlay.imageUrl);
			}
		}
		removeLayer(layer.id);
	}

	function formatTimestamp(t: number | null) {
		if (t === null) return '--:--:--';
		const date = new Date(t * 1000);
		return date.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
	}

	function getResolutionLabel(res: number) {
		if (res <= 8) return 'Regional (~500m)';
		if (res === 9) return 'District (~170m)';
		if (res === 10) return 'Neighborhood (~65m)';
		if (res === 11) return 'Block (~25m)';
		if (res === 12) return 'Area (~9m)';
		if (res === 13) return 'Fine (~3m)';
		if (res === 14) return 'Precise (~1m)';
		return 'Ultra (~0.5m)';
	}

	let activeTab = $state<'global' | 'layers'>('layers');
	let showSpeedInput = $state(false);
	let hasMultipleLayers = $derived($layerListStore.length > 1);
</script>

<div class="bg-white rounded-lg shadow-lg w-80 max-h-[85vh] flex flex-col">
	<!-- Header with upload -->
	<div class="p-3 border-b border-gray-100">
		<h3 class="text-sm font-semibold text-gray-800 mb-2">Layers</h3>
		<DataLoader {onError} />
	</div>

	<!-- Tabs -->
	{#if hasMultipleLayers}
		<div class="flex border-b border-gray-200">
			<button
				class="flex-1 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors
					{activeTab === 'global'
						? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50'
						: 'text-gray-400 hover:text-gray-600'}"
				onclick={() => (activeTab = 'global')}
			>Global</button>
			<button
				class="flex-1 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors
					{activeTab === 'layers'
						? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50'
						: 'text-gray-400 hover:text-gray-600'}"
				onclick={() => (activeTab = 'layers')}
			>Layers <span class="text-[9px] font-normal text-gray-400">({$layerListStore.length})</span></button>
		</div>
	{/if}

	<!-- Tab content -->
	<div class="flex-1 overflow-y-auto">

		<!-- ═══ GLOBAL TAB ═══ -->
		{#if hasMultipleLayers && activeTab === 'global'}
			<div class="px-3 py-3 space-y-3">

				<!-- Global Metric -->
				<div class="flex items-center gap-2">
					<span class="text-[10px] text-gray-500 w-12 shrink-0">Metric</span>
					<select
						class="flex-1 px-1.5 py-0.5 text-[11px] border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
						value={$globalOverridesStore.metric ?? ''}
						onchange={(e) => {
							const val = (e.target as HTMLSelectElement).value;
							setGlobalMetric(val === '' ? null : val);
						}}
					>
						<option value="">Per-layer</option>
						{#each [...new Set($layerListStore.flatMap(l => layerMetrics(l).map(m => m.value)))] as m}
							<option value={m}>{m}</option>
						{/each}
					</select>
				</div>

				<!-- Global H3 Resolution -->
				<div class="flex items-center gap-2">
					<span class="text-[10px] text-gray-500 w-12 shrink-0">H3 Res</span>
					<select
						class="flex-1 px-1.5 py-0.5 text-[11px] border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
						value={$globalOverridesStore.h3Resolution ?? ''}
						onchange={(e) => {
							const val = (e.target as HTMLSelectElement).value;
							setGlobalH3Resolution(val === '' ? null : Number(val));
						}}
					>
						<option value="">Per-layer</option>
						{#each [8,9,10,11,12,13,14,15] as r}
							<option value={r}>{r} — {getResolutionLabel(r)}</option>
						{/each}
					</select>
				</div>

				<!-- Global Source filter -->
				{#if $availableSourceFilesStore.length > 0}
					<div class="flex items-center gap-2">
						<span class="text-[10px] text-gray-500 w-12 shrink-0">Source</span>
						<select
							class="flex-1 px-1.5 py-0.5 text-[11px] border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
							value={$globalOverridesStore.filePattern ?? ''}
							onchange={(e) => {
								const val = (e.target as HTMLSelectElement).value;
								setGlobalFilePattern(val === '' ? null : val);
							}}
						>
							<option value="">All files</option>
							{#each $availableSourceFilesStore as band}
								<option value={band}>{band}</option>
							{/each}
						</select>
					</div>
				{/if}

				<!-- Floor Picker -->
				{#if $availableFloorsStore.length > 1}
					<div>
						<div class="flex items-center gap-2 mb-1.5">
							<span class="text-[10px] text-gray-500 w-12 shrink-0">Floor</span>
							<button
								class="px-2 py-0.5 text-[10px] rounded border transition-colors {$selectedFloorStore === null
									? 'bg-blue-600 border-blue-600 text-white font-semibold'
									: 'bg-white border-gray-300 text-gray-500 hover:border-gray-400'}"
								onclick={() => showAllFloors()}
							>All</button>
						</div>
						<div class="flex flex-wrap gap-1 pl-14">
							{#each $availableFloorsStore as f}
								<button
									class="min-w-[28px] px-1.5 py-0.5 text-[10px] rounded border transition-colors {$selectedFloorStore === f.floor
										? 'bg-blue-600 border-blue-600 text-white font-semibold'
										: 'bg-white border-gray-300 text-gray-600 hover:border-blue-400 hover:text-blue-600'}"
									onclick={() => {
										if ($selectedFloorStore === f.floor) {
											showAllFloors();
										} else {
											setSelectedFloor(f.floor);
										}
									}}
								>{f.floor}</button>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Time Sync + Global Slider -->
				<div class="space-y-1.5">
					<div class="flex items-center gap-2">
						<span class="text-[10px] text-gray-500 w-12 shrink-0">Time</span>
						<button
							class="flex-1 px-1.5 py-0.5 text-[11px] rounded border transition-colors {$globalOverridesStore.timeSync
								? 'bg-blue-100 border-blue-400 text-blue-700 font-semibold'
								: 'bg-white border-gray-300 text-gray-500 hover:border-gray-400'}"
							onclick={() => setTimeSync(!$globalOverridesStore.timeSync)}
						>
							{$globalOverridesStore.timeSync ? 'Synced' : 'Sync off'}
						</button>
					</div>

					{#if $globalOverridesStore.timeSync && $globalTimeRangeStore}
						{@const gRange = $globalTimeRangeStore}
						<div class="bg-gray-50 rounded p-1.5 space-y-1.5 border border-gray-100">
							<div class="flex justify-between items-center">
								<span class="text-[8px] font-bold text-gray-400 uppercase">Global Window</span>
								<div class="flex items-center gap-1">
									<button
										class="text-[9px] bg-gray-100 px-1.5 py-0.5 rounded text-gray-500 hover:bg-gray-200"
										onclick={() => {
											globalTimeStart = gRange[0];
											globalTimeEnd = gRange[1];
											resetGlobalTimeToFull();
										}}
									>Full</button>
									<button
										class="p-0.5 rounded-full {$globalAnimating ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'} hover:opacity-80"
										onclick={() => {
											if ($globalAnimating) {
												stopGlobalAnimation();
											} else {
												startGlobalAnimation();
											}
										}}
										ondblclick={(e) => {
											e.preventDefault();
											showSpeedInput = !showSpeedInput;
										}}
										title="Click: play/pause — Double-click: speed settings"
									>
										{#if $globalAnimating}
											<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
										{:else}
											<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
										{/if}
									</button>
								</div>
							</div>
							{#if showSpeedInput}
								<div class="flex items-center gap-2 pt-0.5">
									<span class="text-[8px] font-bold text-gray-400 uppercase">Step</span>
									<input
										type="number"
										min="1"
										max="120"
										value={$playbackStepStore}
										onchange={(e) => {
											const v = Math.max(1, Math.min(120, Number((e.target as HTMLInputElement).value)));
											playbackStepStore.set(v);
										}}
										class="w-14 px-1 py-0.5 text-[10px] font-mono border border-gray-300 rounded text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
									/>
									<span class="text-[8px] text-gray-400">sec/tick</span>
								</div>
							{/if}
							<div class="space-y-0.5">
								<div class="flex justify-between text-[8px] uppercase font-bold text-gray-400">
									<span>Start</span>
									<span class="font-mono text-blue-600">{formatTimestamp(globalTimeStart)}</span>
								</div>
								<input
									type="range"
									min={gRange[0]}
									max={gRange[1]}
									step="1"
									value={globalTimeStart ?? gRange[0]}
									oninput={(e) => {
										let v = Number((e.target as HTMLInputElement).value);
										if (globalTimeEnd !== null && v > globalTimeEnd) v = globalTimeEnd;
										globalTimeStart = v;
										debouncedGlobalTime(v, globalTimeEnd);
									}}
									class="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
								/>
							</div>
							<div class="space-y-0.5">
								<div class="flex justify-between text-[8px] uppercase font-bold text-gray-400">
									<span>End</span>
									<span class="font-mono text-blue-600">{formatTimestamp(globalTimeEnd)}</span>
								</div>
								<input
									type="range"
									min={gRange[0]}
									max={gRange[1]}
									step="1"
									value={globalTimeEnd ?? gRange[1]}
									oninput={(e) => {
										let v = Number((e.target as HTMLInputElement).value);
										if (globalTimeStart !== null && v < globalTimeStart) v = globalTimeStart;
										globalTimeEnd = v;
										debouncedGlobalTime(globalTimeStart, v);
									}}
									class="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
								/>
							</div>
							{#if globalTimeStart !== null && globalTimeEnd !== null}
								<div class="flex justify-between items-center text-[9px]">
									<span class="text-gray-400 italic">{Math.round(globalTimeEnd - globalTimeStart)}s</span>
									{#if $globalAnimating}
										<span class="text-orange-500 font-bold animate-pulse">Playing...</span>
									{/if}
								</div>
							{/if}
						</div>
					{/if}
				</div>
			</div>

		<!-- ═══ LAYERS TAB ═══ -->
		{:else}
			{#if $layerListStore.length === 0}
				<div class="p-4 text-center text-xs text-gray-400">
					No layers loaded. Upload a ZIP or use demo data.
				</div>
			{:else}
				{#each $layerListStore as layer (layer.id)}
					{@const isActive = layer.selected}
					<div class="border-b border-gray-100 {isActive ? 'bg-blue-50' : ''}">
						<!-- Layer header -->
						<div class="flex items-center gap-2 px-3 py-2">
							<button
								class="flex-1 text-left text-sm font-medium truncate {isActive ? 'text-blue-700' : 'text-gray-700'}"
								onclick={() => selectLayer(layer.id)}
								title={layer.name}
							>
								<span class="mr-1 text-[10px] text-gray-400">{isActive ? '▼' : '▶'}</span>
								{layer.name}
							</button>

							{#if layer.isLoading}
								<svg class="animate-spin h-3.5 w-3.5 text-blue-500 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
									<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
									<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
								</svg>
							{/if}

							<!-- Raster toggle -->
							{#if layer.rasterOverlay}
								<button
									class="p-1 rounded hover:bg-gray-200 {layer.rasterVisible ? 'text-blue-600' : 'text-gray-300'}"
									onclick={() => updateLayer(layer.id, { rasterVisible: !layer.rasterVisible })}
									title={layer.rasterVisible ? 'Hide raster' : 'Show raster'}
								>
									<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
										<rect x="5" y="5" width="14" height="14" transform="skewX(-15)" stroke-linejoin="round" />
									</svg>
								</button>
							{/if}

							<!-- Visibility toggle -->
							<button
								class="p-1 rounded hover:bg-gray-200 {layer.visible ? 'text-blue-600' : 'text-gray-300'}"
								onclick={() => updateLayer(layer.id, { visible: !layer.visible })}
								title={layer.visible ? 'Hide layer' : 'Show layer'}
							>
								<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									{#if layer.visible}
										<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
									{:else}
										<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>
									{/if}
								</svg>
							</button>

							<!-- Remove -->
							<button
								class="p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-600"
								onclick={() => handleRemoveLayer(layer)}
								title="Remove layer"
							>
								<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
							</button>
						</div>

						<!-- Cell count badge -->
						{#if layer.cellCount > 0}
							<div class="px-3 pb-1 -mt-1">
								<span class="text-[10px] font-mono text-gray-400">{layer.cellCount} cells</span>
							</div>
						{/if}

						<!-- Expanded controls for active layer -->
						{#if isActive}
							<div class="px-3 pb-3 space-y-3">

								<!-- Source File selector -->
								{#if layer.sourceFiles.length > 0}
									{@const grouped = groupSourceFiles(layer.sourceFiles)}
									<div>
										<label class="block text-[10px] font-bold text-gray-500 uppercase mb-1">Source</label>
										<select
											class="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
											value={layer.selectedSourceFile ?? ''}
											onchange={(e) => {
												const val = (e.target as HTMLSelectElement).value;
												handleSourceFileChange(layer, val === '' ? null : val);
											}}
										>
											{#if layer.sourceFiles.length > 1}
												<option value="">All files ({layer.sourceFiles.length})</option>
											{/if}
											{#if grouped.size === 1 && [...grouped.keys()][0] === ''}
												{#each layer.sourceFiles as file}
													<option value={file}>{fileName(file)}</option>
												{/each}
											{:else}
												{#each [...grouped.entries()] as [folder, files]}
													<optgroup label={folder || 'Root'}>
														{#each files as file}
															<option value={file}>{fileName(file)}</option>
														{/each}
													</optgroup>
												{/each}
											{/if}
										</select>
									</div>
								{/if}

								<!-- Metric -->
								<div>
									<label class="block text-[10px] font-bold text-gray-500 uppercase mb-1">Metric</label>
									<select
										class="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
										value={layer.metric}
										onchange={(e) => handleMetricChange(layer, (e.target as HTMLSelectElement).value)}
									>
										{#each layerMetrics(layer) as m}
											<option value={m.value}>{m.label}</option>
										{/each}
									</select>
								</div>

								<!-- Range -->
								<div>
									<label class="block text-[10px] font-bold text-gray-500 uppercase mb-1">
										{layerScale(layer).label}
									</label>
									<div class="space-y-1.5">
										<div class="flex items-center gap-2">
											<span class="text-[10px] text-gray-400 w-6">Min</span>
											<input
												type="range"
												min={layerScale(layer).min}
												max={layerScale(layer).max}
												step={(layerScale(layer).max - layerScale(layer).min) / 100}
												value={layer.rangeMin}
												oninput={(e) => updateLayer(layer.id, { rangeMin: Number((e.target as HTMLInputElement).value) })}
												class="flex-1 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
											/>
											<span class="text-[10px] text-gray-600 w-14 text-right font-mono">{layer.rangeMin.toFixed(1)}</span>
										</div>
										<div class="flex items-center gap-2">
											<span class="text-[10px] text-gray-400 w-6">Max</span>
											<input
												type="range"
												min={layerScale(layer).min}
												max={layerScale(layer).max}
												step={(layerScale(layer).max - layerScale(layer).min) / 100}
												value={layer.rangeMax}
												oninput={(e) => updateLayer(layer.id, { rangeMax: Number((e.target as HTMLInputElement).value) })}
												class="flex-1 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
											/>
											<span class="text-[10px] text-gray-600 w-14 text-right font-mono">{layer.rangeMax.toFixed(1)}</span>
										</div>
									</div>

									<!-- Quick range reset -->
									<div class="flex gap-1 mt-1.5">
										<button class="px-1.5 py-0.5 text-[10px] bg-gray-50 text-gray-600 rounded hover:bg-gray-100"
											onclick={() => {
												updateLayer(layer.id, { rangeMin: layerScale(layer).min, rangeMax: layerScale(layer).max });
											}}>Reset range</button>
									</div>
								</div>

								<!-- H3 Resolution -->
								<div>
									<div class="flex justify-between items-center mb-0.5">
										<label class="text-[10px] font-bold text-gray-500 uppercase">H3 Resolution</label>
										<span class="text-sm font-bold text-blue-600">{layer.h3Resolution}</span>
									</div>
									<p class="text-[9px] text-blue-500 font-medium uppercase tracking-wider mb-1">
										{getResolutionLabel(layer.h3Resolution)}
									</p>
									<input
										type="range"
										min="8"
										max="15"
										step="1"
										value={layer.h3Resolution}
										oninput={(e) => handleResolutionChange(layer, Number((e.target as HTMLInputElement).value))}
										class="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
									/>
									<div class="flex justify-between text-[9px] text-gray-400 mt-0.5">
										<span>8</span>
										<span>15</span>
									</div>
								</div>

								<!-- Time Window -->
								{#if layer.timeRange}
									<div>
										<div class="flex justify-between items-center mb-1">
											<label class="text-[10px] font-bold text-gray-500 uppercase">Time</label>
											<div class="flex gap-1">
												<button
													class="text-[9px] bg-gray-100 px-1.5 py-0.5 rounded text-gray-500 hover:bg-gray-200"
													onclick={() => resetToFullRange(layer)}
												>Full</button>
												<button
													class="p-0.5 rounded-full {layer.isAnimating ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'} hover:opacity-80"
													onclick={() => togglePlay(layer)}
													ondblclick={(e) => {
														e.preventDefault();
														showSpeedInput = !showSpeedInput;
													}}
													title="Click: play/pause — Double-click: speed settings"
												>
													{#if layer.isAnimating}
														<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
													{:else}
														<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
													{/if}
												</button>
											</div>
										</div>
										{#if showSpeedInput}
											<div class="flex items-center gap-2 mb-1">
												<span class="text-[8px] font-bold text-gray-400 uppercase">Step</span>
												<input
													type="number"
													min="1"
													max="120"
													value={$playbackStepStore}
													onchange={(e) => {
														const v = Math.max(1, Math.min(120, Number((e.target as HTMLInputElement).value)));
														playbackStepStore.set(v);
													}}
													class="w-14 px-1 py-0.5 text-[10px] font-mono border border-gray-300 rounded text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
												/>
												<span class="text-[8px] text-gray-400">sec/tick</span>
											</div>
										{/if}
										<div class="bg-gray-50 p-1.5 rounded space-y-2">
											<div class="space-y-0.5">
												<div class="flex justify-between text-[8px] uppercase font-bold text-gray-400">
													<span>Start</span>
													<span class="font-mono text-blue-600">{formatTimestamp(layer.timeStart)}</span>
												</div>
												<input
													type="range"
													min={layer.timeRange[0]}
													max={layer.timeRange[1]}
													step="1"
													value={layer.timeStart ?? layer.timeRange[0]}
													oninput={(e) => {
														let v = Number((e.target as HTMLInputElement).value);
														if (layer.timeEnd !== null && v > layer.timeEnd) v = layer.timeEnd;
														handleTimeChange(layer, v, layer.timeEnd);
													}}
													class="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
												/>
											</div>
											<div class="space-y-0.5">
												<div class="flex justify-between text-[8px] uppercase font-bold text-gray-400">
													<span>End</span>
													<span class="font-mono text-blue-600">{formatTimestamp(layer.timeEnd)}</span>
												</div>
												<input
													type="range"
													min={layer.timeRange[0]}
													max={layer.timeRange[1]}
													step="1"
													value={layer.timeEnd ?? layer.timeRange[1]}
													oninput={(e) => {
														let v = Number((e.target as HTMLInputElement).value);
														if (layer.timeStart !== null && v < layer.timeStart) v = layer.timeStart;
														handleTimeChange(layer, layer.timeStart, v);
													}}
													class="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
												/>
											</div>
										</div>
										{#if layer.timeStart !== null && layer.timeEnd !== null}
											<div class="flex justify-between items-center text-[9px] mt-0.5">
												<span class="text-gray-400 italic">{Math.round(layer.timeEnd - layer.timeStart)}s</span>
												{#if layer.isAnimating}
													<span class="text-orange-500 font-bold animate-pulse">Playing...</span>
												{/if}
											</div>
										{/if}
									</div>
								{/if}

								<!-- Opacity -->
								<div>
									<label class="block text-[10px] font-bold text-gray-500 uppercase mb-1">Opacity</label>
									<div class="flex items-center gap-2">
										<input
											type="range"
											min="0"
											max="1"
											step="0.05"
											value={layer.opacity}
											oninput={(e) => updateLayer(layer.id, { opacity: Number((e.target as HTMLInputElement).value) })}
											class="flex-1 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
										/>
										<span class="text-[10px] text-gray-500 font-mono w-8 text-right">{layer.opacity.toFixed(2)}</span>
									</div>
								</div>

							</div>
						{/if}
					</div>
				{/each}
			{/if}
		{/if}
	</div>
</div>
