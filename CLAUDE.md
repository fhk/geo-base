# GeoViz — Browser-Based Geospatial Data Visualizer

GeoViz is a fully client-side SvelteKit application that loads arbitrary CSV data with lat/lon columns, aggregates it into H3 hexagonal cells using in-browser DuckDB-WASM, and renders the result as a 3D hexagon heatmap via deck.gl on a MapLibre basemap. There is no backend — all computation runs in the browser.

---

## What It Does

1. **Ingest** — User uploads CSV files (or ZIPs containing CSVs). DuckDB-WASM reads them directly in the browser.
2. **Detect** — Column names are inspected to auto-discover lat/lon, timestamp, and any numeric metric columns.
3. **Aggregate** — Data is spatially binned into H3 hexagons at a chosen resolution (default 12, ~11m edge). AVG is computed for each discovered metric; COUNT is always available.
4. **Color** — Each metric auto-ranges its color scale (red → yellow → green) from actual MIN/MAX values in the data.
5. **Render** — Hexagons are rendered as 3D extruded columns via deck.gl `PointCloudLayer`. Height is user-controlled.
6. **Filter** — Per-layer controls: time slider, source file picker, H3 resolution, opacity, metric selector, value range.
7. **Compare** — Multiple layers can be loaded simultaneously and toggled independently.
8. **Raster overlay** — ZIPs may contain a MapInfo `.TAB` + image file; GeoViz parses the georeferencing and overlays it via `BitmapLayer`.

---

## Tech Stack

| Layer | Library | Version |
|---|---|---|
| Framework | SvelteKit 2 + Svelte 5 (runes) | `^2.16 / ^5.19` |
| In-browser SQL | DuckDB-WASM | `^1.29` |
| H3 spatial indexing | h3-js | `^4.2.1` |
| 3D rendering | deck.gl (PointCloudLayer, BitmapLayer) | `^9.2` |
| Basemap | MapLibre GL | `^5.1` |
| CRS reprojection | proj4 | `^2.20` |
| ZIP extraction | JSZip | `^3.10` |
| Styling | Tailwind CSS | `^3.4` |
| Build | Vite 6 + adapter-static | `^6.0` |

DuckDB runs in a Web Worker using the `eh` (exception handling) WASM bundle where available, falling back to `mvp`. The H3 community extension (~3.2MB) is loaded on demand via `INSTALL h3 FROM community; LOAD h3`.

---

## Project Structure

```
src/
  routes/
    +page.svelte          # Landing page (marketing / upload entry point)
    app/
      +page.svelte        # Main map application shell
  lib/
    services/
      duckdb.ts           # All DuckDB-WASM logic (init, ingest, analysis, ZIP)
      tabParser.ts        # MapInfo .TAB raster georeferencing parser
    stores/
      filters.ts          # MetricScale type, color scale generation
      layerList.ts        # LayerState, all layer CRUD, animation, global overrides
      layers.ts           # deck.gl layer registry (BitmapLayer for rasters)
      map.ts              # deck.gl Deck instance ref, viewState, selectedH3Cell
    components/
      DataLoader.svelte   # CSV + ZIP upload UI, calls ingest pipeline
      AnalysisPanel.svelte # Left sidebar: layer list, per-layer controls
      H3Layer.svelte      # Converts h3Data Arrow result → PointCloudLayer
      Legend.svelte       # Color scale legend bar
      DataTable.svelte    # Sortable hex cell data table
      Map.svelte          # deck.gl + MapLibre GL canvas setup
    data-manifest.ts      # (vestigial) Demo file list interface
```

---

## Data Pipeline

### 1. Ingest (`duckdb.ts → ingestFilesForLayer`)

```
User File(s)
    │
    ▼
db.registerFileBuffer(vfsName, buffer)          # load into DuckDB VFS
    │
    ▼
DESCRIBE SELECT * FROM read_csv_auto(...)       # get column names + types
    │
    ▼
detectColumns(headers, columnTypes)             # find lat/lon/time/metrics
    │
    ▼
CREATE TABLE layerId_groupName_i AS SELECT ...  # normalised table: lat, lon,
                                                # source_file, timestamp,
                                                # floor_z, <metrics...>
    │
    ▼
intersect metricColumns across all files        # only common columns survive
    │
    ▼
LayerIngestResult { tables[], viewName, metricColumns[] }
```

Column detection rules:
- **Lat** — matches: `latitude`, `lat`, `y`, `lat_dd`, `latitude_deg`
- **Lon** — matches: `longitude`, `lon`, `lng`, `x`, `lon_dd`, `longitude_deg`
- **Time** — matches: `timestamp`, `datetime`, `time`, `system time`, etc.
- **Metrics** — all remaining numeric columns (`INTEGER`, `FLOAT`, `DOUBLE`, `DECIMAL`, etc.)

Rows with null/zero lat or lon are filtered at ingest time.

### 2. Metric Ranging (`duckdb.ts → getMetricRangesForTables`)

After ingest, `MIN`/`MAX` is queried per discovered metric column and stored in `layer.metricRanges`. This drives auto-ranged color scales without hard-coded domain knowledge.

### 3. H3 Analysis (`duckdb.ts → runH3AnalysisForLayer`)

```sql
-- Creates a view with h3_cell computed at target resolution
CREATE OR REPLACE VIEW layerId_h3_view AS
SELECT *, h3_latlng_to_cell(lat, lon, 12) AS h3_cell
FROM (SELECT ... FROM table1 UNION ALL SELECT ... FROM table2)

-- Aggregates into per-hex statistics
SELECT
    CAST(h3_h3_to_string(CAST(h3_cell AS UBIGINT)) AS VARCHAR) AS h3id,
    COUNT(*) AS count,
    AVG("metric_a") AS "avg_metric_a",
    AVG("metric_b") AS "avg_metric_b",
    ...
FROM layerId_h3_view
WHERE h3_cell IS NOT NULL
  [AND source_file = '...']
  [AND timestamp BETWEEN start AND end]
GROUP BY 1
```

Result is an Arrow table stored as `layer.h3Data`.

### 4. Rendering (`H3Layer.svelte`)

```
layer.h3Data (Arrow table)
    │
    ▼
toArray().map(r => r.toJSON())                  # Arrow → JS objects
    │
    ▼
cellToLatLng(h3id) → [lat, lng]                 # h3-js: hex centroid
    │
    ▼
PointCloudLayer {                               # deck.gl GPU rendering
    data: points,
    getPosition: [lng, lat, zHeight],
    getColor: interpolate(value, metricScale.stops),
    pointSize: h3PointSizeMap[resolution],      # pixel size per resolution
}
```

Point size is resolution-dependent: resolution 8 → 230px, resolution 12 → 4px, resolution 13 → 1px. This makes hexagons appear to fill space regardless of zoom level.

---

## Layer State (`layerList.ts → LayerState`)

Each layer is an object in `layerListStore`:

```typescript
interface LayerState {
  id: string;               // 'layer-0', 'layer-1', ...
  name: string;             // from filename
  visible: boolean;
  opacity: number;          // 0–1
  metric: string;           // selected metric column or 'count'
  rangeMin / rangeMax;      // color scale clamp values
  h3Resolution: number;     // 8–15, default 12
  availableMetrics: string[]; // discovered numeric columns
  metricRanges: Record<string, {min, max}>; // per-column data range
  duckdbTables: string[];   // DuckDB table names for this layer
  duckdbView: string;       // DuckDB view name (h3_cell computed here)
  timeRange: [number, number] | null; // full epoch range in data
  timeStart / timeEnd;      // current filter window (epoch seconds)
  isAnimating: boolean;
  h3Data: Arrow table | null; // last query result
  cellCount: number;
  rasterOverlay: RasterOverlay | null; // optional .TAB image overlay
  sourceFiles: string[];    // distinct CSV filenames in this layer
  selectedSourceFile: string | null; // active filter
}
```

`runLayerAnalysis(layerId)` re-runs the H3 query whenever any filter changes. It uses a version counter to discard stale results if a newer analysis is triggered before the previous one completes.

---

## Global Overrides

The `AnalysisPanel` exposes global controls that apply simultaneously to all layers:

- **H3 Resolution** — sets all layers to the same hex size and re-runs analysis
- **Metric** — switches all layers to the same column
- **Source file pattern** — filters all layers by matching filename
- **Time sync** — when enabled, animating one layer advances all layers in lockstep
- **Global animation** — single play/pause controls time across all layers

---

## Color Scale System (`filters.ts`)

```typescript
// For any user metric column:
generateMetricScale(colName, min, max)
// → 6-stop diverging ramp: red → yellow → green
// stops are linearly distributed over [min, max]

// For count:
countScale  // fixed viridis-like ramp: purple → green → yellow

// Resolution:
getMetricScale(metric, metricRanges)
// → returns countScale for 'count', else generates from stored ranges
```

---

## ZIP Support

ZIPs are parsed by `parseZip()` in `duckdb.ts`:

- CSVs are grouped by their containing folder name (each folder becomes a separate layer)
- Folders named `*_Floor N` have `floor_z = N * 3` (metres) applied
- A `.TAB` file + matching image at ZIP root is parsed as a raster overlay
- If only one folder is found, all CSVs merge into a single layer

---

## Raster Overlay (`tabParser.ts`)

MapInfo `.TAB` files georeference raster images via control points. The parser:

1. Detects CRS from `CoordSys` line (supports UTM, Lambert, Azimuthal Equidistant via proj4)
2. Reprojects control points to WGS84 if needed
3. Solves a 2D affine transform (pixel → geo) from ≥3 control points
4. Derives 4-corner quad bounds for deck.gl `BitmapLayer`

---

## Key Design Decisions

- **No backend** — everything runs client-side. DuckDB-WASM handles all SQL. No server, no API.
- **Generic columns** — no domain-specific column names are assumed. Any numeric columns become metrics.
- **Arrow result format** — DuckDB returns Apache Arrow tables; `H3Layer` reads them directly to avoid JSON serialisation overhead.
- **Svelte 5 runes** — uses `$state`, `$derived`, `$effect` throughout. No legacy `$:` reactive statements.
- **Version-stamped analysis** — each `runLayerAnalysis` call increments a counter; stale completions are silently dropped.
- **Static adapter** — builds to a `build/` directory of static files. Can be hosted on Netlify, Vercel, S3, or any CDN.

---

## Development

```bash
# Bootstrap (from /workspace)
bash BOOT.sh

# Or manually:
npm install           # from geo-viz/
npm run dev           # dev server at http://localhost:5173
npm run build         # production build → build/
npm run preview       # preview production build
```
