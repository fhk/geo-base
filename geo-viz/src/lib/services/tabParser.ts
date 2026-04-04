/**
 * MapInfo .TAB Raster File Parser
 *
 * Parses MapInfo TAB metadata files that georeference raster images.
 * Extracts image filename, geo <-> pixel control points, computes an
 * affine transform, and outputs quad bounds for deck.gl BitmapLayer.
 *
 * Handles:
 *   - Rotated images via affine transform → quad bounds (4 corners)
 *   - Projected CRS (UTM, Lambert) via proj4 reprojection
 *
 * MapInfo convention: geo coords are (X, Y) = (longitude/easting, latitude/northing).
 */

import proj4 from "proj4";

export interface ControlPoint {
  /** Longitude (WGS84) after reprojection */
  lng: number;
  /** Latitude (WGS84) after reprojection */
  lat: number;
  /** Raw X coordinate from .tab (may be easting in projected CRS) */
  rawX: number;
  /** Raw Y coordinate from .tab (may be northing in projected CRS) */
  rawY: number;
  pixelX: number;
  pixelY: number;
  label: string;
}

export interface TabRasterInfo {
  /** Referenced image filename (e.g. "coverage.png") */
  imageFile: string;
  /** Control points mapping geo <-> pixel coordinates (reprojected to WGS84) */
  controlPoints: ControlPoint[];
  /** Geographic bounding box in WGS84 (axis-aligned, for fly-to) */
  bounds: { north: number; south: number; east: number; west: number };
  /**
   * deck.gl BitmapLayer quad bounds:
   * [[left-bottom], [left-top], [right-top], [right-bottom]]
   * Each as [lng, lat] in WGS84. Supports rotated images.
   */
  deckBounds: [[number, number], [number, number], [number, number], [number, number]];
  /** Image dimensions inferred from control points [width, height] in pixels */
  imageSize: [number, number];
  /** Raw CoordSys line if present */
  coordSys?: string;
  /** Whether coordinates were reprojected from a projected CRS */
  wasReprojected: boolean;
  /** Human-readable CRS description */
  crsDescription: string;
  /** Whether this references a TIFF vs a browser-native image */
  isTiff: boolean;
}

/**
 * MapInfo datum codes to EPSG-style datum names.
 * Only the most common ones used by MapInfo-compatible tools.
 */
const MI_DATUMS: Record<number, string> = {
  0: "WGS84",
  33: "WGS84", // European 1950 → approximate as WGS84
  62: "NAD83",
  74: "NAD27",
  79: "WGS72",
  104: "WGS84",
  157: "WGS84", // ITRF96 ≈ WGS84
};

/**
 * Parse MapInfo CoordSys line into a proj4 definition string.
 * Returns null if the CRS is already geographic (lat/lng) or unrecognized.
 */
function coordSysToProj4(coordSys: string): { proj4Def: string; description: string } | null {
  const match = coordSys.match(
    /CoordSys\s+Earth\s+Projection\s+(\d+)\s*,\s*(\d+)(?:\s*,\s*"([^"]*)")?([^]*)?/i
  );
  if (!match) return null;

  const projType = parseInt(match[1]);
  const datumCode = parseInt(match[2]);
  const units = match[3] ?? "m";
  const paramStr = match[4] ?? "";
  const params = paramStr.match(/-?[\d.]+/g)?.map(Number) ?? [];

  if (projType === 1) return null;

  const datumName = MI_DATUMS[datumCode] ?? "WGS84";

  // Projection 8 = Transverse Mercator (UTM)
  if (projType === 8 && params.length >= 5) {
    const [centralMeridian, refLat, scaleFactor, falseEasting, falseNorthing] = params;

    let description: string;
    if (Math.abs(scaleFactor - 0.9996) < 0.0001) {
      const zone = Math.round((centralMeridian + 183) / 6);
      const hemisphere = refLat >= 0 || falseNorthing === 0 ? "N" : "S";
      description = `UTM Zone ${zone}${hemisphere} (${datumName})`;
    } else {
      description = `Transverse Mercator (${datumName})`;
    }

    const proj4Def =
      `+proj=tmerc +lat_0=${refLat} +lon_0=${centralMeridian} ` +
      `+k=${scaleFactor} +x_0=${falseEasting} +y_0=${falseNorthing} ` +
      `+datum=${datumName} +units=${units} +no_defs`;

    return { proj4Def, description };
  }

  // Projection 3 = Lambert Conformal Conic (State Plane)
  if (projType === 3 && params.length >= 6) {
    const [centralMeridian, refLat, sp1, sp2, falseEasting, falseNorthing] = params;

    const proj4Def =
      `+proj=lcc +lat_1=${sp1} +lat_2=${sp2} +lat_0=${refLat} +lon_0=${centralMeridian} ` +
      `+x_0=${falseEasting} +y_0=${falseNorthing} +datum=${datumName} +units=${units} +no_defs`;

    return { proj4Def, description: `Lambert Conformal Conic (${datumName})` };
  }

  // Projection 12 = Azimuthal Equidistant
  if (projType === 12 && params.length >= 4) {
    const [centralMeridian, refLat, falseEasting, falseNorthing] = params;

    const proj4Def =
      `+proj=aeqd +lat_0=${refLat} +lon_0=${centralMeridian} ` +
      `+x_0=${falseEasting} +y_0=${falseNorthing} +datum=${datumName} +units=${units} +no_defs`;

    return { proj4Def, description: `Azimuthal Equidistant (${datumName})` };
  }

  console.warn(
    `Unrecognized MapInfo projection type ${projType}. ` +
    `Control points will be treated as lng/lat.`
  );
  return null;
}

/**
 * Solve a 2D affine transform from pixel coordinates to geographic coordinates.
 *
 * Given 3+ control points, computes coefficients [a, b, c] such that:
 *   geo_x = a * pixelX + b * pixelY + c
 *   geo_y = d * pixelX + e * pixelY + f
 *
 * Uses the first 3 control points (exact solution for 3 points).
 */
function solveAffine(
  controlPoints: ControlPoint[]
): { transformPixel: (px: number, py: number) => [number, number] } {
  const [p0, p1, p2] = controlPoints;

  // Solve: [px py 1] * [a; b; c] = [lng] for each point
  // Matrix form: M * coeffs_lng = lngs, M * coeffs_lat = lats
  const px0 = p0.pixelX, py0 = p0.pixelY;
  const px1 = p1.pixelX, py1 = p1.pixelY;
  const px2 = p2.pixelX, py2 = p2.pixelY;

  // Determinant of the 3x3 pixel matrix
  const det = px0 * (py1 - py2) - py0 * (px1 - px2) + (px1 * py2 - px2 * py1);

  if (Math.abs(det) < 1e-10) {
    throw new Error("Control points are collinear — cannot compute affine transform");
  }

  // Inverse of the 3x3 matrix [px py 1; ...] (Cramer's rule)
  const invDet = 1 / det;

  // For lng: [a, b, c]
  const a_lng = invDet * ((py1 - py2) * p0.lng + (py2 - py0) * p1.lng + (py0 - py1) * p2.lng);
  const b_lng = invDet * ((px2 - px1) * p0.lng + (px0 - px2) * p1.lng + (px1 - px0) * p2.lng);
  const c_lng = invDet * ((px1 * py2 - px2 * py1) * p0.lng + (px2 * py0 - px0 * py2) * p1.lng + (px0 * py1 - px1 * py0) * p2.lng);

  // For lat: [d, e, f]
  const a_lat = invDet * ((py1 - py2) * p0.lat + (py2 - py0) * p1.lat + (py0 - py1) * p2.lat);
  const b_lat = invDet * ((px2 - px1) * p0.lat + (px0 - px2) * p1.lat + (px1 - px0) * p2.lat);
  const c_lat = invDet * ((px1 * py2 - px2 * py1) * p0.lat + (px2 * py0 - px0 * py2) * p1.lat + (px0 * py1 - px1 * py0) * p2.lat);

  return {
    transformPixel: (px: number, py: number): [number, number] => {
      const lng = a_lng * px + b_lng * py + c_lng;
      const lat = a_lat * px + b_lat * py + c_lat;
      return [lng, lat];
    }
  };
}

export function parseTabFile(content: string): TabRasterInfo {
  const lines = content.split("\n").map((l) => l.trim());

  // --- Extract image filename ---
  const fileMatch = content.match(/File\s+"([^"]+)"/i);
  if (!fileMatch) {
    throw new Error('No "File" directive found in .tab content');
  }
  const imageFile = fileMatch[1];

  // --- Verify RASTER type ---
  const typeLine = lines.find((l) => /^Type\s+"/i.test(l));
  if (typeLine && !/RASTER/i.test(typeLine)) {
    console.warn(`Tab file declares type "${typeLine}", expected RASTER.`);
  }

  // --- Parse CoordSys for CRS detection ---
  const coordSysLine = lines.find((l) => /^CoordSys/i.test(l));
  const crsInfo = coordSysLine ? coordSysToProj4(coordSysLine) : null;

  // --- Parse control points (raw coordinates) ---
  const cpRegex =
    /\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)\s*Label\s+"([^"]+)"/gi;

  const rawPoints: Array<{
    x: number;
    y: number;
    pixelX: number;
    pixelY: number;
    label: string;
  }> = [];
  let m: RegExpExecArray | null;
  while ((m = cpRegex.exec(content)) !== null) {
    rawPoints.push({
      x: parseFloat(m[1]),
      y: parseFloat(m[2]),
      pixelX: parseFloat(m[3]),
      pixelY: parseFloat(m[4]),
      label: m[5],
    });
  }

  if (rawPoints.length < 3) {
    throw new Error(
      `Need at least 3 control points for affine transform, found ${rawPoints.length}`
    );
  }

  // --- Reproject if needed ---
  const wasReprojected = crsInfo !== null;
  const controlPoints: ControlPoint[] = rawPoints.map((raw) => {
    let lng: number, lat: number;

    if (crsInfo) {
      [lng, lat] = proj4(crsInfo.proj4Def, "EPSG:4326", [raw.x, raw.y]);
    } else {
      lng = raw.x;
      lat = raw.y;
    }

    return {
      lng,
      lat,
      rawX: raw.x,
      rawY: raw.y,
      pixelX: raw.pixelX,
      pixelY: raw.pixelY,
      label: raw.label,
    };
  });

  // --- Infer image dimensions from control point pixel extents ---
  const maxPx = Math.max(...controlPoints.map((p) => p.pixelX));
  const maxPy = Math.max(...controlPoints.map((p) => p.pixelY));
  const imageWidth = maxPx > 0 ? maxPx : 1;
  const imageHeight = maxPy > 0 ? maxPy : 1;

  // --- Compute affine transform: pixel → geo ---
  const { transformPixel } = solveAffine(controlPoints);

  // Transform the 4 image corners to geographic coordinates
  const topLeft = transformPixel(0, 0);                    // pixel (0, 0)
  const topRight = transformPixel(imageWidth, 0);          // pixel (width, 0)
  const bottomRight = transformPixel(imageWidth, imageHeight); // pixel (width, height)
  const bottomLeft = transformPixel(0, imageHeight);       // pixel (0, height)

  // deck.gl BitmapLayer quad bounds: [[left-bottom], [left-top], [right-top], [right-bottom]]
  // "left/right" = image left/right, "top/bottom" = image top/bottom
  const deckBounds: [[number, number], [number, number], [number, number], [number, number]] = [
    bottomLeft,   // left-bottom  (pixel 0, height)
    topLeft,      // left-top     (pixel 0, 0)
    topRight,     // right-top    (pixel width, 0)
    bottomRight,  // right-bottom (pixel width, height)
  ];

  // Axis-aligned bounding box for fly-to viewport
  const allLngs = [topLeft[0], topRight[0], bottomRight[0], bottomLeft[0]];
  const allLats = [topLeft[1], topRight[1], bottomRight[1], bottomLeft[1]];
  const north = Math.max(...allLats);
  const south = Math.min(...allLats);
  const east = Math.max(...allLngs);
  const west = Math.min(...allLngs);

  // --- Detect TIFF ---
  const ext = imageFile.split(".").pop()?.toLowerCase() ?? "";
  const isTiff = ext === "tif" || ext === "tiff";

  // --- CRS description for UI ---
  let crsDescription: string;
  if (crsInfo) {
    crsDescription = crsInfo.description;
  } else if (coordSysLine) {
    crsDescription = "Geographic (Lat/Lng)";
  } else {
    crsDescription = "Assumed WGS84 (no CoordSys)";
  }

  return {
    imageFile,
    controlPoints,
    bounds: { north, south, east, west },
    deckBounds,
    imageSize: [imageWidth, imageHeight],
    coordSys: coordSysLine,
    wasReprojected,
    crsDescription,
    isTiff,
  };
}
