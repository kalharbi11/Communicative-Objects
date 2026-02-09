// Brooklyn ZIP Hover Map with p5.js + d3 (geo)
// Always draws all polygons; CSV only affects interactivity/color.

let geojson, table;
let zipMap = new Map();        // zip -> rowData
let features = [];             // ALL features
let projectedPaths = [];       // [{rings, zip, feature}]
let projection;
let hovered = null;
let complaintColumns = [];
const MAP_CROP_LEFT = 0.2;
const MAP_CROP_TOP = 0.3;
let cropScale = 1;
let cropOffsetX = 0;
let cropOffsetY = 0;

let canvasSize = 900;
let ZIP_COLUMN = null;
let loadErrors = [];

// Audio
const SOUND_CATEGORIES = ["banging", "construction", "party", "talking"];
const SOUND_VARIATIONS = 4;
let samplesByCategory = {};
let currentByCategory = {};
let soundEnabled = false;
let lastHoverZip = null;

// IMPORTANT: your GeoJSON uses lowercase `modzcta`
const GEO_ZIP_KEY = "modzcta";

function preload() {
  geojson = loadJSON(
    "assets/modzcta.geojson",
    () => {},
    (err) => {
      console.error("GeoJSON load failed:", err);
      loadErrors.push("GeoJSON load failed (assets/modzcta.geojson)");
    }
  );
  table = loadTable(
    "assets/data.csv",
    "csv",
    "header",
    () => {},
    (err) => {
      console.error("CSV load failed:", err);
      loadErrors.push("CSV load failed (assets/data.csv)");
    }
  );

  // Preload audio samples for instant switching
  for (const category of SOUND_CATEGORIES) {
    samplesByCategory[category] = [];
    for (let i = 1; i <= SOUND_VARIATIONS; i++) {
      const path = `assets/samples/${category}-${i}.wav`;
      const snd = loadSound(
        path,
        () => {},
        (err) => {
          console.error("Sound load failed:", path, err);
          loadErrors.push(`Sound load failed (${path})`);
        }
      );
      samplesByCategory[category].push(snd);
    }
  }
}

function setup() {
  canvasSize = getCanvasSize();
  const cnv = createCanvas(canvasSize, canvasSize);
  const mount = document.getElementById("canvas-mount");
  if (mount) cnv.parent(mount);
  document.addEventListener(
    "pointerdown",
    () => {
      enableSound();
    },
    { once: true }
  );

  // On-canvas debug so you don't have to guess
  background(245);
  fill(20);
  textSize(16);
  textAlign(LEFT, TOP);
  if (loadErrors.length) {
    text(loadErrors.join(" | "), 16, 40);
  }
  text("Loading...", 16, 16);

  if (!geojson || !geojson.features) {
    console.error("GeoJSON failed to load");
    text("GeoJSON failed to load", 16, 40);
    return;
  }
  if (!table || table.getRowCount() === 0) {
    console.warn("CSV failed to load or is empty");
    text("CSV failed to load or is empty (map will still render)", 16, 40);
  } else {
    detectZipColumn();
    buildZipMap();
    detectComplaintColumns();
  }

  features = geojson.features; // never filter geometry away
  computeProjectionAndPaths();

  console.log("CSV columns:", table ? table.columns : []);
  console.log("Detected ZIP column:", ZIP_COLUMN);
  console.log("Complaint columns:", complaintColumns);
  console.log("CSV rows:", table ? table.getRowCount() : 0);
  console.log("zipMap.size:", zipMap.size);
  console.log("GeoJSON features:", features.length);

  // If projection failed due to d3 missing, you’ll see it here
  if (!projection || projectedPaths.length === 0) {
    console.error("Projection/path build failed. Check d3 loaded and GeoJSON structure.");
  }

  updateInfoPanel(null, []);
}

function windowResized() {
  canvasSize = getCanvasSize();
  resizeCanvas(canvasSize, canvasSize);
  computeProjectionAndPaths();
}

function getCanvasSize() {
  const pad = 12;
  const mapColumn = document.getElementById("map-column");
  const infoPanel = document.getElementById("info-panel");
  const gap = 18;
  const availableWidth = mapColumn ? mapColumn.clientWidth : windowWidth - pad * 2;
  const panelHeight = infoPanel ? infoPanel.offsetHeight : 220;
  const availableHeight = windowHeight - pad * 2 - panelHeight - gap;
  const size = Math.max(220, Math.min(availableWidth, availableHeight));
  document.documentElement.style.setProperty("--map-size", `${size}px`);

  if (infoPanel) {
    const updatedPanelHeight = infoPanel.offsetHeight;
    const updatedAvailableHeight = windowHeight - pad * 2 - updatedPanelHeight - gap;
    const adjustedSize = Math.max(220, Math.min(availableWidth, updatedAvailableHeight));
    if (Math.abs(adjustedSize - size) > 1) {
      document.documentElement.style.setProperty("--map-size", `${adjustedSize}px`);
      return adjustedSize;
    }
  }

  return size;
}

function mousePressed() {
  if (!soundEnabled) {
    enableSound();
  }
}

function enableSound() {
  if (soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (ctx && ctx.state !== "running") {
      ctx.resume();
    }
  } catch {}
  userStartAudio();
  soundEnabled = true;
}

function pickRandomSample(category) {
  const list = samplesByCategory[category] || [];
  if (!list.length) return null;
  return list[floor(random(list.length))];
}

function handleZipChange(newZip) {
  if (!soundEnabled) return;
  // Stop any current loops before switching
  for (const category of SOUND_CATEGORIES) {
    const current = currentByCategory[category];
    if (current && current.isPlaying()) current.stop();
    const next = pickRandomSample(category);
    currentByCategory[category] = next;
    if (next) next.loop();
  }
}

function stopAllSounds() {
  for (const category of SOUND_CATEGORIES) {
    const current = currentByCategory[category];
    if (current && current.isPlaying()) current.stop();
  }
}

function normalizeZip(z) {
  const cleaned = String(z ?? "")
    .replace(/\.0$/, "")
    .trim();
  if (/^\d{4}$/.test(cleaned)) {
    return `0${cleaned}`;
  }
  return cleaned;
}

function detectZipColumn() {
  ZIP_COLUMN = null;
  for (let col of table.columns) {
    if (String(col).toLowerCase().includes("zip")) {
      ZIP_COLUMN = col;
      break;
    }
  }
  if (!ZIP_COLUMN) {
    console.warn("ZIP column not found; falling back to first column");
    ZIP_COLUMN = table.columns[0];
  }
}

function detectComplaintColumns() {
  complaintColumns = [];
  if (!table) return;

  const exact = [
    "Top 1 Complaint Type",
    "Top 2 Complaint Type",
    "Top 3 Complaint Type",
    "Top 4 Complaint Type",
  ];
  const hasExact = exact.every((col) => table.columns.includes(col));
  if (hasExact) {
    complaintColumns = exact.slice();
    return;
  }

  const matches = table.columns
    .map((col) => {
      const label = String(col);
      const lower = label.toLowerCase();
      if (!lower.includes("complaint") || !lower.includes("type")) return null;
      const match = label.match(/([1-4])/);
      if (!match) return null;
      return { col, rank: Number.parseInt(match[1], 10) };
    })
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank);

  complaintColumns = matches.map((m) => m.col).slice(0, 4);

  if (complaintColumns.length < 4) {
    const fallback = table.columns.filter(
      (col) =>
        col !== ZIP_COLUMN &&
        !String(col).toLowerCase().includes("percent") &&
        !String(col).includes("%")
    );
    complaintColumns = fallback.slice(0, 4);
  }
}

function buildZipMap() {
  zipMap.clear();
  for (let i = 0; i < table.getRowCount(); i++) {
    const zip = normalizeZip(table.getString(i, ZIP_COLUMN));
    if (zip) zipMap.set(zip, table.getRow(i));
  }
}

function getFeatureZip(feature) {
  // robust: handle different schemas
  const props = feature?.properties || {};
  return normalizeZip(props[GEO_ZIP_KEY] ?? props.MODZCTA ?? props.modzcta ?? props.zcta);
}

function computeProjectionAndPaths() {
  if (!features?.length) {
    projectedPaths = [];
    return;
  }
  if (typeof d3 === "undefined") {
    console.error("d3 is not defined. Did the d3 script load?");
    projectedPaths = [];
    return;
  }

  const fc = { type: "FeatureCollection", features };
  projection = d3.geoMercator().fitSize([width, height], fc);
  const cropLeft = MAP_CROP_LEFT;
  const cropTop = MAP_CROP_TOP;
  cropScale = Math.max(1 / (1 - cropLeft), 1 / (1 - cropTop));
  cropOffsetX = width * cropLeft * cropScale;
  cropOffsetY = height * cropTop * cropScale;

  projectedPaths = features.map((feature) => {
    const geom = feature.geometry;
    let rings = [];

    if (geom.type === "Polygon") {
      rings = geom.coordinates.map((ring) =>
        ring.map(([lon, lat]) => {
          const [x, y] = projection([lon, lat]);
          return { x: x * cropScale - cropOffsetX, y: y * cropScale - cropOffsetY };
        })
      );
    } else if (geom.type === "MultiPolygon") {
      rings = geom.coordinates.flatMap((poly) =>
        poly.map((ring) =>
          ring.map(([lon, lat]) => {
            const [x, y] = projection([lon, lat]);
            return { x: x * cropScale - cropOffsetX, y: y * cropScale - cropOffsetY };
          })
        )
      );
    }

    return { rings, zip: getFeatureZip(feature), feature };
  });
}

function getComplaintsForZip(zip) {
  const normalized = normalizeZip(zip);
  if (!normalized || !zipMap.has(normalized)) return [];
  const row = zipMap.get(normalized);
  if (!row || !complaintColumns.length) return [];
  return complaintColumns.map((col) => row.getString(col).trim());
}

function updateInfoPanel(zip, complaints) {
  const zipDisplay = document.getElementById("zip-display");
  const zipCell = document.getElementById("zip-cell");
  const complaintEls = [
    document.getElementById("complaint-1"),
    document.getElementById("complaint-2"),
    document.getElementById("complaint-3"),
    document.getElementById("complaint-4"),
  ];

  if (!zipDisplay || !zipCell) return;

  if (!zip) {
    zipDisplay.textContent = "Hover a ZIP";
    zipCell.textContent = "--";
    zipCell.classList.add("muted");
    complaintEls.forEach((el) => {
      if (!el) return;
      el.textContent = "--";
      el.classList.add("muted");
    });
    return;
  }

  zipDisplay.textContent = `ZIP ${zip}`;
  zipCell.textContent = zip;
  zipCell.classList.remove("muted");

  for (let i = 0; i < complaintEls.length; i++) {
    const el = complaintEls[i];
    if (!el) continue;
    const value = complaints[i];
    el.textContent = value || "--";
    if (value) {
      el.classList.remove("muted");
    } else {
      el.classList.add("muted");
    }
  }
}

function draw() {
  background(245);

  // If something failed, show it visibly
  if (!projection || projectedPaths.length === 0) {
    fill(20);
    textSize(16);
    textAlign(LEFT, TOP);
    text("No paths yet. Check console for load/projection errors.", 16, 16);
    return;
  }

  hovered = null;

  let mouseLonLat = null;
  if (mouseX >= 0 && mouseX <= width && mouseY >= 0 && mouseY <= height) {
    try {
      const invX = (mouseX + cropOffsetX) / cropScale;
      const invY = (mouseY + cropOffsetY) / cropScale;
      mouseLonLat = projection.invert([invX, invY]);
    } catch {
      mouseLonLat = null;
    }
  }

  if (mouseLonLat) {
    for (let i = 0; i < features.length; i++) {
      if (d3.geoContains(features[i], mouseLonLat)) {
        hovered = projectedPaths[i];
        break;
      }
    }
  }
  const currentHoverZip = hovered ? normalizeZip(hovered.zip) : null;
  if (currentHoverZip !== lastHoverZip && currentHoverZip !== null) {
    if (soundEnabled) handleZipChange(currentHoverZip);
  } else if (currentHoverZip === null && lastHoverZip !== null) {
    stopAllSounds();
  }

  if (currentHoverZip !== lastHoverZip) {
    const complaints = getComplaintsForZip(currentHoverZip);
    updateInfoPanel(currentHoverZip, complaints);
  }

  lastHoverZip = currentHoverZip;

  // Draw all polygons
  for (let p of projectedPaths) {
    const inCSV = zipMap.has(normalizeZip(p.zip));

    // non-matching ZIPs still draw faintly
    stroke(inCSV ? 160 : 220);
    strokeWeight(1);
    noFill();

    // skip normal draw if it will be drawn as hovered highlight
    if (hovered && p.zip === hovered.zip && inCSV) continue;

    for (let ring of p.rings) {
      beginShape();
      for (let pt of ring) vertex(pt.x, pt.y);
      endShape(CLOSE);
    }
  }

  // Hover highlight only for ZIPs in CSV
  if (hovered && zipMap.has(normalizeZip(hovered.zip))) {
    fill(255, 220, 120, 180);
    stroke(200, 80, 0);
    strokeWeight(2);

    for (let ring of hovered.rings) {
      beginShape();
      for (let pt of ring) vertex(pt.x, pt.y);
      endShape(CLOSE);
    }

    noStroke();
    fill(40);
    textSize(32);
    textAlign(LEFT, TOP);
    text(hovered.zip, 16, 16);
  }

  if (!soundEnabled) {
    noStroke();
    fill(0, 0, 0, 120);
    rect(0, 0, width, height);
    fill(255);
    textSize(24);
    textAlign(CENTER, CENTER);
    text("Click to enable sound", width / 2, height / 2);
  }
}


