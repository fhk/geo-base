import { writable } from 'svelte/store';
import type { Layer } from '@deck.gl/core';

function createLayerStore() {
	const { subscribe, update, set } = writable<Record<string, Layer>>({});
	let currentLayers: Record<string, Layer> = {};
	subscribe(l => currentLayers = l);

	return {
		subscribe,
		get: (id: string) => currentLayers[id],
		register: (id: string, layer: Layer | null) => {
			update((layers) => {
				const newLayers = { ...layers };
				if (layer) {
					newLayers[id] = layer;
				} else {
					delete newLayers[id];
				}
				return newLayers;
			});
		}
	};
}

export const layerStore = createLayerStore();
