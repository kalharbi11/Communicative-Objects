/* global createCanvas, createGraphics, createImage, image, loadImage, noLoop, pixelDensity */

// Strategy:
// 1) Use `asset/line-drawing.png` to find line boundaries (black pixels).
// 2) Label connected regions separated by those lines.
// 3) For each region, sample average RGB from `asset/image.jpg`.
// 4) Fill the region with a dense geometric pattern using the SAME RGB.
// 5) Draw the linework on top.

const COLOR_IMAGE_PATH = 'asset/image.jpg';
const LINE_DRAWING_PATH = 'asset/line-drawing.png';

// Line extraction
const LINE_LUMA_THRESHOLD = 210; // line pixels are darker than this
const LINE_SEGMENT_DILATE = 1; // only for segmentation (helps close tiny gaps)

// Color sampling
const COLOR_SAMPLE_EXCLUDE_LINE_DILATE = 2; // ignore pixels near lines for truer region colors

// Pattern fill
const PATTERN_ALPHA = 255; // avoid muting via transparency; patterns provide texture
const MIN_SPACING = 2; // densest allowed spacing
const IGNORE_TINY_REGIONS_UNDER = 15; // allow small details (cactuses/trees/bushes)

// Coverage safety net: ensures nothing stays uncolored.
const MICRO_TEX_MIN_AREA = 20; // include small colored objects
const MICRO_TEX_MAX_STEP = 5;
const MICRO_TEX_MIN_STEP = 2;
const MICRO_TEX_PROB = 0.65; // fraction of micro-cells that get a mark

// Global color boost
const COLOR_SAT_MULT = 1.5;
const COLOR_SAT_ADD = 0.03;
const COLOR_CONTRAST_L = 1.22;

let globalSeed = 0;

let colorImg;
let lineImg;
let resizedColor;
let resizedLine;

function preload() {
  colorImg = loadImage(COLOR_IMAGE_PATH);
  lineImg = loadImage(LINE_DRAWING_PATH);
}

function setup() {
  globalSeed = (Math.random() * 0xffffffff) >>> 0;

  const targetWidth = chooseTargetWidth(colorImg.width);
  resizedColor = colorImg.get();
  resizedColor.resize(targetWidth, 0);
  resizedLine = lineImg.get();
  resizedLine.resize(targetWidth, 0);

  const w = resizedColor.width;
  const h = resizedColor.height;

  pixelDensity(1);
  const canvas = createCanvas(w, h);
  canvas.parent('canvas-holder');

  const originalEl = document.getElementById('original');
  originalEl.src = COLOR_IMAGE_PATH;
  originalEl.width = w;

  resizedColor.loadPixels();
  resizedLine.loadPixels();

  const lineMaskDraw = buildLineMask(resizedLine, w, h, LINE_LUMA_THRESHOLD);
  const lineMaskSeg = dilateMask(lineMaskDraw, w, h, LINE_SEGMENT_DILATE);

  const lineMaskExclude = dilateMask(lineMaskDraw, w, h, COLOR_SAMPLE_EXCLUDE_LINE_DILATE);

  const { regionIdMap, regionCount } = labelRegionsFromLineMask(lineMaskSeg, w, h);
  const regionStats = computeRegionStats(regionIdMap, regionCount, resizedColor, lineMaskExclude, w, h);

  const patternLayer = createGraphics(w, h);
  patternLayer.pixelDensity(1);
  drawRegionPatterns(patternLayer, regionIdMap, regionStats, w, h);

  // Draw line-drawing.png as background first
  image(resizedLine, 0, 0);
  // Then overlay colored patterns on top
  image(patternLayer, 0, 0);

  noLoop();
}

function chooseTargetWidth(originalWidth) {
  const maxW = 1200;
  const minW = 520;
  const ideal = 1020;
  return Math.max(minW, Math.min(maxW, Math.min(ideal, originalWidth)));
}

function buildLineMask(img, w, h, threshold) {
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const rgb = getPixelRGB(img, x, y);
      const luma = rgbToLuma(rgb);
      mask[i] = luma < threshold ? 1 : 0;
    }
  }
  return mask;
}

function dilateMask(mask, w, h, radius) {
  if (radius <= 0) return mask;
  let current = mask;
  for (let pass = 0; pass < radius; pass++) {
    const next = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (current[i]) {
          next[i] = 1;
          continue;
        }
        const left = x > 0 ? current[i - 1] : 0;
        const right = x + 1 < w ? current[i + 1] : 0;
        const up = y > 0 ? current[i - w] : 0;
        const down = y + 1 < h ? current[i + w] : 0;
        next[i] = left || right || up || down ? 1 : 0;
      }
    }
    current = next;
  }
  return current;
}

function labelRegionsFromLineMask(lineMask, w, h) {
  // Two-pass connected components labeling (4-neighborhood) with union-find.
  const labels = new Int32Array(w * h);
  labels.fill(0);

  const parent = [0];
  const rank = [0];
  let nextLabel = 1;

  function makeSet() {
    parent[nextLabel] = nextLabel;
    rank[nextLabel] = 0;
    return nextLabel++;
  }

  function find(a) {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  }

  function union(a, b) {
    let ra = find(a);
    let rb = find(b);
    if (ra === rb) return;
    if (rank[ra] < rank[rb]) {
      parent[ra] = rb;
    } else if (rank[ra] > rank[rb]) {
      parent[rb] = ra;
    } else {
      parent[rb] = ra;
      rank[ra]++;
    }
  }

  // First pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (lineMask[i]) continue;

      const left = x > 0 ? labels[i - 1] : 0;
      const up = y > 0 ? labels[i - w] : 0;

      if (left === 0 && up === 0) {
        labels[i] = makeSet();
      } else if (left !== 0 && up === 0) {
        labels[i] = left;
      } else if (left === 0 && up !== 0) {
        labels[i] = up;
      } else {
        labels[i] = Math.min(left, up);
        if (left !== up) union(left, up);
      }
    }
  }

  // Second pass: flatten and remap to 0..R-1
  const rootToId = new Map();
  let regionCount = 0;
  const regionIdMap = new Int32Array(w * h);
  regionIdMap.fill(-1);

  for (let i = 0; i < labels.length; i++) {
    if (lineMask[i]) {
      regionIdMap[i] = -1;
      continue;
    }
    const root = find(labels[i]);
    let id = rootToId.get(root);
    if (id === undefined) {
      id = regionCount++;
      rootToId.set(root, id);
    }
    regionIdMap[i] = id;
  }

  return { regionIdMap, regionCount };
}

function computeRegionStats(regionIdMap, regionCount, colorImg, excludeMask, w, h) {
  const sumRAll = new Float64Array(regionCount);
  const sumGAll = new Float64Array(regionCount);
  const sumBAll = new Float64Array(regionCount);
  const areaAll = new Int32Array(regionCount);

  const sumRIn = new Float64Array(regionCount);
  const sumGIn = new Float64Array(regionCount);
  const sumBIn = new Float64Array(regionCount);
  const areaIn = new Int32Array(regionCount);

  const minX = new Int32Array(regionCount);
  const minY = new Int32Array(regionCount);
  const maxX = new Int32Array(regionCount);
  const maxY = new Int32Array(regionCount);
  for (let i = 0; i < regionCount; i++) {
    minX[i] = 1e9;
    minY[i] = 1e9;
    maxX[i] = -1;
    maxY[i] = -1;
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const id = regionIdMap[i];
      if (id < 0) continue;

      const rgb = getPixelRGB(colorImg, x, y);
      sumRAll[id] += rgb[0];
      sumGAll[id] += rgb[1];
      sumBAll[id] += rgb[2];
      areaAll[id] += 1;

      if (!excludeMask || !excludeMask[i]) {
        sumRIn[id] += rgb[0];
        sumGIn[id] += rgb[1];
        sumBIn[id] += rgb[2];
        areaIn[id] += 1;
      }

      if (x < minX[id]) minX[id] = x;
      if (y < minY[id]) minY[id] = y;
      if (x > maxX[id]) maxX[id] = x;
      if (y > maxY[id]) maxY[id] = y;
    }
  }

  const stats = new Array(regionCount);
  for (let id = 0; id < regionCount; id++) {
    const nAll = Math.max(1, areaAll[id]);
    const rgbAll = [sumRAll[id] / nAll, sumGAll[id] / nAll, sumBAll[id] / nAll];

    const nIn = areaIn[id];
    // Prefer interior pixels; fall back if region is tiny or mostly boundary.
    const useInterior = nIn >= 20 && nIn >= Math.floor(areaAll[id] * 0.15);
    const rgbRaw = useInterior
      ? [sumRIn[id] / nIn, sumGIn[id] / nIn, sumBIn[id] / nIn]
      : rgbAll;
    
    const rgb = boostRgb(rgbRaw);

    stats[id] = {
      rgb,
      area: areaAll[id],
      minX: minX[id],
      minY: minY[id],
      maxX: maxX[id],
      maxY: maxY[id],
    };
  }
  return stats;
}

function drawRegionPatterns(g, regionIdMap, stats, w, h) {
  g.clear();
  g.strokeCap(g.SQUARE);
  g.strokeJoin(g.MITER);

  for (let id = 0; id < stats.length; id++) {
    const s = stats[id];
    if (!s || s.area < IGNORE_TINY_REGIONS_UNDER) continue;

    const rng = mulberry32(hash32(globalSeed, id));
    const rule = patternRuleFromColor(s.rgb, s.area, rng);

    g.push();
    g.strokeWeight(rule.strokeW);

    // Two-pass fill for large regions: offsets increase coverage without becoming flat.
    const passes = s.area > 15000 ? 2 : 1;
    for (let pass = 0; pass < passes; pass++) {
      const passJitter = pass === 0 ? 0 : Math.max(1, Math.round(rule.step * 0.35));
      drawPatternPass(g, regionIdMap, w, h, id, s, rule, rng, passJitter);
    }

    // Safety net: micro texture to prevent uncolored regions.
    if (s.area >= MICRO_TEX_MIN_AREA) {
      drawMicroTexture(g, regionIdMap, w, h, id, s, rule);
    }

    g.pop();
  }
}

function drawMicroTexture(g, regionIdMap, w, h, id, s, rule) {
  // Use a coordinate hash for fast deterministic coverage.
  const step = microStepForArea(s.area);
  const rgb = rule.rgb;
  const alpha = 255;
  const seed = hash32(globalSeed ^ 0x51ed270b, id);

  g.push();
  g.stroke(rgb[0], rgb[1], rgb[2], alpha);
  g.noFill();
  g.strokeWeight(0.8);

  for (let y = s.minY; y <= s.maxY; y += step) {
    for (let x = s.minX; x <= s.maxX; x += step) {
      const xi = clampInt(x, 0, w - 1);
      const yi = clampInt(y, 0, h - 1);
      if (regionIdMap[yi * w + xi] !== id) continue;

      const u = hash2f(seed, xi, yi);
      if (u > MICRO_TEX_PROB) continue;

      // Tiny marks to ensure visibility.
      if (rule.motif === 'blade') {
        const dx = (hash2f(seed ^ 0x9e3779b9, xi, yi) - 0.5) * 1.4;
        const dy = -1.0 - hash2f(seed ^ 0x85ebca6b, xi, yi) * 1.4;
        g.line(xi, yi, xi + dx, yi + dy);
      } else {
        g.point(xi, yi);
      }
    }
  }

  g.pop();
}

function microStepForArea(area) {
  // Big areas use coarser steps; small areas get tighter coverage.
  const t = clamp01((Math.log10(Math.max(30, area)) - 1.48) / 3.5);
  const step = Math.round(lerp(MICRO_TEX_MIN_STEP, MICRO_TEX_MAX_STEP, t));
  return Math.max(MICRO_TEX_MIN_STEP, Math.min(MICRO_TEX_MAX_STEP, step));
}

function boostRgb(rgb) {
  // Boost saturation + contrast to counteract faded look.
  const hsl = rgbToHsl01(rgb);
  const s = clamp01(hsl.s * COLOR_SAT_MULT + COLOR_SAT_ADD);
  let l = hsl.l;
  l = clamp01((l - 0.5) * COLOR_CONTRAST_L + 0.5);
  // Slight gamma boost for midtones.
  l = clamp01(lerp(l, Math.pow(l, 0.88), 0.4));
  const out = hslToRgb01(hsl.h, s, l);
  return [out[0] * 255, out[1] * 255, out[2] * 255];
}

function hslToRgb01(h, s, l) {
  if (s === 0) return [l, l, l];

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  function hue2rgb(t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }

  const r = hue2rgb(h + 1 / 3);
  const g = hue2rgb(h);
  const b = hue2rgb(h - 1 / 3);
  return [r, g, b];
}

function drawPatternPass(g, regionIdMap, w, h, id, s, rule, rng, passJitter) {
  const rgb = rule.rgb;
  const step = Math.max(MIN_SPACING, rule.step);

  if (rule.pattern === 'stripes') {
    // Stripe field across bounding box, then place motifs along stripes.
    const angle = rule.angle;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const nx = -sa;
    const ny = ca;

    const cx = (s.minX + s.maxX) * 0.5;
    const cy = (s.minY + s.maxY) * 0.5;
    const halfDiag = Math.hypot(s.maxX - s.minX, s.maxY - s.minY) * 0.6;

    const stripeSpacing = step;
    const alongStep = Math.max(MIN_SPACING, Math.round(step * 0.9));
    const nStripes = Math.floor((2 * halfDiag) / stripeSpacing) + 2;

    for (let si = -nStripes; si <= nStripes; si++) {
      const ox = cx + nx * si * stripeSpacing;
      const oy = cy + ny * si * stripeSpacing;
      for (let t = -halfDiag; t <= halfDiag; t += alongStep) {
        const jx = (rng() - 0.5) * step * rule.jitter;
        const jy = (rng() - 0.5) * step * rule.jitter;
        const x = Math.round(ox + ca * t + jx + passJitter);
        const y = Math.round(oy + sa * t + jy + passJitter);
        if (x < s.minX || x > s.maxX || y < s.minY || y > s.maxY) continue;
        if (!isMotifInsideRegion(regionIdMap, w, h, id, x, y, rule.radius)) continue;
        drawMotifAt(g, rule, x, y, rng);
      }
    }
    return;
  }

  // Default: jitter/brick grid.
  const jitterAmp = step * rule.jitter;
  for (let y0 = s.minY; y0 <= s.maxY; y0 += step) {
    const rowOffset = rule.pattern === 'brick' && ((Math.floor((y0 - s.minY) / step) + (passJitter ? 1 : 0)) % 2 === 1) ? step * 0.5 : 0;
    for (let x0 = s.minX; x0 <= s.maxX; x0 += step) {
      const x = Math.round(x0 + rowOffset + (rng() - 0.5) * jitterAmp + passJitter);
      const y = Math.round(y0 + (rng() - 0.5) * jitterAmp + passJitter);
      if (x < s.minX || x > s.maxX || y < s.minY || y > s.maxY) continue;
      if (!isMotifInsideRegion(regionIdMap, w, h, id, x, y, rule.radius)) continue;
      drawMotifAt(g, rule, x, y, rng);
    }
  }
}

// Linework is now handled by static line-drawing.png overlay (see setup)

function patternRuleFromColor(rgb, area, rng) {
  const { h, s, l } = rgbToHsl01(rgb);

  // Big regions get smaller motifs so they don't read as a flat fill.
  const bigFactor = clamp01((Math.log10(Math.max(80, area)) - 2.1) / 3.0);
  const sizeBase = lerp(7.5, 3.4, bigFactor) * lerp(0.8, 1.15, l);
  const stepBase = Math.max(MIN_SPACING, Math.round(sizeBase * 1.05));

  // Slightly vary per-region so similar hues don't look copy-pasted.
  const angle = (rng ? rng() : Math.random()) * Math.PI;
  const jitter = lerp(0.15, 0.55, clamp01(0.6 - s));

  // Default to stroke-driven motifs (no solids).
  const strokeW = Math.max(0.7, Math.min(1.6, sizeBase * 0.14));

  // Greys: stipple + hatch mix
  if (s < 0.11) {
    if (l < 0.38) {
      return { pattern: 'jitter', motif: 'stipple', rgb, size: Math.max(2.0, sizeBase * 0.55), step: Math.max(MIN_SPACING, Math.round(stepBase * 0.85)), strokeW: 0.9, jitter, angle, radius: Math.max(1.2, sizeBase * 0.45) };
    }
    return { pattern: 'stripes', motif: 'hatch', rgb, size: Math.min(8.0, sizeBase * 1.05), step: Math.max(MIN_SPACING, Math.round(stepBase * 0.95)), strokeW: 1.0, jitter: Math.max(0.10, jitter * 0.7), angle, radius: Math.max(2.0, sizeBase * 0.55) };
  }

  // Greens (grass): flow/blades, smaller + denser, never solid.
  if (h >= 0.22 && h <= 0.45) {
    const sz = Math.min(6.2, sizeBase * 0.85);
    return { pattern: 'jitter', motif: 'blade', rgb, size: sz, step: Math.max(MIN_SPACING, Math.round(Math.max(3.2, sz * 0.85))), strokeW: Math.max(0.8, sz * 0.18), jitter: Math.max(0.25, jitter), angle: -Math.PI / 2 + (rng() - 0.5) * 0.7, radius: Math.max(1.6, sz * 0.7) };
  }

  // Yellows: ring dots (outline circles) in a brick layout.
  if (h >= 0.10 && h <= 0.20) {
    const sz = Math.min(8.5, sizeBase * 1.0);
    return { pattern: 'brick', motif: 'ring', rgb, size: sz, step: Math.max(MIN_SPACING, Math.round(sz * 1.05)), strokeW: Math.max(0.9, sz * 0.12), jitter: Math.max(0.18, jitter * 0.9), angle, radius: Math.max(1.6, sz * 0.6) };
  }

  // Blues: diagonal stripes (hatching) with occasional dots.
  if (h >= 0.50 && h <= 0.72) {
    const sz = Math.min(9.0, sizeBase * 1.1);
    return { pattern: 'stripes', motif: 'hatch', rgb, size: sz, step: Math.max(MIN_SPACING, Math.round(sz * 0.75)), strokeW: Math.max(0.9, sz * 0.10), jitter: Math.max(0.08, jitter * 0.55), angle: angle + Math.PI / 5, radius: Math.max(2.0, sz * 0.65) };
  }

  // Warm hues: diamond outlines, jittered.
  if (h <= 0.09 || h >= 0.92) {
    const sz = Math.min(8.8, sizeBase * 1.05);
    return { pattern: 'jitter', motif: 'diamond', rgb, size: sz, step: Math.max(MIN_SPACING, Math.round(sz * 1.05)), strokeW: Math.max(0.9, sz * 0.12), jitter: Math.max(0.15, jitter * 0.85), angle, radius: Math.max(2.0, sz * 0.7) };
  }

  // Default: chevrons as strokes.
  return { pattern: 'jitter', motif: 'chev', rgb, size: sizeBase, step: stepBase, strokeW: strokeW, jitter: jitter, angle, radius: Math.max(2.0, sizeBase * 0.75) };
}

function drawMotifAt(g, rule, x, y, rng) {
  const rgb = rule.rgb;
  const a = PATTERN_ALPHA;
  const size = rule.size;
  const r = size * 0.5;

  g.stroke(rgb[0], rgb[1], rgb[2], a);
  g.fill(rgb[0], rgb[1], rgb[2], a);

  if (rule.motif === 'stipple') {
    g.noFill();
    const d = Math.max(1.2, size * 0.35);
    g.circle(x, y, d);
    return;
  }

  if (rule.motif === 'ring') {
    g.noFill();
    g.circle(x, y, Math.max(1.6, size));
    return;
  }

  if (rule.motif === 'hatch') {
    g.noFill();
    const angle = rule.angle;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    g.line(x - ca * r, y - sa * r, x + ca * r, y + sa * r);
    // occasional cross hatch in the same hue (still not a solid fill)
    if (rng && rng() < 0.22) {
      const a2 = angle + Math.PI / 2;
      const c2 = Math.cos(a2);
      const s2 = Math.sin(a2);
      g.line(x - c2 * r * 0.8, y - s2 * r * 0.8, x + c2 * r * 0.8, y + s2 * r * 0.8);
    }
    return;
  }

  if (rule.motif === 'blade') {
    g.noFill();
    const theta = rule.angle + (rng ? (rng() - 0.5) * 0.45 : 0);
    const ca = Math.cos(theta);
    const sa = Math.sin(theta);
    const len = Math.max(2.5, size * 1.25);
    g.line(x, y, x + ca * len, y + sa * len);
    if (rng && rng() < 0.25) {
      // small side-blade
      const theta2 = theta + (rng() - 0.5) * 0.9;
      g.line(x, y, x + Math.cos(theta2) * len * 0.65, y + Math.sin(theta2) * len * 0.65);
    }
    return;
  }

  if (rule.motif === 'diamond') {
    g.noFill();
    g.beginShape();
    g.vertex(x, y - r);
    g.vertex(x + r, y);
    g.vertex(x, y + r);
    g.vertex(x - r, y);
    g.endShape(g.CLOSE);
    return;
  }

  if (rule.motif === 'chev') {
    g.noFill();
    g.beginShape();
    g.vertex(x - r, y - r * 0.1);
    g.vertex(x, y + r);
    g.vertex(x + r, y - r * 0.1);
    g.endShape();
    return;
  }

  g.noFill();
  g.circle(x, y, size);
}

function isMotifInsideRegion(regionIdMap, w, h, id, x, y, r) {
  const xi = clampInt(x, 0, w - 1);
  const yi = clampInt(y, 0, h - 1);
  if (regionIdMap[yi * w + xi] !== id) return false;

  // Be permissive to fill thin/small regions; linework overlay hides minor bleed.
  const rr = Math.max(1, Math.min(2, Math.round(r * 0.6)));
  const samples = [
    [xi + rr, yi],
    [xi - rr, yi],
    [xi, yi + rr],
    [xi, yi - rr],
  ];

  let insideCount = 0;
  for (let k = 0; k < samples.length; k++) {
    const sx = clampInt(samples[k][0], 0, w - 1);
    const sy = clampInt(samples[k][1], 0, h - 1);
    if (regionIdMap[sy * w + sx] === id) insideCount++;
  }
  // Vote threshold: accept most placements while avoiding obvious crossings.
  return insideCount >= 2;
}

function hash32(seed, id) {
  // A simple 32-bit mix for stable per-region randomness.
  let x = (seed ^ (id + 0x9e3779b9)) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getPixelRGB(img, x, y) {
  const idx = 4 * (y * img.width + x);
  const p = img.pixels;
  return [p[idx], p[idx + 1], p[idx + 2]];
}

function rgbToLuma(rgb) {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function rgbToHsl01(rgb) {
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      default:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return { h, s, l };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function clampInt(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

function hash2f(seed, x, y) {
  // Deterministic pseudo-random in [0,1).
  let n = (seed ^ Math.imul(x + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(y + 0xc2b2ae35, 0x27d4eb2f)) >>> 0;
  n ^= n >>> 15;
  n = Math.imul(n, 0x2c1b3c6d) >>> 0;
  n ^= n >>> 12;
  n = Math.imul(n, 0x297a2d39) >>> 0;
  n ^= n >>> 15;
  return (n >>> 0) / 4294967296;
}
