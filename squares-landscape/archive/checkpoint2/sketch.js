/* global createCanvas, createGraphics, createImage, image, loadImage, pixelDensity */

// Hover-reveal coloring book strategy:
// 1) Load line-drawing.png and image.jpg
// 2) Segment into regions using line boundaries  
// 3) Sample colors and assign motifs per region
// 4) In draw loop: show background + only the hovered region's pattern

const COLOR_IMAGE_PATH = 'asset/image.jpg';
const LINE_DRAWING_PATH = 'asset/line-drawing.png';
const GROUP_REF_IMAGE_PATH = 'asset/full-color.png';

// Line extraction
const LINE_LUMA_THRESHOLD = 210;
const LINE_SEGMENT_DILATE = 1;

// Color sampling
const COLOR_SAMPLE_EXCLUDE_LINE_DILATE = 2;

// Pattern fill
const PATTERN_ALPHA = 255;
const MIN_SPACING = 2;
const IGNORE_TINY_REGIONS_UNDER = 15;

// Micro texture
const MICRO_TEX_MIN_AREA = 20;
const MICRO_TEX_MAX_STEP = 5;
const MICRO_TEX_MIN_STEP = 2;
const MICRO_TEX_PROB = 0.65;

// Color boost
const COLOR_SAT_MULT = 1.5;
const COLOR_SAT_ADD = 0.03;
const COLOR_CONTRAST_L = 1.22;

let globalSeed = 0;
let colorImg, lineImg, groupRefImg, resizedColor, resizedLine, resizedGroupRef;
let regionIdMap, regionStats, regionGroupId, groupMembers, w, h;
let canvasRef;

function preload() {
  colorImg = loadImage(COLOR_IMAGE_PATH);
  lineImg = loadImage(LINE_DRAWING_PATH);
  groupRefImg = loadImage(GROUP_REF_IMAGE_PATH);
}

function setup() {
  globalSeed = (Math.random() * 0xffffffff) >>> 0;

  const targetWidth = chooseTargetWidth(colorImg.width);
  resizedColor = colorImg.get();
  resizedColor.resize(targetWidth, 0);
  resizedLine = lineImg.get();
  resizedLine.resize(targetWidth, 0);
  resizedGroupRef = groupRefImg.get();
  resizedGroupRef.resize(targetWidth, 0);

  w = resizedColor.width;
  h = resizedColor.height;

  pixelDensity(1);
  canvasRef = createCanvas(w, h);
  canvasRef.parent('canvas-holder');

  const originalEl = document.getElementById('original');
  originalEl.src = COLOR_IMAGE_PATH;
  originalEl.width = w;

  resizedColor.loadPixels();
  resizedLine.loadPixels();
  resizedGroupRef.loadPixels();

  const lineMask = buildLineMask(resizedLine, w, h, LINE_LUMA_THRESHOLD);
  const lineMaskSeg = dilateMask(lineMask, w, h, LINE_SEGMENT_DILATE);
  const lineMaskExclude = dilateMask(lineMask, w, h, COLOR_SAMPLE_EXCLUDE_LINE_DILATE);

  const result = labelRegionsFromLineMask(lineMaskSeg, w, h);
  regionIdMap = result.regionIdMap;
  regionStats = computeRegionStats(regionIdMap, result.regionCount, resizedColor, lineMaskExclude, w, h);

  // Group regions by their boosted RGB color (same as used for pattern motifs)
  const groupResult = buildRegionGroups(regionStats, 18, 100);
  regionGroupId = groupResult.regionGroupId;
  groupMembers = groupResult.groupMembers;
}

function draw() {
  // Clear and draw line-drawing background
  image(resizedLine, 0, 0);
  
  // Find which region is under the mouse
  const regionId = getRegionAtMouse();
  
  // Draw pattern only for the hovered region
  if (regionId >= 0 && regionId < regionStats.length) {
    const groupId = regionGroupId ? regionGroupId[regionId] : regionId;
    if (groupMembers && groupMembers[groupId]) {
      const members = groupMembers[groupId];
      for (let i = 0; i < members.length; i++) {
        drawRegionPattern(members[i]);
      }
    } else {
      drawRegionPattern(regionId);
    }
  }
}

function getRegionAtMouse() {
  if (mouseX < 0 || mouseX >= w || mouseY < 0 || mouseY >= h) return -1;
  const idx = Math.floor(mouseY) * w + Math.floor(mouseX);
  return regionIdMap[idx];
}

function drawRegionPattern(regionId) {
  const s = regionStats[regionId];
  if (!s || s.area < IGNORE_TINY_REGIONS_UNDER) return;

  const rng = mulberry32(hash32(globalSeed, regionId));
  const rule = patternRuleFromColor(s.rgb, s.area, rng);

  strokeWeight(rule.strokeW);

  // Two passes for large regions
  const passes = s.area > 15000 ? 2 : 1;
  for (let pass = 0; pass < passes; pass++) {
    const passJitter = pass === 0 ? 0 : Math.max(1, Math.round(rule.step * 0.35));
    drawPatternPass(regionId, s, rule, rng, passJitter);
  }

  // Micro texture safety
  if (s.area >= MICRO_TEX_MIN_AREA) {
    drawMicroTextureRegion(regionId, s, rule);
  }
}

function drawPatternPass(regionId, s, rule, rng, passJitter) {
  const step = Math.max(MIN_SPACING, rule.step);

  if (rule.pattern === 'stripes') {
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
        if (!isMotifInsideRegion(regionId, x, y, rule.radius)) continue;
        drawMotif(rule, x, y, rng);
      }
    }
    return;
  }

  // Jitter/brick grid
  const jitterAmp = step * rule.jitter;
  for (let y0 = s.minY; y0 <= s.maxY; y0 += step) {
    const rowOffset = rule.pattern === 'brick' && ((Math.floor((y0 - s.minY) / step) + (passJitter ? 1 : 0)) % 2 === 1) ? step * 0.5 : 0;
    for (let x0 = s.minX; x0 <= s.maxX; x0 += step) {
      const x = Math.round(x0 + rowOffset + (rng() - 0.5) * jitterAmp + passJitter);
      const y = Math.round(y0 + (rng() - 0.5) * jitterAmp + passJitter);
      if (x < s.minX || x > s.maxX || y < s.minY || y > s.maxY) continue;
      if (!isMotifInsideRegion(regionId, x, y, rule.radius)) continue;
      drawMotif(rule, x, y, rng);
    }
  }
}

function drawMicroTextureRegion(regionId, s, rule) {
  const step = microStepForArea(s.area);
  const rgb = rule.rgb;
  const seed = hash32(globalSeed ^ 0x51ed270b, regionId);

  stroke(rgb[0], rgb[1], rgb[2], 255);
  noFill();
  strokeWeight(0.8);

  for (let y = s.minY; y <= s.maxY; y += step) {
    for (let x = s.minX; x <= s.maxX; x += step) {
      const xi = clampInt(x, 0, w - 1);
      const yi = clampInt(y, 0, h - 1);
      if (regionIdMap[yi * w + xi] !== regionId) continue;

      const u = hash2f(seed, xi, yi);
      if (u > MICRO_TEX_PROB) continue;

      if (rule.motif === 'blade') {
        const dx = (hash2f(seed ^ 0x9e3779b9, xi, yi) - 0.5) * 1.4;
        const dy = -1.0 - hash2f(seed ^ 0x85ebca6b, xi, yi) * 1.4;
        line(xi, yi, xi + dx, yi + dy);
      } else {
        point(xi, yi);
      }
    }
  }
}

function drawMotif(rule, x, y, rng) {
  const rgb = rule.rgb;
  const size = rule.size;
  const r = size * 0.5;

  stroke(rgb[0], rgb[1], rgb[2], PATTERN_ALPHA);
  fill(rgb[0], rgb[1], rgb[2], PATTERN_ALPHA);

  if (rule.motif === 'stipple') {
    noFill();
    circle(x, y, Math.max(1.2, size * 0.35));
    return;
  }

  if (rule.motif === 'ring') {
    noFill();
    circle(x, y, Math.max(1.6, size));
    return;
  }

  if (rule.motif === 'hatch') {
    noFill();
    const angle = rule.angle;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    line(x - ca * r, y - sa * r, x + ca * r, y + sa * r);
    if (rng && rng() < 0.22) {
      const a2 = angle + Math.PI / 2;
      const c2 = Math.cos(a2);
      const s2 = Math.sin(a2);
      line(x - c2 * r * 0.8, y - s2 * r * 0.8, x + c2 * r * 0.8, y + s2 * r * 0.8);
    }
    return;
  }

  if (rule.motif === 'blade') {
    noFill();
    const theta = rule.angle + (rng ? (rng() - 0.5) * 0.45 : 0);
    const ca = Math.cos(theta);
    const sa = Math.sin(theta);
    const len = Math.max(2.5, size * 1.25);
    line(x, y, x + ca * len, y + sa * len);
    if (rng && rng() < 0.25) {
      const theta2 = theta + (rng() - 0.5) * 0.9;
      line(x, y, x + Math.cos(theta2) * len * 0.65, y + Math.sin(theta2) * len * 0.65);
    }
    return;
  }

  if (rule.motif === 'diamond') {
    noFill();
    beginShape();
    vertex(x, y - r);
    vertex(x + r, y);
    vertex(x, y + r);
    vertex(x - r, y);
    endShape(CLOSE);
    return;
  }

  if (rule.motif === 'chev') {
    noFill();
    beginShape();
    vertex(x - r, y - r * 0.1);
    vertex(x, y + r);
    vertex(x + r, y - r * 0.1);
    endShape();
    return;
  }

  noFill();
  circle(x, y, size);
}

function isMotifInsideRegion(regionId, x, y, r) {
  const xi = clampInt(x, 0, w - 1);
  const yi = clampInt(y, 0, h - 1);
  if (regionIdMap[yi * w + xi] !== regionId) return false;

  const rr = Math.max(1, Math.min(2, Math.round(r * 0.6)));
  const samples = [[xi + rr, yi], [xi - rr, yi], [xi, yi + rr], [xi, yi - rr]];

  let insideCount = 0;
  for (let k = 0; k < samples.length; k++) {
    const sx = clampInt(samples[k][0], 0, w - 1);
    const sy = clampInt(samples[k][1], 0, h - 1);
    if (regionIdMap[sy * w + sx] === regionId) insideCount++;
  }
  return insideCount >= 2;
}

function patternRuleFromColor(rgb, area, rng) {
  const { h, s, l } = rgbToHsl01(rgb);
  const bigFactor = clamp01((Math.log10(Math.max(80, area)) - 2.1) / 3.0);
  const sizeBase = lerp(7.5, 3.4, bigFactor) * lerp(0.8, 1.15, l);
  const stepBase = Math.max(MIN_SPACING, Math.round(sizeBase * 1.05));
  const angle = (rng ? rng() : Math.random()) * Math.PI;
  const jitter = lerp(0.15, 0.55, clamp01(0.6 - s));
  const strokeW = Math.max(0.7, Math.min(1.6, sizeBase * 0.14));

  if (s < 0.11) {
    if (l < 0.38) {
      return { pattern: 'jitter', motif: 'stipple', rgb, size: Math.max(2.0, sizeBase * 0.55), step: Math.max(MIN_SPACING, Math.round(stepBase * 0.85)), strokeW: 0.9, jitter, angle, radius: Math.max(1.2, sizeBase * 0.45) };
    }
    return { pattern: 'stripes', motif: 'hatch', rgb, size: Math.min(8.0, sizeBase * 1.05), step: Math.max(MIN_SPACING, Math.round(stepBase * 0.95)), strokeW: 1.0, jitter: Math.max(0.10, jitter * 0.7), angle, radius: Math.max(2.0, sizeBase * 0.55) };
  }

  if (h >= 0.22 && h <= 0.45) {
    const sz = Math.min(6.2, sizeBase * 0.85);
    return { pattern: 'jitter', motif: 'blade', rgb, size: sz, step: Math.max(MIN_SPACING, Math.round(Math.max(3.2, sz * 0.85))), strokeW: Math.max(0.8, sz * 0.18), jitter: Math.max(0.25, jitter), angle: -Math.PI / 2 + (rng() - 0.5) * 0.7, radius: Math.max(1.6, sz * 0.7) };
  }

  if (h >= 0.10 && h <= 0.20) {
    const sz = Math.min(8.5, sizeBase * 1.0);
    return { pattern: 'brick', motif: 'ring', rgb, size: sz, step: Math.max(MIN_SPACING, Math.round(sz * 1.05)), strokeW: Math.max(0.9, sz * 0.12), jitter: Math.max(0.18, jitter * 0.9), angle, radius: Math.max(1.6, sz * 0.6) };
  }

  if (h >= 0.50 && h <= 0.72) {
    const sz = Math.min(9.0, sizeBase * 1.1);
    return { pattern: 'stripes', motif: 'hatch', rgb, size: sz, step: Math.max(MIN_SPACING, Math.round(sz * 0.75)), strokeW: Math.max(0.9, sz * 0.10), jitter: Math.max(0.08, jitter * 0.55), angle: angle + Math.PI / 5, radius: Math.max(2.0, sz * 0.65) };
  }

  if (h <= 0.09 || h >= 0.92) {
    const sz = Math.min(8.8, sizeBase * 1.05);
    return { pattern: 'jitter', motif: 'diamond', rgb, size: sz, step: Math.max(MIN_SPACING, Math.round(sz * 1.05)), strokeW: Math.max(0.9, sz * 0.12), jitter: Math.max(0.15, jitter * 0.85), angle, radius: Math.max(2.0, sz * 0.7) };
  }

  return { pattern: 'jitter', motif: 'chev', rgb, size: sizeBase, step: stepBase, strokeW, jitter, angle, radius: Math.max(2.0, sizeBase * 0.75) };
}

function chooseTargetWidth(originalWidth) {
  return Math.max(520, Math.min(1200, Math.min(1020, originalWidth)));
}

function buildLineMask(img, w, h, threshold) {
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const rgb = getPixelRGB(img, x, y);
      mask[i] = rgbToLuma(rgb) < threshold ? 1 : 0;
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

function computeRegionColorsFromImage(regionIdMap, regionCount, img, w, h) {
  const sumR = new Float64Array(regionCount);
  const sumG = new Float64Array(regionCount);
  const sumB = new Float64Array(regionCount);
  const area = new Int32Array(regionCount);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const id = regionIdMap[i];
      if (id < 0) continue;
      const rgb = getPixelRGB(img, x, y);
      sumR[id] += rgb[0];
      sumG[id] += rgb[1];
      sumB[id] += rgb[2];
      area[id] += 1;
    }
  }

  const colors = new Array(regionCount);
  for (let id = 0; id < regionCount; id++) {
    const n = Math.max(1, area[id]);
    colors[id] = [sumR[id] / n, sumG[id] / n, sumB[id] / n];
  }
  return colors;
}

function buildRegionGroups(regionStats, colorThreshold, proximityPx) {
  const count = regionStats.length;
  const parent = Array.from({ length: count }, (_, i) => i);
  const cellSize = Math.max(10, proximityPx);
  const grid = new Map();
  const hsl = new Array(count);

  function find(x) {
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  }

  function union(a, b) {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent[pa] = pb;
  }

  function key(cx, cy) {
    return `${cx},${cy}`;
  }

  // Compute HSL for all regions using their boosted RGB
  for (let id = 0; id < count; id++) {
    const s = regionStats[id];
    if (!s) continue;
    hsl[id] = rgbToHsl01(s.rgb);
  }

  // Build spatial grid
  for (let id = 0; id < count; id++) {
    const s = regionStats[id];
    if (!s) continue;
    const x0 = Math.floor(s.minX / cellSize);
    const x1 = Math.floor(s.maxX / cellSize);
    const y0 = Math.floor(s.minY / cellSize);
    const y1 = Math.floor(s.maxY / cellSize);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const k = key(cx, cy);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(id);
      }
    }
  }

  // Merge adjacent same-color regions
  for (let id = 0; id < count; id++) {
    const s = regionStats[id];
    if (!s) continue;
    const x0 = Math.floor((s.minX - proximityPx) / cellSize);
    const x1 = Math.floor((s.maxX + proximityPx) / cellSize);
    const y0 = Math.floor((s.minY - proximityPx) / cellSize);
    const y1 = Math.floor((s.maxY + proximityPx) / cellSize);

    const seen = new Set();
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const k = key(cx, cy);
        const list = grid.get(k);
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const other = list[i];
          if (other <= id || seen.has(other)) continue;
          seen.add(other);

          const o = regionStats[other];
          if (!o) continue;

          // Proximity check: bounding box distance
          const dx = s.minX > o.maxX ? s.minX - o.maxX : o.minX > s.maxX ? o.minX - s.maxX : 0;
          const dy = s.minY > o.maxY ? s.minY - o.maxY : o.minY > s.maxY ? o.minY - s.maxY : 0;
          if (dx > proximityPx || dy > proximityPx) continue;

          // Color distance check using boosted RGB directly
          const dist = colorDistance(s.rgb, o.rgb);
          if (dist > colorThreshold) continue;

          // HSL gating: must be very similar hue/sat/lum to merge
          const a = hsl[id];
          const b = hsl[other];
          const hueDiff = Math.abs(a.h - b.h);
          const hueWrap = Math.min(hueDiff, 1 - hueDiff);
          const satDiff = Math.abs(a.s - b.s);
          const lumDiff = Math.abs(a.l - b.l);
          
          // Only merge if all HSL components are very close
          if (hueWrap <= 0.03 && satDiff <= 0.08 && lumDiff <= 0.08) {
            union(id, other);
          }
        }
      }
    }
  }

  const rootToGroup = new Map();
  const groupMembers = [];
  const regionGroupId = new Int32Array(count);

  for (let id = 0; id < count; id++) {
    const root = find(id);
    let gid = rootToGroup.get(root);
    if (gid === undefined) {
      gid = groupMembers.length;
      rootToGroup.set(root, gid);
      groupMembers.push([]);
    }
    regionGroupId[id] = gid;
    groupMembers[gid].push(id);
  }

  return { regionGroupId, groupMembers };
}

function boostRgb(rgb) {
  const hsl = rgbToHsl01(rgb);
  const s = clamp01(hsl.s * COLOR_SAT_MULT + COLOR_SAT_ADD);
  let l = hsl.l;
  l = clamp01((l - 0.5) * COLOR_CONTRAST_L + 0.5);
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

function microStepForArea(area) {
  const t = clamp01((Math.log10(Math.max(30, area)) - 1.48) / 3.5);
  const step = Math.round(lerp(MICRO_TEX_MIN_STEP, MICRO_TEX_MAX_STEP, t));
  return Math.max(MICRO_TEX_MIN_STEP, Math.min(MICRO_TEX_MAX_STEP, step));
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

function hash32(seed, id) {
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

function hash2f(seed, x, y) {
  let n = (seed ^ Math.imul(x + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(y + 0xc2b2ae35, 0x27d4eb2f)) >>> 0;
  n ^= n >>> 15;
  n = Math.imul(n, 0x2c1b3c6d) >>> 0;
  n ^= n >>> 12;
  n = Math.imul(n, 0x297a2d39) >>> 0;
  n ^= n >>> 15;
  return (n >>> 0) / 4294967296;
}

function colorDistance(rgb1, rgb2) {
  const dr = rgb1[0] - rgb2[0];
  const dg = rgb1[1] - rgb2[1];
  const db = rgb1[2] - rgb2[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function mergeAdjacentSimilarRegions(regionIdMap, regionStats, w, h, colorThreshold) {
  // Build adjacency graph: which regions touch each other
  const adj = new Map();
  for (let i = 0; i < regionStats.length; i++) {
    adj.set(i, new Set());
  }

  // Scan all pixels and find adjacent regions
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const regId = regionIdMap[i];
      if (regId === -1) continue; // Skip boundary pixels

      // Check all 8 neighbors
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          
          const ni = ny * w + nx;
          const nRegId = regionIdMap[ni];
          if (nRegId !== -1 && nRegId !== regId) {
            adj.get(regId).add(nRegId);
          }
        }
      }
    }
  }

  // Union-find for merging regions
  const parent = Array.from({length: regionStats.length}, (_, i) => i);
  function find(x) {
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  }
  function unionRegions(a, b) {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent[pa] = pb;
  }

  // Merge adjacent regions with similar color
  for (let id = 0; id < regionStats.length; id++) {
    const stat = regionStats[id];
    if (!stat || stat.area < 20) continue;

    for (let neighbor of adj.get(id)) {
      const nstat = regionStats[neighbor];
      if (!nstat || nstat.area < 20) continue;

      const dist = colorDistance(stat.rgb, nstat.rgb);
      if (dist < colorThreshold) {
        unionRegions(id, neighbor);
      }
    }
  }

  // Remap regionIdMap to compressed merged IDs
  const oldToNew = new Map();
  const newStats = [];

  // Create mapping from old region IDs to new merged IDs
  for (let id = 0; id < regionStats.length; id++) {
    const root = find(id);
    if (!oldToNew.has(root)) {
      oldToNew.set(root, newStats.length);
      newStats.push(null);
    }
  }

  // Compute stats for merged regions
  for (let id = 0; id < regionStats.length; id++) {
    const root = find(id);
    const newId = oldToNew.get(root);
    const stat = regionStats[id];

    if (!newStats[newId]) {
      // First region in merge group
      newStats[newId] = {
        rgb: [...stat.rgb],
        area: stat.area,
        minX: stat.minX,
        minY: stat.minY,
        maxX: stat.maxX,
        maxY: stat.maxY,
      };
    } else {
      // Merge with existing stats: weighted average color, sum area, expand bounds
      const ns = newStats[newId];
      const totalArea = ns.area + stat.area;
      ns.rgb[0] = (ns.rgb[0] * ns.area + stat.rgb[0] * stat.area) / totalArea;
      ns.rgb[1] = (ns.rgb[1] * ns.area + stat.rgb[1] * stat.area) / totalArea;
      ns.rgb[2] = (ns.rgb[2] * ns.area + stat.rgb[2] * stat.area) / totalArea;
      ns.area = totalArea;
      ns.minX = Math.min(ns.minX, stat.minX);
      ns.minY = Math.min(ns.minY, stat.minY);
      ns.maxX = Math.max(ns.maxX, stat.maxX);
      ns.maxY = Math.max(ns.maxY, stat.maxY);
    }
  }

  // Update pixel map to use new merged region IDs
  for (let i = 0; i < regionIdMap.length; i++) {
    if (regionIdMap[i] >= 0) {
      const oldId = regionIdMap[i];
      const root = find(oldId);
      regionIdMap[i] = oldToNew.get(root);
    }
  }

  return newStats;
}
