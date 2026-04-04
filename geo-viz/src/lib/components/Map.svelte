<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Deck } from '@deck.gl/core';
	import { TileLayer } from '@deck.gl/geo-layers';
	import { BitmapLayer } from '@deck.gl/layers';
	import { mapStore, mapLoaded, viewStateStore } from '$lib/stores/map';
	import { layerStore } from '$lib/stores/layers';

	interface Props {
		center?: [number, number];
		zoom?: number;
		pitch?: number;
	}

	let { center = [-121.9694, 37.4033], zoom = 16, pitch = 45 }: Props = $props();

	let container: HTMLDivElement;
	let deck: Deck;

	// CARTO Positron Raster Tiles
	const createBaseMapLayer = () => new TileLayer({
		id: 'carto-basemap',
		data: [
			'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
			'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
			'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'
		],
		minZoom: 0,
		maxZoom: 20,
		tileSize: 256,
		renderSubLayers: (props: any) => {
			const {
				bbox: { west, south, east, north }
			} = props.tile;

			return new BitmapLayer(props, {
				data: null,
				image: props.data,
				bounds: [west, south, east, north]
			});
		}
	});

	onMount(() => {
		deck = new Deck({
			canvas: 'deck-canvas',
			parent: container,
			initialViewState: {
				longitude: center[0],
				latitude: center[1],
				zoom: zoom,
				pitch: pitch,
				bearing: 0,
				maxPitch: 75
			},
			controller: true,
			layers: [],
			onViewStateChange: ({ viewState }: any) => {
				viewStateStore.set({
					longitude: viewState.longitude,
					latitude: viewState.latitude,
					zoom: viewState.zoom,
					pitch: viewState.pitch,
					bearing: viewState.bearing
				});
			}
		});

		mapStore.set(deck as any);
		mapLoaded.set(true);

		// Register base map
		layerStore.register('carto-basemap', createBaseMapLayer());
	});

	// Reactively update deck.gl layers when layerStore changes
	$effect(() => {
		const layers = Object.values($layerStore);
		if (deck) {
			deck.setProps({ layers });
		}
	});

	onDestroy(() => {
		mapLoaded.set(false);
		mapStore.set(null);
		deck?.finalize();
	});
</script>

<div bind:this={container} class="w-full h-full bg-gray-900 relative">
	<canvas id="deck-canvas"></canvas>
	<div class="absolute bottom-4 left-4 text-white text-[10px] opacity-50 pointer-events-none">
		deck.gl Standalone (No Basemap)
	</div>
</div>

<style>
	:global(body) {
		margin: 0;
		padding: 0;
	}
	div {
		position: absolute;
		inset: 0;
	}
	canvas {
		width: 100%;
		height: 100%;
	}
</style>
