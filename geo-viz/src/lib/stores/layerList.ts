import { writable, derived, get } from 'svelte/store';
import type { DataMetric } from './filters';
import { getMetricScale, countScale } from './filters';
import { runH3AnalysisForLayer } from '$lib/services/duckdb';

// ── Global overrides ──────────────────────────────────────────────────
export interface GlobalOverrides {
	h3Resolution: number | null;  // null = per-layer
	metric: DataMetric | null;
	filePattern: string | null;   // base filename (without path/extension)
	timeSync: boolean;
}

export const globalOverridesStore = writable<GlobalOverrides>({
	h3Resolution: null,
	metric: null,
	filePattern: null,
	timeSync: false
});

/** Playback step size in seconds — controls how fast time advances per tick */
export const playbackStepStore = writable(5);

export interface RasterOverlay {
	bounds: [number, number, number, number]; // deck.gl BitmapLayer bounds
	imageUrl: string;
	opacity: number;
	tabContent: string;
	imageFilename: string;
}

export interface LayerState {
	id: string;
	name: string;
	visible: boolean;
	selected: boolean;
	zHeight: number;
	opacity: number;
	/** Currently selected metric column name (or 'count'). */
	metric: DataMetric;
	rangeMin: number;
	rangeMax: number;
	h3Resolution: number;
	timeRange: [number, number] | null;
	timeStart: number | null;
	timeEnd: number | null;
	isAnimating: boolean;
	duckdbTables: string[];
	duckdbView: string;
	sourceFiles: string[];
	selectedSourceFile: string | null;
	rasterOverlay: RasterOverlay | null;
	rasterVisible: boolean;
	h3Data: any;
	cellCount: number;
	isLoading: boolean;
	/** Numeric column names discovered in the ingested data. */
	availableMetrics: string[];
	/** Per-column data min/max, used to auto-range the color scale. */
	metricRanges: Record<string, { min: number; max: number }>;
}

let nextId = 0;

function createDefaults(): Omit<LayerState, 'id' | 'name'> {
	return {
		visible: true,
		selected: false,
		zHeight: 5,
		opacity: 0.7,
		metric: 'count',
		rangeMin: countScale.min,
		rangeMax: countScale.max,
		h3Resolution: 12,
		timeRange: null,
		timeStart: null,
		timeEnd: null,
		isAnimating: false,
		duckdbTables: [],
		duckdbView: '',
		sourceFiles: [],
		selectedSourceFile: null,
		rasterOverlay: null,
		rasterVisible: true,
		h3Data: null,
		cellCount: 0,
		isLoading: false,
		availableMetrics: [],
		metricRanges: {}
	};
}

export const layerListStore = writable<LayerState[]>([]);

export const activeLayerStore = derived(layerListStore, (layers) =>
	layers.find((l) => l.selected) ?? null
);

/** Union of all layers' time ranges — used by the global time slider */
export const globalTimeRangeStore = derived(layerListStore, (layers) => {
	let min = Infinity;
	let max = -Infinity;
	for (const l of layers) {
		if (l.timeRange) {
			if (l.timeRange[0] < min) min = l.timeRange[0];
			if (l.timeRange[1] > max) max = l.timeRange[1];
		}
	}
	if (min === Infinity) return null;
	return [min, max] as [number, number];
});

export function addLayer(partial: Partial<LayerState> = {}): string {
	const id = `layer-${nextId++}`;
	const layer: LayerState = {
		...createDefaults(),
		...partial,
		id,
		name: partial.name ?? `Layer ${nextId}`,
		selected: true
	};

	layerListStore.update((layers) => {
		// Deselect all existing layers
		const updated = layers.map((l) => ({ ...l, selected: false }));
		return [layer, ...updated];
	});

	return id;
}

export function removeLayer(id: string): void {
	stopAnimation(id);
	layerListStore.update((layers) => {
		const idx = layers.findIndex((l) => l.id === id);
		if (idx === -1) return layers;

		const wasSelected = layers[idx].selected;
		const remaining = layers.filter((l) => l.id !== id);

		if (wasSelected && remaining.length > 0) {
			const nextIdx = Math.min(idx, remaining.length - 1);
			remaining[nextIdx] = { ...remaining[nextIdx], selected: true };
		}

		return remaining;
	});
}

export function selectLayer(id: string): void {
	layerListStore.update((layers) =>
		layers.map((l) => ({ ...l, selected: l.id === id }))
	);
}

export function updateLayer(id: string, changes: Partial<LayerState>): void {
	layerListStore.update((layers) =>
		layers.map((l) => (l.id === id ? { ...l, ...changes } : l))
	);
}

export function getLayer(id: string): LayerState | undefined {
	return get(layerListStore).find((l) => l.id === id);
}

// Version counter per layer to discard stale analysis results
const analysisVersions = new Map<string, number>();

export async function runLayerAnalysis(layerId: string): Promise<void> {
	const layer = getLayer(layerId);
	if (!layer || layer.duckdbTables.length === 0) return;

	const version = (analysisVersions.get(layerId) ?? 0) + 1;
	analysisVersions.set(layerId, version);

	updateLayer(layerId, { isLoading: true });

	try {
		const result = await runH3AnalysisForLayer(
			layer.duckdbTables,
			layer.duckdbView,
			layer.h3Resolution,
			{
				sourceFile: layer.selectedSourceFile,
				startTime: layer.timeStart,
				endTime: layer.timeEnd,
				metricColumns: layer.availableMetrics
			}
		);

		if (analysisVersions.get(layerId) !== version) return;

		const cellCount = result ? result.numRows : 0;
		updateLayer(layerId, { h3Data: result, cellCount, isLoading: false });
	} catch (e) {
		console.error(`Analysis failed for layer ${layerId}:`, e);
		if (analysisVersions.get(layerId) === version) {
			updateLayer(layerId, { isLoading: false });
		}
	}
}

// ── Animation management ──────────────────────────────────────────────────────

const animationTimers = new Map<string, ReturnType<typeof setTimeout>>();

function animationStep(layerId: string) {
	const timer = setTimeout(async () => {
		const current = getLayer(layerId);
		if (!current || !current.isAnimating) {
			animationTimers.delete(layerId);
			return;
		}

		const { timeStart, timeEnd, timeRange } = current;
		if (!timeRange || timeStart === null || timeEnd === null) {
			animationTimers.delete(layerId);
			return;
		}

		const duration = timeEnd - timeStart;
		const step = get(playbackStepStore);

		let nextStart = timeStart + step;
		let nextEnd = nextStart + duration;

		if (nextStart > timeRange[1]) {
			nextStart = timeRange[0];
			nextEnd = nextStart + duration;
		}
		if (nextEnd > timeRange[1]) nextEnd = timeRange[1];

		updateLayer(layerId, { timeStart: nextStart, timeEnd: nextEnd });
		await runLayerAnalysis(layerId);

		const overrides = get(globalOverridesStore);
		if (overrides.timeSync) {
			syncTimeToAllLayers(layerId, nextStart, nextEnd);
		}

		const afterAnalysis = getLayer(layerId);
		if (afterAnalysis?.isAnimating) {
			animationStep(layerId);
		} else {
			animationTimers.delete(layerId);
		}
	}, 300);
	animationTimers.set(layerId, timer);
}

export function startAnimation(layerId: string): void {
	if (animationTimers.has(layerId)) return;
	updateLayer(layerId, { isAnimating: true });
	animationStep(layerId);
}

export function stopAnimation(layerId: string): void {
	const timer = animationTimers.get(layerId);
	if (timer) {
		clearTimeout(timer);
		animationTimers.delete(layerId);
	}
	updateLayer(layerId, { isAnimating: false });
}

// ── Global override helpers ───────────────────────────────────────────────────

/** Unique base filenames (without path/ext) across all layers */
export const availableSourceFilesStore = derived(layerListStore, (layers) => {
	const baseNames = new Set<string>();
	for (const layer of layers) {
		for (const file of layer.sourceFiles) {
			const baseName = file.split('/').pop()?.replace(/\.csv$/i, '') ?? file;
			baseNames.add(baseName);
		}
	}
	return Array.from(baseNames).sort();
});

/** Extract floor numbers from layer names, sorted numerically */
export const availableFloorsStore = derived(layerListStore, (layers) => {
	const floors: { floor: number; layerId: string; name: string }[] = [];
	for (const layer of layers) {
		const match = layer.name.match(/[_\s]Floor\s+(\d+)/i);
		if (match) {
			floors.push({ floor: parseInt(match[1], 10), layerId: layer.id, name: layer.name });
		}
	}
	return floors.sort((a, b) => a.floor - b.floor);
});

export const selectedFloorStore = writable<number | null>(null);

export function setSelectedFloor(floor: number | null): void {
	selectedFloorStore.set(floor);
	const layers = get(layerListStore);
	for (const layer of layers) {
		const match = layer.name.match(/[_\s]Floor\s+(\d+)/i);
		if (match) {
			const layerFloor = parseInt(match[1], 10);
			updateLayer(layer.id, { visible: floor === null || layerFloor === floor });
		} else if (floor !== null) {
			updateLayer(layer.id, { visible: true });
		}
	}
}

export function showAllFloors(): void {
	selectedFloorStore.set(null);
	const layers = get(layerListStore);
	for (const layer of layers) {
		updateLayer(layer.id, { visible: true });
	}
}

export function setGlobalH3Resolution(resolution: number | null): void {
	globalOverridesStore.update((g) => ({ ...g, h3Resolution: resolution }));
	if (resolution === null) return;
	const layers = get(layerListStore);
	for (const layer of layers) {
		if (layer.h3Resolution !== resolution) {
			updateLayer(layer.id, { h3Resolution: resolution });
			runLayerAnalysis(layer.id);
		}
	}
}

export function setGlobalMetric(metric: DataMetric | null): void {
	globalOverridesStore.update((g) => ({ ...g, metric }));
	if (metric === null) return;
	const layers = get(layerListStore);
	for (const layer of layers) {
		const scale = getMetricScale(metric, layer.metricRanges);
		updateLayer(layer.id, { metric, rangeMin: scale.min, rangeMax: scale.max });
	}
}

export function setGlobalFilePattern(pattern: string | null): void {
	globalOverridesStore.update((g) => ({ ...g, filePattern: pattern }));
	const layers = get(layerListStore);
	for (const layer of layers) {
		if (pattern === null) {
			updateLayer(layer.id, { selectedSourceFile: null });
		} else {
			const match = layer.sourceFiles.find(
				(f) => (f.split('/').pop()?.replace(/\.csv$/i, '') ?? '') === pattern
			);
			updateLayer(layer.id, { selectedSourceFile: match ?? null });
		}
		runLayerAnalysis(layer.id);
	}
}

export function setTimeSync(enabled: boolean): void {
	globalOverridesStore.update((g) => ({ ...g, timeSync: enabled }));
}

export function syncTimeToAllLayers(
	sourceLayerId: string,
	startTime: number | null,
	endTime: number | null
): void {
	const layers = get(layerListStore);
	for (const layer of layers) {
		if (layer.id === sourceLayerId) continue;
		updateLayer(layer.id, { timeStart: startTime, timeEnd: endTime });
		runLayerAnalysis(layer.id);
	}
}

export function setGlobalTime(startTime: number | null, endTime: number | null): void {
	const layers = get(layerListStore);
	for (const layer of layers) {
		updateLayer(layer.id, { timeStart: startTime, timeEnd: endTime });
		runLayerAnalysis(layer.id);
	}
}

export function resetGlobalTimeToFull(): void {
	const layers = get(layerListStore);
	for (const layer of layers) {
		if (layer.timeRange) {
			updateLayer(layer.id, { timeStart: layer.timeRange[0], timeEnd: layer.timeRange[1] });
			runLayerAnalysis(layer.id);
		}
	}
}

// ── Global animation ──────────────────────────────────────────────────────────

let globalAnimTimer: ReturnType<typeof setTimeout> | null = null;
let globalAnimating = writable(false);

export { globalAnimating };

function globalAnimStep() {
	globalAnimTimer = setTimeout(async () => {
		const globalRange = get(globalTimeRangeStore);
		if (!globalRange) { stopGlobalAnimation(); return; }

		const layers = get(layerListStore);
		const ref = layers.find((l) => l.timeStart !== null && l.timeEnd !== null);
		if (!ref || ref.timeStart === null || ref.timeEnd === null) { stopGlobalAnimation(); return; }

		const duration = ref.timeEnd - ref.timeStart;
		const step = get(playbackStepStore);

		let nextStart = ref.timeStart + step;
		let nextEnd = nextStart + duration;

		if (nextStart > globalRange[1]) {
			nextStart = globalRange[0];
			nextEnd = nextStart + duration;
		}
		if (nextEnd > globalRange[1]) nextEnd = globalRange[1];

		for (const layer of layers) {
			updateLayer(layer.id, { timeStart: nextStart, timeEnd: nextEnd });
		}
		for (const layer of layers) {
			await runLayerAnalysis(layer.id);
		}

		if (get(globalAnimating)) {
			globalAnimStep();
		}
	}, 300);
}

export function startGlobalAnimation(): void {
	if (get(globalAnimating)) return;
	globalAnimating.set(true);
	globalAnimStep();
}

export function stopGlobalAnimation(): void {
	if (globalAnimTimer) {
		clearTimeout(globalAnimTimer);
		globalAnimTimer = null;
	}
	globalAnimating.set(false);
}
