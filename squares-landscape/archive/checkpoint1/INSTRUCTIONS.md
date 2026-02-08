# squares-landscape — p5.js redraw instructions

## Goal

Recreate `asset/image.jpg` as a p5.js drawing using an **artistic process-based** translation:

- Preserve overall composition and identity.
- Replace flat color fills with **pattern infills** (geometry + repetition).
- Keep **borders/lines** as **thin black** strokes.
- Avoid heavy distortion.

## Inputs

- `asset/image.jpg` — source image to recreate
- `asset/reference.jpg` — reference showing pattern-fill idea direction
- `asset/line-drawing.png` — black/white line drawing used as boundary mask

## Conceptual strategy (to confirm)

1. **Load** the color reference image (`asset/image.jpg`) and the line drawing (`asset/line-drawing.png`).
2. **Extract line boundaries** from `asset/line-drawing.png` (black pixels) and treat them as barriers.
3. **Label regions (patches)** by connected-components on the non-line pixels.
4. For each region:
   - sample its **average RGB** from the color reference image
   - pick a **motif geometry + scale** based on that RGB (e.g., green→triangles, yellow→circles, grey variants→dot/square/hatch)
   - render a **dense infill** using shapes of that same color until the patch reads as “fully filled”
5. **Overlay the line drawing** again in thin black to keep the identity clear.

This yields a redraw that is “same image, different material”—flat fills become patterned fabrics, while structure stays readable.

## Draft shade → pattern mapping (TBD)

We’ll finalize this after your answers.

| Shade family (example) | Motif | Size rule | Notes |
| --- | --- | --- | --- |
| Yellow light | Circles | larger circles | keep bright areas airy |
| Yellow dark | Circles | smaller circles | denser to read darker |
| Green | Triangles | very small triangles | per your example |
| Blue-gray | Diagonal hatch | line spacing by shade | calmer texture |
| Peach / orange | Squares/diamonds | medium | structured fill |
| Neutral gray | Dots | tiny | subtle texture |

## Implementation plan (will be updated)

1. Create a minimal webpage (`index.html`) that runs p5.js.
2. Implement `sketch.js`:
   - preload the image
   - build quantized shade map (15 bins, excluding near-black outlines)
   - draw pattern layer (motif per shade)
   - draw black outline layer (thin) on top
3. Tune parameters:
   - grid cell size
   - palette binning thresholds
   - outline thresholds (luma cutoff)
   - per-shade motif mapping
4. Verify redraw matches identity (composition + borders) without over-distortion.

## Workspace structure

```text
asset/
   image.jpg
   reference.jpg
index.html
sketch.js
style.css
INSTRUCTIONS.md
```

## How to run

- Option A (simple): run `python -m http.server 5173`, then open `http://localhost:5173/`.

## How the patterns are chosen (current rules)

We do not rely on shade quantization anymore.

Instead, patches come from the line drawing. Each patch gets its color from the average RGB sampled from the same location in the original color image.

Solid base fills are disabled: the redraw is colored **only by the motif shapes**, and each motif uses the same color as the patch it sits on.

Each shade bin is assigned:

- a motif geometry (shape)
- a motif size (correlated to shade lightness)
- a spacing/density (derived from size and lightness)

Current mapping logic:

- Greens → triangles (smaller, denser)
- Yellows → circles
- Low-saturation greys → dot / square / hatch depending on lightness
- Blues → hatch
- Reds/oranges/peach → diamonds
- Other saturated hues → chevrons

Tuning knobs are at the top of `sketch.js` (pattern alpha, base lighten, spacing/size behavior).

- Greens → `tri` (many small triangles)
- Yellows → `circle`
- Low-saturation greys → each grey shade gets its own motif by lightness (dark: `dot`, mid: `square`, light: `hatch`)
- Blues / blue-greys → `hatch`
- Peach/orange/red accents → `diamond`

Motif size is tied to shade lightness: lighter shades get larger motifs.

Black outlines are not considered a shade bin: pixels with luma ≤ 35 are treated as outline-only and re-drawn on top in thin black.

## Current status

- Implemented the webpage and initial redraw logic.
- Next: run it, then adjust thresholds/motif rules if any region reads too distorted.
