<script lang="ts">
	import { activeLayerStore } from '$lib/stores/layerList';
	import { getMetricScale } from '$lib/stores/filters';

	let metric = $derived($activeLayerStore?.metric ?? 'count');
	let metricRanges = $derived($activeLayerStore?.metricRanges ?? {});
	let scale = $derived(getMetricScale(metric, metricRanges));
	let layerName = $derived($activeLayerStore?.name ?? '');
</script>

{#if $activeLayerStore}
	<div class="bg-white rounded-lg shadow-lg p-3 w-48">
		<h4 class="text-sm font-semibold mb-1 text-gray-800">{scale.label}</h4>
		{#if layerName}
			<p class="text-[10px] text-gray-400 mb-2 truncate">{layerName}</p>
		{/if}

		<div class="flex flex-col gap-0.5">
			{#each [...scale.stops].reverse() as [value, color]}
				<div class="flex items-center gap-2">
					<div class="w-4 h-4 rounded" style="background-color: {color}"></div>
					<span class="text-xs text-gray-600">{typeof value === 'number' ? value.toFixed(2) : value}</span>
				</div>
			{/each}
		</div>
	</div>
{/if}
