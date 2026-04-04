<script lang="ts">
	import { onMount } from 'svelte';
	import { BitmapLayer } from '@deck.gl/layers';
	import { initDuckDB, ingestFilesForLayer, parseZip, getTimeBoundsForTables, getSourceFilesForTables, getDataBoundsForTables, getMetricRangesForTables } from '$lib/services/duckdb';
	import { getMetricScale } from '$lib/stores/filters';
	import { parseTabFile } from '$lib/services/tabParser';
	import { layerStore } from '$lib/stores/layers';
	import { layerListStore, addLayer, updateLayer, removeLayer, runLayerAnalysis, getLayer } from '$lib/stores/layerList';
	import { mapStore, viewStateStore } from '$lib/stores/map';

	interface Props {
		onError: (error: string) => void;
	}

	let { onError }: Props = $props();

	let isLoading = $state(false);
	let statusMsg = $state('');
	let isInitialized = $state(false);
	let zipFileInput = $state<HTMLInputElement | null>(null);
	let csvFileInput = $state<HTMLInputElement | null>(null);

	onMount(async () => {
		try {
			statusMsg = 'Initializing DuckDB…';
			isLoading = true;
			await initDuckDB();
			isInitialized = true;
			statusMsg = '';
		} catch (e) {
			onError(`Failed to initialize DuckDB: ${e}`);
		} finally {
			isLoading = false;
		}
	});

	// ── Helpers ────────────────────────────────────────────────────────────────

	function registerRasterForLayer(layerId: string, tabContent: string, imageUrl: string) {
		try {
			const parsed = parseTabFile(tabContent);
			const rasterLayerId = `raster-${layerId}`;
			const layerInfo = getLayer(layerId);

			const layer = new BitmapLayer({
				id: rasterLayerId,
				bounds: parsed.deckBounds,
				image: imageUrl,
				opacity: layerInfo?.opacity ?? 0.75,
				visible: (layerInfo?.visible ?? true) && (layerInfo?.rasterVisible ?? true),
				textureParameters: { minFilter: 'linear', magFilter: 'linear' },
				pickable: false
			});

			layerStore.register(rasterLayerId, layer);

			updateLayer(layerId, {
				rasterOverlay: {
					bounds: parsed.deckBounds,
					imageUrl,
					opacity: 0.75,
					tabContent,
					imageFilename: parsed.imageFile
				}
			});
		} catch (err) {
			console.warn('Could not register raster for layer:', err);
		}
	}

	function zoomToBounds(bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number }) {
		const deck = $mapStore as any;
		if (!deck) return;
		const centerLat = (bounds.minLat + bounds.maxLat) / 2;
		const centerLon = (bounds.minLon + bounds.maxLon) / 2;
		const span = Math.max(bounds.maxLat - bounds.minLat, bounds.maxLon - bounds.minLon);
		const zoom = span > 0 ? Math.min(20, Math.max(1, -Math.log2(span / 360) + 1)) : 16;
		deck.setProps({
			initialViewState: { longitude: centerLon, latitude: centerLat, zoom, pitch: 45, bearing: 0, transitionDuration: 800 }
		});
	}

	async function applyMetricsToLayer(layerId: string, metricColumns: string[], tables: string[]) {
		const metricRanges = await getMetricRangesForTables(tables, metricColumns);
		const defaultMetric = metricColumns.length > 0 ? metricColumns[0] : 'count';
		const defaultScale = getMetricScale(defaultMetric, metricRanges);
		updateLayer(layerId, {
			availableMetrics: metricColumns,
			metricRanges,
			metric: defaultMetric,
			rangeMin: defaultScale.min,
			rangeMax: defaultScale.max
		});
	}

	// ── CSV upload ─────────────────────────────────────────────────────────────

	async function handleCsvUpload(event: Event) {
		const target = event.target as HTMLInputElement;
		const uploadedFiles = target.files;
		if (!uploadedFiles || uploadedFiles.length === 0) return;

		const allTables: string[] = [];

		for (const file of Array.from(uploadedFiles)) {
			const layerId = addLayer({ name: file.name.replace(/\.csv$/i, ''), isLoading: true });
			try {
				isLoading = true;
				statusMsg = `Ingesting ${file.name}…`;
				const buffer = new Uint8Array(await file.arrayBuffer());
				const ingest = await ingestFilesForLayer(layerId, [{ name: file.name, buffer }]);

				const bounds = await getTimeBoundsForTables(ingest.tables);
				const srcFiles = await getSourceFilesForTables(ingest.tables);

				updateLayer(layerId, {
					duckdbTables: ingest.tables,
					duckdbView: ingest.viewName,
					isLoading: false,
					timeRange: bounds,
					timeStart: bounds ? bounds[0] : null,
					timeEnd: bounds ? bounds[1] : null,
					sourceFiles: srcFiles
				});

				await applyMetricsToLayer(layerId, ingest.metricColumns, ingest.tables);
				allTables.push(...ingest.tables);
				await runLayerAnalysis(layerId);
			} catch (e) {
				onError(`Failed to ingest ${file.name}: ${e}`);
				removeLayer(layerId);
			}
		}

		isLoading = false;
		statusMsg = '';
		if (csvFileInput) csvFileInput.value = '';

		if (allTables.length > 0) {
			const geoBounds = await getDataBoundsForTables(allTables);
			if (geoBounds) zoomToBounds(geoBounds);
		}
	}

	// ── ZIP upload ─────────────────────────────────────────────────────────────

	async function handleZipUpload(event: Event) {
		const target = event.target as HTMLInputElement;
		const uploadedFiles = target.files;
		if (!uploadedFiles || uploadedFiles.length === 0) return;

		for (const file of Array.from(uploadedFiles)) {
			try {
				statusMsg = `Parsing ${file.name}…`;
				const parsed = await parseZip(file);
				const hasMultipleFolders = parsed.folders.length > 1;
				const allTables: string[] = [];

				if (hasMultipleFolders) {
					for (const folder of parsed.folders) {
						const layerId = addLayer({
							name: folder.folderName || file.name.replace(/\.zip$/i, ''),
							isLoading: true
						});

						try {
							statusMsg = `Ingesting ${folder.folderName}…`;
							const ingest = await ingestFilesForLayer(layerId, folder.files);

							const bounds = await getTimeBoundsForTables(ingest.tables);
							const srcFiles = await getSourceFilesForTables(ingest.tables);

							updateLayer(layerId, {
								duckdbTables: ingest.tables,
								duckdbView: ingest.viewName,
								isLoading: false,
								timeRange: bounds,
								timeStart: bounds ? bounds[0] : null,
								timeEnd: bounds ? bounds[1] : null,
								sourceFiles: srcFiles
							});

							await applyMetricsToLayer(layerId, ingest.metricColumns, ingest.tables);
							allTables.push(...ingest.tables);

							if (parsed.raster) {
								const url = URL.createObjectURL(parsed.raster.imageBlob);
								registerRasterForLayer(layerId, parsed.raster.tabContent, url);
							}

							await runLayerAnalysis(layerId);
						} catch (e) {
							onError(`Failed to ingest ${folder.folderName}: ${e}`);
							removeLayer(layerId);
						}
					}
				} else {
					const layerId = addLayer({
						name: file.name.replace(/\.zip$/i, ''),
						isLoading: true
					});

					try {
						const allFiles = parsed.folders.flatMap((f) => f.files);
						const ingest = await ingestFilesForLayer(layerId, allFiles);

						const bounds = await getTimeBoundsForTables(ingest.tables);
						const srcFiles = await getSourceFilesForTables(ingest.tables);

						updateLayer(layerId, {
							duckdbTables: ingest.tables,
							duckdbView: ingest.viewName,
							isLoading: false,
							timeRange: bounds,
							timeStart: bounds ? bounds[0] : null,
							timeEnd: bounds ? bounds[1] : null,
							sourceFiles: srcFiles
						});

						await applyMetricsToLayer(layerId, ingest.metricColumns, ingest.tables);
						allTables.push(...ingest.tables);

						if (parsed.raster) {
							const url = URL.createObjectURL(parsed.raster.imageBlob);
							registerRasterForLayer(layerId, parsed.raster.tabContent, url);
						}

						await runLayerAnalysis(layerId);
					} catch (e) {
						onError(`Failed to ingest ZIP: ${e}`);
						removeLayer(layerId);
					}
				}

				if (allTables.length > 0) {
					const geoBounds = await getDataBoundsForTables(allTables);
					if (geoBounds) zoomToBounds(geoBounds);
				}
			} catch (e) {
				onError(`Failed to parse ZIP: ${e}`);
			}
		}

		statusMsg = '';
		if (zipFileInput) zipFileInput.value = '';
	}

	// Sync raster visibility/opacity to deck.gl
	$effect(() => {
		for (const layer of $layerListStore) {
			if (layer.rasterOverlay) {
				const rasterLayerId = `raster-${layer.id}`;
				const currentLayer = layerStore.get(rasterLayerId);
				if (currentLayer) {
					const isVisible = layer.visible && layer.rasterVisible;
					if (currentLayer.props.visible !== isVisible || currentLayer.props.opacity !== layer.opacity) {
						layerStore.register(rasterLayerId, currentLayer.clone({ visible: isVisible, opacity: layer.opacity }));
					}
				}
			}
		}
	});
</script>

<div class="space-y-2">
	{#if !isInitialized}
		<div class="text-sm text-gray-500">{statusMsg || 'Loading…'}</div>
		{#if isLoading}
			<div class="h-1 bg-gray-200 rounded overflow-hidden">
				<div class="h-full bg-blue-500 rounded animate-pulse w-full"></div>
			</div>
		{/if}
	{:else}
		<!-- CSV upload -->
		<input bind:this={csvFileInput} type="file" accept=".csv" multiple class="hidden" onchange={handleCsvUpload} id="csv-upload" />
		<label
			for="csv-upload"
			class="flex items-center justify-center gap-2 px-3 py-2 border-2 border-dashed border-gray-200 rounded-lg hover:border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 cursor-pointer text-sm font-medium transition-colors"
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M12 12v9"/><path d="m16 16-4-4-4 4"/></svg>
			Upload CSV
		</label>

		<!-- ZIP upload -->
		<input bind:this={zipFileInput} type="file" accept=".zip" multiple class="hidden" onchange={handleZipUpload} id="zip-upload" />
		<label
			for="zip-upload"
			class="flex items-center justify-center gap-2 px-3 py-2 border border-gray-200 rounded-lg hover:border-gray-300 text-gray-600 bg-white hover:bg-gray-50 cursor-pointer text-xs font-medium transition-colors"
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></svg>
			Upload ZIP <span class="text-gray-400 font-normal">(CSV folders + .tab raster)</span>
		</label>

		{#if isLoading && statusMsg}
			<div class="flex flex-col gap-1 pt-1">
				<div class="h-1 bg-gray-100 rounded overflow-hidden">
					<div class="h-full bg-blue-500 rounded animate-pulse w-full"></div>
				</div>
				<p class="text-[10px] text-blue-600 text-center font-medium animate-pulse">{statusMsg}</p>
			</div>
		{/if}
	{/if}
</div>
