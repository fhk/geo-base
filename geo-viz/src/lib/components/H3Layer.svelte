<script lang="ts">
	import { onDestroy } from 'svelte';
	import { PointCloudLayer } from '@deck.gl/layers';
	import { cellToLatLng } from 'h3-js';
	import { mapStore, selectedH3Cell } from '$lib/stores/map';
	import { layerStore } from '$lib/stores/layers';
	import type { MetricScale } from '$lib/stores/filters';
	import { selectLayer } from '$lib/stores/layerList';

	interface Props {
		layerId: string;
		layerName: string;
		data: any;
		visible?: boolean;
		zHeight?: number;
		opacity?: number;
		metric?: string;
		metricScale?: MetricScale;
		rangeMin?: number;
		rangeMax?: number;
		h3Resolution?: number;
		pointSize?: number;
	}

	let {
		layerId,
		layerName,
		data,
		visible = true,
		zHeight = 0,
		opacity = 0.7,
		metric = 'count',
		metricScale,
		rangeMin = 0,
		rangeMax = 1000,
		h3Resolution = 12,
		pointSize = 3
	}: Props = $props();

	const deckLayerId = `h3-layer-${layerId}`;

	function hexToRgb(hex: string): [number, number, number] {
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		return [r, g, b];
	}

	function getColor(value: number, scale: MetricScale | undefined): [number, number, number] {
		if (!scale) return [128, 128, 128];
		const { stops } = scale;

		if (value <= stops[0][0]) return hexToRgb(stops[0][1]);
		if (value >= stops[stops.length - 1][0]) return hexToRgb(stops[stops.length - 1][1]);

		for (let i = 0; i < stops.length - 1; i++) {
			const [v1, c1] = stops[i];
			const [v2, c2] = stops[i + 1];
			if (value >= v1 && value <= v2) {
				const t = (value - v1) / (v2 - v1);
				const rgb1 = hexToRgb(c1);
				const rgb2 = hexToRgb(c2);
				return [
					Math.round(rgb1[0] + (rgb2[0] - rgb1[0]) * t),
					Math.round(rgb1[1] + (rgb2[1] - rgb1[1]) * t),
					Math.round(rgb1[2] + (rgb2[2] - rgb1[2]) * t)
				];
			}
		}
		return [128, 128, 128];
	}

	function updateLayers() {
		if (!data || typeof data.getChildAt !== 'function') return;

		// Column name in aggregated Arrow result:
		// 'count' → 'count'
		// anything else → 'avg_<metric>'
		const propName = metric === 'count' ? 'count' : `avg_${metric}`;

		const numRows = data.numRows;
		const h3Column = data.getChild('h3id');
		const metricColumn = data.getChild(propName);
		const countColumn = data.getChild('count');
		const sourceColumn = data.getChild('source_file');
		const floorZColumn = data.getChild('floor_z');

		if (!h3Column || !metricColumn) return;

		const layerData = [];
		for (let i = 0; i < numRows; i++) {
			const val = metricColumn.get(i);
			const h3id = h3Column.get(i);
			const count = countColumn ? Number(countColumn.get(i)) : 1;
			const source = sourceColumn ? sourceColumn.get(i) : null;
			const floorZ = floorZColumn ? Number(floorZColumn.get(i)) : 0;

			if (h3id && val !== null && val >= rangeMin && val <= rangeMax) {
				try {
					const [lat, lng] = cellToLatLng(h3id);
					layerData.push({
						hex: h3id,
						position: [lng, lat, zHeight + floorZ],
						value: val,
						count,
						source_file: source,
						_layerId: layerId,
						_layerName: layerName
					});
				} catch {
					// skip invalid cell
				}
			}
		}

		const selected = $selectedH3Cell;
		const alpha = Math.round(opacity * 255);

		const layer = new PointCloudLayer({
			id: deckLayerId,
			data: layerData,
			pickable: true,
			getPosition: (d: any) => d.position,
			getColor: (d: any) => {
				if (selected && d.hex === selected) return [255, 255, 255, 255];
				const rgb = getColor(d.value, metricScale);
				return [rgb[0], rgb[1], rgb[2], alpha];
			},
			getNormal: [0, 0, 1],
			pointSize,
			sizeUnits: 'meters',
			updateTriggers: {
				getPosition: [zHeight],
				getColor: [metric, metricScale, selected, opacity]
			},
			onClick: (info: any) => {
				if (info.object) {
					selectLayer(info.object._layerId);
					selectedH3Cell.set(info.object.hex);
				}
			}
		});

		layerStore.register(deckLayerId, layer);

		const deck = $mapStore;
		if (deck) {
			deck.setProps({
				getTooltip: ({ object }: any) => object && {
					html: `
						<div style="font-family:monospace;font-size:12px;padding:8px;background:white;color:black;border-radius:4px;box-shadow:0 2px 4px rgba(0,0,0,0.2)">
							<div style="font-weight:bold;border-bottom:1px solid #eee;margin-bottom:4px">${object._layerName ?? 'Layer'}</div>
							<div style="font-size:10px;color:#666;margin-bottom:4px">H3: ${object.hex}</div>
							<div style="display:flex;justify-content:space-between;gap:12px">
								<span>${metric.toUpperCase()}:</span>
								<span style="font-weight:bold">${typeof object.value === 'number' ? object.value.toFixed(2) : object.value}</span>
							</div>
							<div style="display:flex;justify-content:space-between;gap:12px">
								<span>Samples:</span>
								<span style="font-weight:bold">${object.count}</span>
							</div>
						</div>
					`
				}
			});
		}
	}

	$effect(() => {
		const _selected = $selectedH3Cell;
		const _z = zHeight;
		const _ps = pointSize;
		const _o = opacity;
		const _m = metric;
		const _ms = metricScale;
		const _rmin = rangeMin;
		const _rmax = rangeMax;
		if (!visible) {
			layerStore.register(deckLayerId, null);
			return;
		}
		if (data) {
			updateLayers();
		}
	});

	onDestroy(() => {
		layerStore.register(deckLayerId, null);
	});
</script>
