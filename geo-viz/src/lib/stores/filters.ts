export type DataMetric = string;

export interface MetricScale {
	stops: [number, string][];
	label: string;
	min: number;
	max: number;
}

// Default diverging palette: red → yellow → green
const DEFAULT_PALETTE = ['#d73027', '#fc8d59', '#fee08b', '#d9ef8b', '#91cf60', '#1a9850'];

/** Generate a linear color scale for any numeric column given its data range. */
export function generateMetricScale(colName: string, min: number, max: number): MetricScale {
	const range = max === min ? 1 : max - min;
	const stops: [number, string][] = DEFAULT_PALETTE.map((color, i) => [
		min + (i / (DEFAULT_PALETTE.length - 1)) * range,
		color
	]);
	return { stops, label: colName, min, max };
}

/** Fixed viridis-like scale for sample count. */
export const countScale: MetricScale = {
	stops: [
		[1, '#440154'],
		[10, '#3b528b'],
		[100, '#21908d'],
		[500, '#5dc963'],
		[2000, '#fde725']
	],
	label: 'Sample Count',
	min: 0,
	max: 10000
};

/**
 * Resolve the display scale for a metric.
 * Falls back to a generated scale using the provided data ranges.
 */
export function getMetricScale(
	metric: string,
	metricRanges?: Record<string, { min: number; max: number }>
): MetricScale {
	if (metric === 'count') return countScale;
	const range = metricRanges?.[metric];
	if (range) return generateMetricScale(metric, range.min, range.max);
	return generateMetricScale(metric, 0, 100);
}
