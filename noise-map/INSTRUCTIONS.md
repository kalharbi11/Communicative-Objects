# Brooklyn ZIP Hover Map (p5.js + d3 + p5.sound)

This project renders Brooklyn ZIP Code polygons from GeoJSON and highlights ZIPs that exist in a CSV dataset. Hovering over a ZIP triggers looping audio samples across four categories.

## How to run
1. Serve the project root (the folder containing `index.html`) with a local server.
2. Open the served `index.html` in your browser.

Example: VS Code Live Server on the project root.

## Data files
- GeoJSON: `assets/modzcta.geojson`
- CSV: `assets/data.csv`
  - The CSV must include a ZIP column. The code auto-detects any column containing `zip` (case-insensitive).
  - ZIP strings are normalized by trimming whitespace and removing a trailing `.0` if present.

## Audio files
- Folder: `assets/samples/`
- Categories (4 files each):
  - `banging-1..4.wav`
  - `construction-1..4.wav`
  - `party-1..4.wav`
  - `talking-1..4.wav`
- Audio only plays while hovering a ZIP polygon. When leaving all ZIPs, audio stops.
- On each ZIP change, one random loop per category is selected and played.
- Audio requires a user gesture: click once to enable sound.

## Behavior
- All ZIP polygons are drawn, regardless of CSV matching.
- Hovering over a ZIP highlights it and displays its ZIP code.
- Audio loops are randomized on ZIP change only (not every frame).
- The projection fits the full GeoJSON dataset (not filtered by CSV).

## Project structure
- `index.html` — Loads p5.js, p5.sound, full d3 bundle, and `sketch.js`.
- `sketch.js` — Main p5 sketch: loads data, builds projection, draws polygons, hover detection, audio logic.
- `style.css` — Basic page styles and centered canvas.
- `assets/modzcta.geojson` — Brooklyn ZIP Code polygons (GeoJSON).
- `assets/data.csv` — ZIP-level dataset used for hover highlighting.
- `assets/samples/` — 16 audio samples used for looping categories.

## Notes
- If the canvas is blank, check the browser console or on-canvas debug text for load/projection errors.
- Make sure you are serving the project with a local server; loading local files directly can block CSV/GeoJSON fetches.
