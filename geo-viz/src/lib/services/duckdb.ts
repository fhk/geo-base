import * as duckdb from '@duckdb/duckdb-wasm';
import JSZip from 'jszip';
import duckdb_wasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvp_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import duckdb_wasm_eh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import eh_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';

let db: duckdb.AsyncDuckDB | null = null;
let conn: duckdb.AsyncDuckDBConnection | null = null;
let h3Loaded = false;

const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
	mvp: {
		mainModule: duckdb_wasm,
		mainWorker: mvp_worker
	},
	eh: {
		mainModule: duckdb_wasm_eh,
		mainWorker: eh_worker
	}
};

export async function initDuckDB(): Promise<duckdb.AsyncDuckDBConnection> {
	if (conn) return conn;

	const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
	const worker = new Worker(bundle.mainWorker!);
	const logger = new duckdb.ConsoleLogger();

	db = new duckdb.AsyncDuckDB(logger, worker);
	await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

	conn = await db.connect();
	return conn;
}

export async function loadH3Extension(): Promise<void> {
	if (h3Loaded) return;
	const connection = await getConnection();
	await connection.query(`INSTALL h3 FROM community; LOAD h3;`);
	h3Loaded = true;
}

export async function getConnection(): Promise<duckdb.AsyncDuckDBConnection> {
	if (!conn) return initDuckDB();
	return conn;
}

// ── Column detection ──────────────────────────────────────────────────────────

interface ColumnMapping {
	lat: string;
	lon: string;
	date: string | null;
	time: string | null;
	metrics: string[]; // all discovered numeric metric columns
}

/**
 * DuckDB numeric types that qualify as plottable metrics.
 * VARCHAR columns that happen to contain numbers are excluded
 * (read_csv_auto would have typed them as numeric if they were truly numeric).
 */
const NUMERIC_TYPES = new Set([
	'TINYINT', 'SMALLINT', 'INTEGER', 'INT', 'INT4', 'INT2', 'INT1',
	'BIGINT', 'HUGEINT', 'UBIGINT', 'UINTEGER', 'USMALLINT', 'UTINYINT',
	'FLOAT', 'FLOAT4', 'REAL', 'DOUBLE', 'FLOAT8', 'DECIMAL', 'NUMERIC'
]);

// Common lat/lon/time column name variants (lowercase for matching)
const LAT_NAMES  = new Set(['latitude', 'lat', 'y', 'lat_dd', 'latitude_deg']);
const LON_NAMES  = new Set(['longitude', 'lon', 'lng', 'x', 'lon_dd', 'longitude_deg']);
const DATE_NAMES = new Set(['system date', 'date', 'absolute time stamp date']);
const TIME_NAMES = new Set(['system time', 'time', 'absolute time stamp time', 'timestamp', 'datetime']);

function detectColumns(
	headers: string[],
	columnTypes: Map<string, string>
): ColumnMapping {
	const lowerHeaders = headers.map((h) => h.toLowerCase().trim());

	const find = (nameSet: Set<string>): string | null => {
		for (let i = 0; i < lowerHeaders.length; i++) {
			if (nameSet.has(lowerHeaders[i])) return headers[i];
		}
		return null;
	};

	const lat = find(LAT_NAMES) ?? 'Latitude';
	const lon = find(LON_NAMES) ?? 'Longitude';
	const date = find(DATE_NAMES);
	const time = find(TIME_NAMES);

	// Columns to exclude from metrics
	const excluded = new Set([
		lat.toLowerCase().trim(),
		lon.toLowerCase().trim(),
		...(date ? [date.toLowerCase().trim()] : []),
		...(time ? [time.toLowerCase().trim()] : [])
	]);

	// All numeric columns that aren't structural
	const metrics = headers.filter((h) => {
		if (excluded.has(h.toLowerCase().trim())) return false;
		const rawType = columnTypes.get(h) ?? '';
		// Normalise: strip precision/scale e.g. "DECIMAL(10,2)" → "DECIMAL"
		const baseType = rawType.toUpperCase().split('(')[0].trim();
		return NUMERIC_TYPES.has(baseType);
	});

	return { lat, lon, date, time, metrics };
}

// ── Ingest ────────────────────────────────────────────────────────────────────

export interface LayerIngestResult {
	tables: string[];
	viewName: string;
	csvCount: number;
	/** Discovered numeric metric column names (common across all files). */
	metricColumns: string[];
}

export async function ingestFilesForLayer(
	layerId: string,
	files: Array<{ name: string; buffer: Uint8Array; floorZ?: number; groupName?: string }>
): Promise<LayerIngestResult> {
	const connection = await getConnection();
	const tables: string[] = [];

	// metricColumns per table — we'll intersect them after
	const tableMetrics: string[][] = [];

	for (let i = 0; i < files.length; i++) {
		const file = files[i];
		const vfsName = `temp_${layerId}_${i}_${Date.now()}.csv`;
		const groupSlug = file.groupName
			? file.groupName.replace(/[^a-zA-Z0-9]/g, '_')
			: 'data';
		const tableName = `${layerId}_${groupSlug}_${i}`;

		await db!.registerFileBuffer(vfsName, file.buffer);

		// Inspect columns via DESCRIBE
		const describeResult = await connection.query(
			`DESCRIBE SELECT * FROM read_csv_auto('${vfsName}', header=true, sample_size=200)`
		);
		const descRows = describeResult.toArray().map((r: any) => r.toJSON());
		const headers = descRows.map((r: any) => r.column_name as string);
		const columnTypes = new Map<string, string>(
			descRows.map((r: any) => [r.column_name as string, r.column_type as string])
		);

		const mapping = detectColumns(headers, columnTypes);

		// Build timestamp expression
		let timestampExpr = 'NULL';
		if (mapping.date && mapping.time) {
			timestampExpr = `epoch(
				CAST("${mapping.date}" AS DATE) +
				CAST(regexp_replace("${mapping.time}", ':([0-9]+)$', '.\\1') AS TIME)
			)`;
		} else if (mapping.time) {
			timestampExpr = `epoch(TRY_CAST("${mapping.time}" AS TIMESTAMPTZ))`;
		}

		const floorZ = file.floorZ ?? 0;

		// Build metric column list for this file
		// Use only metrics this file actually has; fill NULL for extras later (during union)
		const metricSql = mapping.metrics
			.map((col) => `CAST("${col}" AS DOUBLE) AS "${col}"`)
			.join(',\n\t\t\t\t');

		const createTableQuery = `
			CREATE TABLE "${tableName}" AS
			SELECT
				CAST("${mapping.lat}" AS DOUBLE) AS lat,
				CAST("${mapping.lon}" AS DOUBLE) AS lon,
				'${file.name.replace(/'/g, "''")}' AS source_file,
				${timestampExpr} AS timestamp,
				CAST(${floorZ} AS DOUBLE) AS floor_z
				${metricSql ? ',\n\t\t\t\t' + metricSql : ''}
			FROM read_csv_auto('${vfsName}', header=true, ignore_errors=true)
			WHERE "${mapping.lat}" IS NOT NULL
			  AND "${mapping.lon}" IS NOT NULL
			  AND TRY_CAST("${mapping.lat}" AS DOUBLE) IS NOT NULL
			  AND TRY_CAST("${mapping.lon}" AS DOUBLE) IS NOT NULL
			  AND TRY_CAST("${mapping.lat}" AS DOUBLE) != 0.0
			  AND TRY_CAST("${mapping.lon}" AS DOUBLE) != 0.0
		`;

		await connection.query(createTableQuery);
		await db!.dropFile(vfsName);
		tables.push(tableName);
		tableMetrics.push(mapping.metrics);
	}

	// Intersection of metrics across all ingested files — ensures UNION ALL is safe
	const metricColumns = tableMetrics.reduce<string[]>((common, cols) => {
		const colSet = new Set(cols);
		return common.filter((c) => colSet.has(c));
	}, tableMetrics[0] ?? []);

	// Drop extra columns from tables that have more metrics than the common set
	// (not strictly required since union uses explicit column list, but keeps schema tidy)

	const viewName = `${layerId}_h3_view`;
	return { tables, viewName, csvCount: tables.length, metricColumns };
}

// ── Query helpers ─────────────────────────────────────────────────────────────

export async function dropLayerTables(tables: string[], viewName: string): Promise<void> {
	const connection = await getConnection();
	await connection.query(`DROP VIEW IF EXISTS "${viewName}"`).catch(() => {});
	for (const table of tables) {
		await connection.query(`DROP TABLE IF EXISTS "${table}"`).catch(() => {});
	}
}

export async function getTimeBoundsForTables(tables: string[]): Promise<[number, number] | null> {
	if (tables.length === 0) return null;
	const connection = await getConnection();
	const unionSql = tables
		.map((t) => `SELECT MIN(timestamp) AS min_t, MAX(timestamp) AS max_t FROM "${t}"`)
		.join(' UNION ALL ');
	const result = await connection.query(
		`SELECT MIN(min_t) AS min_t, MAX(max_t) AS max_t FROM (${unionSql})`
	);
	const row = result.toArray()[0];
	if (!row || row.min_t === null) return null;
	return [Number(row.min_t), Number(row.max_t)];
}

export async function getSourceFilesForTables(tables: string[]): Promise<string[]> {
	if (tables.length === 0) return [];
	const connection = await getConnection();
	const unionSql = tables.map((t) => `SELECT DISTINCT source_file FROM "${t}"`).join(' UNION ');
	const result = await connection.query(unionSql);
	return result.toArray().map((r: any) => r.source_file);
}

export async function getDataBoundsForTables(
	tables: string[]
): Promise<{ minLat: number; maxLat: number; minLon: number; maxLon: number } | null> {
	if (tables.length === 0) return null;
	const connection = await getConnection();
	const unionSql = tables
		.map(
			(t) =>
				`SELECT MIN(lat) AS min_lat, MAX(lat) AS max_lat, MIN(lon) AS min_lon, MAX(lon) AS max_lon FROM "${t}"`
		)
		.join(' UNION ALL ');
	const result = await connection.query(
		`SELECT MIN(min_lat) AS min_lat, MAX(max_lat) AS max_lat, MIN(min_lon) AS min_lon, MAX(max_lon) AS max_lon FROM (${unionSql})`
	);
	const row = result.toArray()[0];
	if (!row || row.min_lat === null) return null;
	return {
		minLat: Number(row.min_lat),
		maxLat: Number(row.max_lat),
		minLon: Number(row.min_lon),
		maxLon: Number(row.max_lon)
	};
}

/**
 * Compute MIN/MAX for each metric column across the given tables.
 * Used to auto-range the color scale for each discovered column.
 */
export async function getMetricRangesForTables(
	tables: string[],
	metricColumns: string[]
): Promise<Record<string, { min: number; max: number }>> {
	if (tables.length === 0 || metricColumns.length === 0) return {};
	const connection = await getConnection();
	const ranges: Record<string, { min: number; max: number }> = {};

	for (const col of metricColumns) {
		try {
			const unionSql = tables
				.map((t) => `SELECT MIN("${col}") AS mn, MAX("${col}") AS mx FROM "${t}"`)
				.join(' UNION ALL ');
			const result = await connection.query(
				`SELECT MIN(mn) AS mn, MAX(mx) AS mx FROM (${unionSql})`
			);
			const row = result.toArray()[0];
			if (row && row.mn !== null && row.mx !== null) {
				ranges[col] = { min: Number(row.mn), max: Number(row.mx) };
			}
		} catch {
			// column may not exist in all tables — skip
		}
	}
	return ranges;
}

// ── H3 analysis ───────────────────────────────────────────────────────────────

export async function runH3AnalysisForLayer(
	tables: string[],
	viewName: string,
	resolution: number,
	options: {
		sourceFile?: string | null;
		startTime?: number | null;
		endTime?: number | null;
		metricColumns?: string[];
	} = {}
): Promise<any> {
	if (tables.length === 0) return null;

	const connection = await getConnection();
	await loadH3Extension();

	const { metricColumns = [] } = options;

	// Build SELECT columns for the base tables — only include common metric columns
	const metricSelect = metricColumns
		.map((col) => `"${col}"`)
		.join(', ');

	const baseSelect = `lat, lon, source_file, timestamp, floor_z${metricSelect ? ', ' + metricSelect : ''}`;

	const unionSql = tables.map((t) => `SELECT ${baseSelect} FROM "${t}"`).join(' UNION ALL ');

	const createViewQuery = `
		CREATE OR REPLACE VIEW "${viewName}" AS
		SELECT
			*,
			h3_latlng_to_cell(lat, lon, CAST(${resolution} AS INTEGER)) AS h3_cell
		FROM (${unionSql})
	`;

	await connection.query(createViewQuery);

	const whereParts = ['h3_cell IS NOT NULL'];
	if (options.sourceFile) {
		whereParts.push(`source_file = '${options.sourceFile.replace(/'/g, "''")}'`);
	}
	if (options.startTime !== undefined && options.startTime !== null) {
		whereParts.push(`timestamp >= ${options.startTime}`);
	}
	if (options.endTime !== undefined && options.endTime !== null) {
		whereParts.push(`timestamp <= ${options.endTime}`);
	}

	const whereClause = `WHERE ${whereParts.join(' AND ')}`;

	// Dynamic AVG for each metric column
	const metricAggSql = metricColumns
		.map((col) => `AVG("${col}") AS "avg_${col}"`)
		.join(',\n\t\t\t');

	const aggregateQuery = `
		SELECT
			CAST(h3_h3_to_string(CAST(h3_cell AS UBIGINT)) AS VARCHAR) AS h3id,
			CAST(COUNT(*) AS INTEGER) AS count,
			ANY_VALUE(source_file) AS source_file,
			ANY_VALUE(floor_z) AS floor_z
			${metricAggSql ? ',\n\t\t\t' + metricAggSql : ''}
		FROM "${viewName}"
		${whereClause}
		GROUP BY 1
	`;

	return await connection.query(aggregateQuery);
}

// ── Remote / file helpers ─────────────────────────────────────────────────────

export async function ingestCSV(layerId: string, csvUrl: string): Promise<LayerIngestResult> {
	const response = await fetch(csvUrl);
	if (!response.ok) throw new Error(`Failed to fetch CSV: ${response.statusText}`);
	const buffer = new Uint8Array(await response.arrayBuffer());
	const fileName = csvUrl.split('/').pop() || 'unknown';
	return await ingestFilesForLayer(layerId, [{ name: fileName, buffer }]);
}

export async function ingestMultipleCSVs(
	layerId: string,
	files: Array<{ filename: string }>
): Promise<LayerIngestResult> {
	const buffers = [];
	for (const file of files) {
		const csvUrl = `/data/${file.filename}`;
		const response = await fetch(csvUrl);
		if (!response.ok) continue;
		buffers.push({
			name: file.filename,
			buffer: new Uint8Array(await response.arrayBuffer())
		});
	}
	if (buffers.length === 0) return { tables: [], viewName: '', csvCount: 0, metricColumns: [] };
	return await ingestFilesForLayer(layerId, buffers);
}

// ── ZIP support ───────────────────────────────────────────────────────────────

export interface ZipRasterFile {
	tabContent: string;
	imageBlob: Blob;
	imageFilename: string;
}

export interface ZipFolderGroup {
	folderName: string;
	floorZ: number;
	files: Array<{ name: string; buffer: Uint8Array; floorZ: number; groupName: string }>;
}

export interface ZipParseResult {
	folders: ZipFolderGroup[];
	raster: ZipRasterFile | null;
}

export interface ZipIngestResult {
	ingest: LayerIngestResult;
	raster: ZipRasterFile | null;
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'bmp', 'webp', 'tif', 'tiff']);

export async function parseZip(zipFile: File): Promise<ZipParseResult> {
	const zip = await JSZip.loadAsync(zipFile);
	const folderMap = new Map<string, ZipFolderGroup>();
	let tabContent: string | null = null;
	let tabImageRef: string | null = null;
	const imageFiles = new Map<string, JSZip.JSZipObject>();

	for (const [relativePath, file] of Object.entries(zip.files)) {
		if (file.dir) continue;
		const name = relativePath.split('/').pop()?.toLowerCase() ?? '';
		const ext = name.split('.').pop() ?? '';

		if (ext === 'csv') {
			const pathParts = relativePath.split('/');
			const folderName = pathParts.length > 1 ? pathParts[pathParts.length - 2] : '';
			const floorMatch = folderName.match(/[_\s]Floor\s+(\d+)/i);
			const floorZ = floorMatch ? parseInt(floorMatch[1], 10) * 3 : 0;

			if (!folderMap.has(folderName)) {
				folderMap.set(folderName, { folderName, floorZ, files: [] });
			}
			folderMap.get(folderName)!.files.push({
				name: relativePath,
				buffer: await file.async('uint8array'),
				floorZ,
				groupName: folderName
			});
		} else if (ext === 'tab') {
			tabContent = await file.async('string');
			const fileMatch = tabContent.match(/File\s+"([^"]+)"/i);
			if (fileMatch) tabImageRef = fileMatch[1];
		} else if (IMAGE_EXTS.has(ext)) {
			imageFiles.set(name, file);
		}
	}

	if (folderMap.size === 0) throw new Error('No valid CSV files found in the ZIP.');

	let raster: ZipRasterFile | null = null;
	if (tabContent && tabImageRef) {
		const refName = tabImageRef.toLowerCase();
		const imgEntry = imageFiles.get(refName);
		if (imgEntry) {
			const imgBuffer = await imgEntry.async('arraybuffer');
			const ext = refName.split('.').pop() ?? 'png';
			const mimeMap: Record<string, string> = {
				png: 'image/png',
				jpg: 'image/jpeg',
				jpeg: 'image/jpeg',
				bmp: 'image/bmp',
				webp: 'image/webp',
				tif: 'image/tiff',
				tiff: 'image/tiff'
			};
			const imageBlob = new Blob([imgBuffer], { type: mimeMap[ext] ?? 'image/png' });
			raster = { tabContent, imageBlob, imageFilename: tabImageRef };
		}
	}

	const folders = Array.from(folderMap.values()).sort((a, b) => a.floorZ - b.floorZ);
	return { folders, raster };
}

/** Legacy single-layer zip ingest */
export async function ingestZip(layerId: string, zipFile: File): Promise<ZipIngestResult> {
	const parsed = await parseZip(zipFile);
	const allFiles = parsed.folders.flatMap((f) => f.files);
	const ingest = await ingestFilesForLayer(layerId, allFiles);
	return { ingest, raster: parsed.raster };
}
