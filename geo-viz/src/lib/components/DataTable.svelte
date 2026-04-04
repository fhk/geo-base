<script lang="ts">
	import SvelteTable from 'svelte-table';
	import { activeLayerStore } from '$lib/stores/layerList';
	import { selectedH3Cell } from '$lib/stores/map';

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	function handleRowClick(e: MouseEvent) {
		const tr = (e.target as HTMLElement).closest('tr');
		if (!tr) return;
		const h3id = tr.querySelector('td')?.textContent?.trim();
		if (h3id) {
			selectedH3Cell.set($selectedH3Cell === h3id ? null : h3id);
		}
	}

	let layer = $derived($activeLayerStore);

	let rows = $derived.by(() => {
		const data = layer?.h3Data;
		if (!data) return [];
		if (typeof data.getChildAt === 'function') {
			return data.toArray();
		}
		return data;
	});

	let filteredData = $derived.by(() => {
		if (!layer) return [];
		const { metric, rangeMin, rangeMax } = layer;
		const metricKey = metric === 'count' ? 'count' : `avg_${metric}`;

		return rows.filter((row: any) => {
			const val = Number(row[metricKey]);
			return val >= rangeMin && val <= rangeMax;
		});
	});

	/** Build columns dynamically from discovered metric columns. */
	let columns = $derived.by(() => {
		const metricCols = layer?.availableMetrics ?? [];
		const cols = [
			{
				key: 'h3id',
				title: 'H3 Cell',
				value: (v: any) => v.h3id,
				sortable: true
			},
			...metricCols.map((col) => ({
				key: `avg_${col}`,
				title: col,
				value: (v: any) => v[`avg_${col}`],
				renderValue: (v: any) => {
					const n = Number(v[`avg_${col}`]);
					return isNaN(n) ? '' : n.toFixed(2);
				},
				sortable: true
			})),
			{
				key: 'count',
				title: 'Samples',
				value: (v: any) => v.count,
				sortable: true
			},
			{
				key: 'source_file',
				title: 'Source',
				value: (v: any) => v.source_file ?? '',
				sortable: true
			}
		];
		return cols;
	});

	let defaultSortBy = $derived(
		layer?.availableMetrics?.length
			? `avg_${layer.availableMetrics[0]}`
			: 'count'
	);
</script>

<div class="absolute bottom-0 left-0 right-0 bg-white shadow-2xl border-t border-gray-300 z-50 flex flex-col" style="max-height: 45vh">
	<div class="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200 shrink-0">
		<span class="text-sm font-semibold text-gray-700">
			{layer?.name ?? 'No Layer'} — {filteredData.length} cells
		</span>
		<button
			class="text-gray-500 hover:text-gray-800 text-lg font-bold px-2"
			onclick={onClose}
		>
			&times;
		</button>
	</div>

	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="overflow-auto flex-1" onclick={handleRowClick}>
		<SvelteTable
			{columns}
			rows={filteredData}
			sortBy={defaultSortBy}
			sortOrder={1}
			classNameTable="w-full text-xs"
			classNameThead="sticky top-0 bg-gray-100"
			classNameTh="px-3 py-2 text-left font-medium text-gray-600 cursor-pointer select-none border-b border-gray-200"
			classNameTd="px-3 py-1.5 text-gray-800 border-b border-gray-100 whitespace-nowrap"
			classNameRow="hover:bg-blue-50 cursor-pointer"
		/>
	</div>
</div>
