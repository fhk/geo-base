import { writable, type Writable } from 'svelte/store';

export const mapStore: Writable<any | null> = writable(null);
export const mapLoaded: Writable<boolean> = writable(false);
export const selectedH3Cell: Writable<string | null> = writable(null);

export interface ViewState {
	longitude: number;
	latitude: number;
	zoom: number;
	pitch: number;
	bearing: number;
}

export const viewStateStore: Writable<ViewState> = writable({
	longitude: -121.9694,
	latitude: 37.4033,
	zoom: 16,
	pitch: 45,
	bearing: 0
});
