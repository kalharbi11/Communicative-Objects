# squares-landscape — p5.js Hover-Reveal Coloring Book

## Goal

Recreate `asset/image.jpg` as an **interactive coloring book** using artistic patterning:
- A clean line-drawing background (`asset/line-drawing.png`) visible by default
- Hovering over a region reveals it with **colored pattern infills** (no solid fills—only geometric shapes)
- Each color/hue is mapped to a distinct motif style (greens→blades, yellows→rings, blues→hatches, etc.)
- Same-color neighboring regions are **grouped together** and activate as clusters on hover
- Fully responsive design (700px max height desktop, scales down for mobile)
- The final aesthetic is "colorful, patterned, yet line-based"—like an artist's sketch brought to life on hover

## Inputs

- `asset/image.jpg` — source image providing region colors
- `asset/reference.jpg` — visual style reference
- `asset/line-drawing.png` — the line-art boundary layer (black/white); displayed as the static background

## How We Got Here: The Technical Journey

### Phase 1: Boundary detection
We extract `asset/line-drawing.png` as a **boundary mask**:
- Pixels darker than luma ~210 are treated as ink
- Only boundary pixels are used for segmentation, preventing large black filled areas from becoming impenetrable walls

### Phase 2: Region labeling
Using **connected-components labeling** (union-find), we identify all regions separated by the line boundaries. This gives us a `regionIdMap`: each pixel knows which region it belongs to.

### Phase 3: Color sampling (per-region)
For each region, we sample the **average RGB** from `asset/image.jpg`, preferring interior pixels (away from line edges) to avoid sampling anti-aliasing or ink color.  
We then **boost saturation & contrast** globally (`COLOR_SAT_MULT = 1.5`, `COLOR_CONTRAST_L = 1.22`) to counteract any fading.

### Phase 4: Motif assignment (by hue)
Based on each region's boosted HSL, we assign:
- **Greens** (h: 0.22–0.45) → blade/stroke pattern (simulates grass/foliage)
- **Yellows** (h: 0.10–0.20) → ring dots in brick layout
- **Greys** (s < 0.11) → dark→stipple dots, light→hatch stripes
- **Blues** (h: 0.50–0.72) → diagonal hatch stripes
- **Reds/oranges/peach** (h ≤ 0.09 or h ≥ 0.92) → diamond outlines
- **Default** → chevrons

### Phase 5: Dense pattern fills
Each region is filled with its assigned motif at jitter-grid/brick/stripe layouts:
- **Motif size** scales inversely with region area: large regions get tiny motifs, small regions get medium motifs
- **Spacing** & **jitter** prevent mechanical appearance
- **Micro-texture safety pass** ensures thin regions also show visible color
- **No solid fills**: everything is outlines/strokes, preserving hand-drawn aesthetic

### Phase 6: Layering
1. **Background**: `asset/line-drawing.png` always visible
2. **Pattern layer**: Colored motifs drawn only for the hovered region group
3. Patterns render on top of line-drawing background

### Phase 7: Region grouping by color similarity
After computing region stats, we **group regions that share similar colors and are spatially close**:
- Uses the **boosted RGB colors** from Phase 3 (the same colors used to render patterns)
- Builds a spatial grid to efficiently find nearby regions (within 100px bounding-box distance)
- Checks color distance (RGB Euclidean distance < 18) between nearby regions
- Applies strict **HSL gating** to prevent grouping different colors:
  - Hue difference ≤ 0.03 (very similar hue)
  - Saturation difference ≤ 0.08
  - Lightness difference ≤ 0.08
- Uses union-find to merge matching regions into groups
- Result: all pink dunes activate together, all green boxes together, etc.

### Phase 8: Interactive hover reveal
The sketch tracks mouse position each frame:
- Find which region (if any) is under the mouse
- Look up the **group** that region belongs to
- Redraw: **background + patterns for ALL regions in that group**
- If mouse is outside, only background line-drawing shows
- Patterns remain **visually identical**; hovering just reveals them selectively by group

## Workspace Structure

```text
asset/
   image.jpg         — color source
   line-drawing.png  — boundary layer
   reference.jpg     — style reference (not loaded by sketch)
index.html           — two-column layout
sketch.js            — p5.js sketch with hover-reveal logic
style.css            — responsive styling (700px max)
INSTRUCTIONS.md      — this file
```

## How to Run

```bash
python -m http.server 5173
# Then open http://localhost:5173/ in your browser
```

## Interaction

- **Hover** over any region to reveal its colored patterns
- All regions with **similar colors nearby** light up together as a group
- Move mouse away to return to line-drawing-only view
- Works on touch devices (hover = touch)

## Key Tuning Parameters (in `sketch.js`)

**Segmentation & Color:**
- `LINE_LUMA_THRESHOLD = 210` — luma cutoff for line ink
- `LINE_SEGMENT_DILATE = 1` — line mask dilation for segmentation
- `COLOR_SAMPLE_EXCLUDE_LINE_DILATE = 2` — exclude edge pixels from color sampling
- `COLOR_SAT_MULT = 1.5` — saturation boost multiplier
- `COLOR_SAT_ADD = 0.03` — saturation boost additive
- `COLOR_CONTRAST_L = 1.22` — contrast boost for lightness

**Pattern Rendering:**
- `PATTERN_ALPHA = 255` — pattern opacity (fully opaque)
- `MIN_SPACING = 2` — densest motif spacing
- `IGNORE_TINY_REGIONS_UNDER = 15` — skip regions smaller than this
- `MICRO_TEX_MIN_AREA = 20` — minimum area for micro-texture pass
- `MICRO_TEX_PROB = 0.65` — fraction of micro-cells that get marks

**Region Grouping (in `buildRegionGroups`):**
- Color distance threshold: `18` (RGB Euclidean distance)
- Proximity threshold: `100px` (bounding-box distance)
- HSL gates: hue ≤ 0.03, sat ≤ 0.08, lum ≤ 0.08

## Responsive Design

The webpage layout (`style.css`) is fully responsive:

**Desktop (default):**
- Two panels side-by-side
- Max height: 700px
- Max width: 700px per image
- Images maintain aspect ratio (no stretching)
- Centered layout

**Tablet (≤768px):**
- Panels stack vertically
- Max height: 500px

**Mobile (≤480px):**
- Max height: 350px
- Reduced padding/gaps

Key CSS features:
- `object-fit: contain` preserves aspect ratios
- `!important` on canvas dimensions overrides p5.js inline styles
- Flexbox centering with `align-items: center`

## Current Status

✅ **Hover-reveal interactive coloring book fully functional**  
✅ Line-drawing background static and always visible  
✅ Patterns only show on hover; style identical to full version  
✅ All regions (cactuses, palms, bushes, grass, etc.) are colored  
✅ **Same-color regions grouped and activate together** (e.g., all pink dunes, all green boxes)  
✅ **Responsive design** scales gracefully from desktop to mobile  
✅ No image stretching—aspect ratios preserved  

## Development Notes

- Region colors are sampled from `asset/image.jpg` with interior-pixel preference to avoid edge anti-aliasing
- Colors are **boosted** (saturation 1.5x, contrast 1.22x, gamma adjustment) before motif assignment
- Grouping uses the **same boosted RGB** that drives pattern rendering—ensures color identity is consistent
- No external reference images needed for grouping (previously referenced `full-color.png` but now uses computed colors directly)
- Patterns render with alpha 255 (fully opaque) but use stroke-only shapes (no fills) for hand-drawn aesthetic
- Micro-texture pass ensures even thin regions get visible color marks
- Canvas sizing uses `!important` flags to override p5.js automatic sizing that was causing stretching
