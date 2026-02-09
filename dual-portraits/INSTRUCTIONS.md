# Interactive Dotted Portraits - Full Project Documentation

**Project Location:** `website/portraits/`
**Created:** January 2025
**Last Updated:** February 7, 2026

## Table of Contents
1. [Project Overview](#project-overview)
2. [Architecture Evolution](#architecture-evolution)
3. [File Structure](#file-structure)
4. [How It Works](#how-it-works)
5. [Common Mistakes & Lessons Learned](#common-mistakes--lessons-learned)
6. [Implementation Guide for Website](#implementation-guide-for-website)
7. [Configuration Reference](#configuration-reference)

---

## Project Overview

An interactive dual-portrait viewer built with p5.js that displays side-by-side portraits of Khalid (left) and Maria (right). The portraits respond to mouse movement by changing direction (straight, up, down, left, right) and display an animated dotted effect inspired by www.lomz.net (2019).

### Key Features
- **Dual Independent Sketches**: Two separate p5.js instances running simultaneously
- **Directional Hover Detection**: Portraits look in the direction of mouse movement
- **Animated Dot Rendering**: Progressive dot drawing with two phases (initial fill + alive mode)
- **Responsive Layout**: Adapts to different screen sizes
- **Performance Optimized**: Efficient rendering with automatic pause after animation completes

---

## Architecture Evolution

### Phase 1: Single Portrait System (Original)

The project started as a single-portrait implementation for Khalid only.

#### Single Portrait Architecture
```
Main Folder (Original):
├── index.html          → Single container div
├── sketch.js           → Global mode p5.js sketch
├── style.css           → Centered single canvas
└── assets/
    └── khalid-*.png    → 5 portrait variations
```

**Key Characteristics:**
- Used p5.js **global mode** (no instance mode)
- Single canvas centered on screen
- Global variables like `img`, `subX`, `totalDotsDrawn`
- Direct `mouseMoved()` function in global scope
- Canvas position calculated relative to window center
- Hover zones detected using canvas bounding rect

**Single Portrait Code Pattern:**
```javascript
// Global variables
let img;
let totalDotsDrawn = 0;
let currentImagePath = 'assets/khalid-straight.png';

function preload() {
  img = loadImage(currentImagePath);
}

function setup() {
  let canvas = createCanvas(600, 600);
  canvas.parent('sketch-container');
}

function draw() {
  // Single animation loop
}

function mouseMoved() {
  // Detect hover zone and swap image
  swapImage('assets/khalid-left.png');
}
```

**Limitations:**
- Only supports one person
- Cannot run multiple sketches simultaneously (global scope conflicts)
- Not scalable for multi-portrait displays

---

### Phase 2: Dual Portrait System (Current)

The system was refactored to support two independent portraits side-by-side.

#### Dual Portrait Architecture
```
Main Folder (Current):
├── index.html          → Two side-by-side containers
├── sketch.js           → Two p5.js instance mode sketches
├── style.css           → Flexbox 50/50 split layout
└── assets/
    ├── khalid-*.png    → 5 portrait variations
    └── maria-*.png     → 5 portrait variations
```

**Key Characteristics:**
- Uses p5.js **instance mode** with separate `p5()` constructors
- Two independent `PortraitState` class instances
- Each sketch has its own isolated state (img, animation variables)
- Global mouse listener delegates to appropriate portrait based on screen position
- Side-by-side flexbox layout with 50% width per portrait

**Dual Portrait Code Pattern:**
```javascript
// Configuration for both portraits
const PORTRAIT_CONFIG = {
  khalid: {
    containerId: 'khalid-sketch-container',
    images: { center: '...', left: '...', /* etc */ }
  },
  maria: {
    containerId: 'maria-sketch-container',
    images: { center: '...', left: '...', /* etc */ }
  }
};

// Portrait state encapsulation
class PortraitState {
  constructor(config, pInstance) {
    this.config = config;
    this.p = pInstance;
    this.img = null;
    this.totalDotsDrawn = 0;
    // ... isolated state per portrait
  }
}

// Create two independent sketches
function createPortraitSketch(config) {
  return new p5((p) => {
    const portrait = new PortraitState(config, p);

    p.preload = () => { /* load images */ };
    p.setup = () => { /* create canvas */ };
    p.draw = () => { /* render animation */ };

    p.portrait = portrait; // Expose for external access
  });
}

const khalidSketch = createPortraitSketch(PORTRAIT_CONFIG.khalid);
const mariaSketch = createPortraitSketch(PORTRAIT_CONFIG.maria);

// Global mouse listener (efficient - only one listener)
document.addEventListener('mousemove', (event) => {
  const screenMidpoint = window.innerWidth / 2;

  if (event.clientX < screenMidpoint) {
    khalidSketch.portrait.handleHover(event.clientX, event.clientY);
  } else {
    mariaSketch.portrait.handleHover(event.clientX, event.clientY);
  }
});
```

---

### Critical Architectural Changes

#### 1. **Global Mode → Instance Mode**

**Problem with Global Mode:**
```javascript
// ❌ DOESN'T WORK - Second sketch overwrites first
let canvas1 = createCanvas(400, 400); // Global p5 functions
let canvas2 = createCanvas(400, 400); // Overwrites canvas1!
```

**Solution with Instance Mode:**
```javascript
// ✅ WORKS - Each sketch gets its own p5 instance
new p5((p) => {
  p.setup = () => p.createCanvas(400, 400);
});

new p5((p) => {
  p.setup = () => p.createCanvas(400, 400);
});
```

#### 2. **State Encapsulation**

**Before (Global Variables):**
```javascript
let img;
let totalDotsDrawn = 0;
// Problem: Second sketch would conflict with these globals
```

**After (Encapsulated State):**
```javascript
class PortraitState {
  constructor() {
    this.img = null;
    this.totalDotsDrawn = 0;
    // Each portrait has its own isolated state
  }
}
```

#### 3. **Mouse Event Handling**

**Before (Single Portrait):**
```javascript
function mouseMoved() {
  // p5.js built-in function
  // Works fine for single sketch
}
```

**After (Dual Portrait):**
```javascript
// ❌ DOESN'T WORK - Each p5 instance has its own mouseMoved
// One might not fire correctly

// ✅ WORKS - Single global listener delegates to correct portrait
document.addEventListener('mousemove', (event) => {
  if (event.clientX < window.innerWidth / 2) {
    khalidSketch.portrait.handleHover(event.clientX, event.clientY);
  } else {
    mariaSketch.portrait.handleHover(event.clientX, event.clientY);
  }
});
```

---

## File Structure

```
website/portraits/               (Main working directory - PRODUCTION)
├── index.html                   (Dual layout HTML)
├── sketch.js                    (Dual portrait implementation)
├── style.css                    (Flexbox 50/50 split)
├── INSTRUCTIONS.md              (This file)
├── README.md                    (Project overview)
│
├── assets/                      (All portrait images)
│   ├── khalid-straight.png      (Default/center)
│   ├── khalid-left.png
│   ├── khalid-right.png
│   ├── khalid-up.png
│   ├── khalid-down.png
│   ├── maria-straight.png       (Default/center)
│   ├── maria-left.png
│   ├── maria-right.png
│   ├── maria-up.png
│   └── maria-down.png
│
├── sketches/                    (Archived development iterations)
│   └── archive/
│       ├── sketch_001.js        (First attempt)
│       ├── sketch_002.js        (Iteration)
│       ├── sketch_003.js        (Single portrait - working)
│       └── sketch_dual_portrait_working.js (Early dual version)
│
└── explore/                     (Safe experimentation folder)
    └── idea1/                   (Latest dual portrait experiment)
        ├── index.html           (Test HTML)
        ├── sketch.js            (Experimental code)
        ├── style.css            (Test styles)
        ├── INSTRUCTIONS.md      (Development notes)
        ├── assets/              (Copies of portrait images)
        └── sketches/archive/    (Sub-iterations)
```

### Folder Purposes

#### `sketches/archive/` - Historical Iterations
- Contains previous versions of sketch.js from development
- Useful for reverting changes or comparing approaches
- Named sequentially: sketch_001.js, sketch_002.js, etc.
- **DO NOT DELETE** - Provides development history

#### `explore/` - Safe Experimentation
- Isolated folder for testing new features without breaking production
- Can freely break code without affecting main folder
- Copy main files here to test changes
- Once tested and working, migrate back to main folder
- Each idea gets its own subfolder (idea1, idea2, etc.)

**Example Workflow:**
```bash
# 1. Create new exploration branch
mkdir explore/idea2
cp index.html sketch.js style.css explore/idea2/

# 2. Experiment freely in explore/idea2/
# - Test new features
# - Break things
# - Iterate rapidly

# 3. Once stable, migrate back to main
cp explore/idea2/sketch.js ./sketch.js
cp explore/idea2/index.html ./index.html
```

---

## How It Works

### 1. Hover Zone Detection System

Each portrait has an **invisible hover zone** that's larger than the visible canvas.

#### Zone Layout
```
┌─────────────────────────────────────┐
│     Invisible Container             │
│     (2x canvas size)                │
│                                     │
│   ┌───────────────────────┐         │
│   │  TOP ZONE             │         │
│   │  (triggers "up")      │         │
│   └───────────────────────┘         │
│                                     │
│   LEFT        CENTER       RIGHT    │
│   ZONE        ZONE         ZONE     │
│  (triggers   (canvas       (triggers│
│   "left")     visible      "right") │
│               triggers              │
│              "straight")            │
│                                     │
│   ┌───────────────────────┐         │
│   │  BOTTOM ZONE          │         │
│   │  (triggers "down")    │         │
│   └───────────────────────┘         │
│                                     │
└─────────────────────────────────────┘

Key:
✓ Canvas = Visible portrait (e.g., 350px × 350px)
✓ Container = Invisible hover zone (700px × 700px)
✓ Margin zones = Space between canvas edge and container edge
```

#### Zone Detection Algorithm

```javascript
handleHover(mouseX, mouseY) {
  // 1. Update cached canvas/container positions
  this.updateBounds();

  const { canvas, container } = this.bounds;

  // 2. Check if OUTSIDE container → show "center" image
  if (mouseX < container.left || mouseX > container.right ||
      mouseY < container.top || mouseY > container.bottom) {
    this.loadImage(this.config.images.center);
    return;
  }

  // 3. Check if INSIDE canvas (center zone) → show "center" image
  if (mouseX >= canvas.left && mouseX <= canvas.right &&
      mouseY >= canvas.top && mouseY <= canvas.bottom) {
    this.loadImage(this.config.images.center);
    return;
  }

  // 4. IN MARGIN - Find closest edge to determine direction
  const distances = {
    left: mouseX - container.left,
    right: container.right - mouseX,
    top: mouseY - container.top,
    bottom: container.bottom - mouseY
  };

  const minDistance = Math.min(...Object.values(distances));

  // Map closest edge to direction image
  const directionMap = {
    [distances.left]: 'left',
    [distances.right]: 'right',
    [distances.top]: 'up',
    [distances.bottom]: 'down'
  };

  const direction = directionMap[minDistance];
  this.loadImage(this.config.images[direction]);
}
```

#### Why This Design?

**Problem:** Users moving cursor directly over canvas center causes jittery image swapping.

**Solution:** Create margins around canvas where directional images appear.

**Benefits:**
- Smooth transitions between images
- Clear visual feedback for user interaction
- No glitchy rapid image swapping at edges
- Natural "look toward cursor" behavior

---

### 2. Animation System: Two-Phase Dot Rendering

The portrait animation has two distinct phases:

#### **Phase 1: Initial Fill (Fast Coverage)**

**Purpose:** Quickly fill canvas with dots to establish the portrait outline.

**Algorithm:** Random walk from center
```javascript
// Start from canvas center
walkPosition = { x: 0, y: 0 };

// Each frame:
for (let i = 0; i < INITIAL_DOTS_PER_FRAME; i++) {
  // Calculate absolute position
  const x = canvasSize / 2 + walkPosition.x;
  const y = canvasSize / 2 + walkPosition.y;

  // Draw dot at position
  drawDot(x, y);

  // Random step in any direction
  walkPosition.x += random(-30, 30);
  walkPosition.y += random(-30, 30);

  // Reset if out of bounds
  if (abs(walkPosition.x) > canvasSize/2) walkPosition = {x: 0, y: 0};
}
```

**Configuration:**
- `INITIAL_DOTS_PER_FRAME: 5000` - Fast fill rate
- `MAX_TOTAL_DOTS: 6000` - Total dots before switching to Phase 2
- `SKIP_INITIAL_FILL: true` - Can skip to Phase 2 instantly
- `DRAW_STATIC_BASE: true` - Show base image immediately for faster perceived load

**Duration:** Completes in ~1-2 frames (very fast)

---

#### **Phase 2: Alive Mode (Detail Enhancement)**

**Purpose:** Add subtle detail continuously with random dot placement.

**Algorithm:** Random scatter across entire canvas
```javascript
aliveFrameCount++;

// Stop after 10 seconds (600 frames at 60 FPS)
if (aliveFrameCount > MAX_ALIVE_FRAMES) {
  noLoop(); // Pause for performance
  return;
}

// Each frame:
for (let i = 0; i < ALIVE_SPEED; i++) {
  const x = random(canvasSize);
  const y = random(canvasSize);
  drawDot(x, y);
}
```

**Configuration:**
- `ALIVE_SPEED: 100` - Dots per frame
- `ALIVE_MAX_SIZE: 8` - Larger dots than Phase 1
- `ALIVE_MIN_SIZE: 5`
- `MAX_ALIVE_FRAMES: 600` - Auto-pause after 10 seconds

**Duration:** Runs for 10 seconds, then pauses

---

#### Dot Rendering Logic

```javascript
function drawDot(portrait, x, y, minSize, maxSize) {
  const scaledX = x / SCALE_FACTOR;
  const scaledY = y / SCALE_FACTOR;

  // Sample pixel from image
  const pixel = img.get(scaledX, scaledY);

  // Only draw if pixel is visible (not transparent)
  if (pixel[3] > ALPHA_THRESHOLD) {
    // Calculate dot size based on brightness
    const brightness = (pixel[0] + pixel[1] + pixel[2]) * BRIGHTNESS_SENSITIVITY;
    const dotSize = map(brightness, 0, 765, maxSize, minSize);

    // Draw dot with image color
    fill(pixel[0], pixel[1], pixel[2], DOT_OPACITY);
    circle(x, y, dotSize);
    return true;
  }

  return false;
}
```

**Key Features:**
- **Brightness-based sizing:** Darker pixels = larger dots (creates depth)
- **Transparency filtering:** Only draws visible pixels (respects alpha channel)
- **Color sampling:** Uses actual image colors for realistic appearance
- **Configurable opacity:** `DOT_OPACITY` controls dot transparency

---

### 3. Image Swapping and Animation Reset

When user hovers into a new zone, the portrait image swaps and animation restarts.

```javascript
loadImage(imagePath) {
  // Prevent redundant loads
  if (this.currentImagePath === imagePath) return;

  this.currentImagePath = imagePath;

  // Load new image
  this.p.loadImage(imagePath, (loadedImg) => {
    this.img = loadedImg;
    this.img.resize(
      this.canvasSize / SCALE_FACTOR,
      this.canvasSize / SCALE_FACTOR
    );

    // Reset animation to Phase 1
    this.resetAnimation();
  });
}

resetAnimation() {
  this.p.background(255); // Clear canvas

  // Optionally draw static base image immediately
  if (DRAW_STATIC_BASE && this.img) {
    this.p.image(this.img, 0, 0, this.canvasSize, this.canvasSize);
  }

  // Reset animation state
  this.walkPosition = { x: 0, y: 0 };
  this.totalDotsDrawn = 0;
  this.isAliveMode = SKIP_INITIAL_FILL;
  this.aliveFrameCount = 0;

  this.p.loop(); // Resume animation
}
```

**Why Reset Animation?**
- Provides visual feedback for image swap
- Creates engaging re-draw effect
- Ensures consistent animation quality across all images

---

### 4. Responsive Canvas Sizing

Canvas size adapts to window dimensions while maintaining aspect ratio.

```javascript
function calculateCanvasSize(p) {
  return Math.min(
    p.windowWidth * MAX_WIDTH_PERCENT,   // 45% of window width
    p.windowHeight * MAX_HEIGHT_PERCENT, // 90% of window height
    MAX_SIZE                             // 350px maximum
  );
}

function handleResize(p, portrait) {
  const newSize = calculateCanvasSize(p);

  // Only resize if size actually changed
  if (portrait.canvasSize === newSize) return;

  portrait.canvasSize = newSize;
  portrait.containerSize = newSize * HOVER_ZONE_MULTIPLIER;

  // Resize canvas and image
  p.resizeCanvas(portrait.canvasSize, portrait.canvasSize);
  portrait.img.resize(
    portrait.canvasSize / SCALE_FACTOR,
    portrait.canvasSize / SCALE_FACTOR
  );

  // Update cached positions and restart animation
  portrait.updateBounds();
  portrait.resetAnimation();
}
```

**Configuration:**
- `MAX_WIDTH_PERCENT: 0.45` - Each portrait takes 45% of screen width
- `MAX_HEIGHT_PERCENT: 0.9` - Allows 90% of screen height
- `MAX_SIZE: 350` - Hard limit on canvas size (performance)
- `HOVER_ZONE_MULTIPLIER: 2` - Container is always 2x canvas size

---

## Common Mistakes & Lessons Learned

### ❌ Mistake 1: Using Global Mode for Dual Portraits

**What We Did Wrong:**
```javascript
// Tried to create two canvases in global mode
let canvas1 = createCanvas(400, 400);
canvas1.parent('khalid-container');

let canvas2 = createCanvas(400, 400); // Overwrites canvas1!
canvas2.parent('maria-container');
```

**Problem:** p5.js global mode only supports one canvas per page. Second `createCanvas()` overwrites the first.

**Solution:** Use instance mode with separate `new p5()` constructors.

```javascript
const khalidSketch = new p5((p) => {
  p.setup = () => p.createCanvas(400, 400);
});

const mariaSketch = new p5((p) => {
  p.setup = () => p.createCanvas(400, 400);
});
```

**Lesson:** Always use instance mode for multi-canvas projects.

---

### ❌ Mistake 2: Shared State Between Portraits

**What We Did Wrong:**
```javascript
let img; // Global variable
let totalDotsDrawn = 0;

// Both portraits tried to use same variables
// Caused animation conflicts and incorrect state
```

**Problem:** Global variables are shared across both p5 instances, causing state collisions.

**Solution:** Encapsulate state in a class instance per portrait.

```javascript
class PortraitState {
  constructor(config, pInstance) {
    this.img = null;
    this.totalDotsDrawn = 0;
    // Each portrait has isolated state
  }
}
```

**Lesson:** Never share mutable state between p5 instances.

---

### ❌ Mistake 3: Using p5.js mouseMoved() for Dual Portraits

**What We Did Wrong:**
```javascript
// Inside each p5 instance
p.mouseMoved = () => {
  // Detect hover and swap image
  // Problem: Each sketch only knows about its own canvas
  // Caused incorrect hover detection
};
```

**Problem:** p5 instance's `mouseMoved()` uses canvas-relative coordinates, not screen coordinates. This breaks hover detection for side-by-side canvases.

**Solution:** Use single global `document.addEventListener('mousemove')` that delegates to correct portrait.

```javascript
document.addEventListener('mousemove', (event) => {
  const screenMidpoint = window.innerWidth / 2;

  if (event.clientX < screenMidpoint) {
    khalidSketch.portrait.handleHover(event.clientX, event.clientY);
  } else {
    mariaSketch.portrait.handleHover(event.clientX, event.clientY);
  }
});
```

**Lesson:** Use native DOM events for screen-wide mouse tracking when working with multiple p5 instances.

---

### ❌ Mistake 4: Not Caching Canvas Position

**What We Did Wrong:**
```javascript
function handleHover(mouseX, mouseY) {
  // Called every mousemove event
  const rect = canvasElement.getBoundingClientRect(); // EXPENSIVE!
  // Calculate bounds every single frame
}
```

**Problem:** `getBoundingClientRect()` forces layout reflow, causing performance issues when called 60+ times per second.

**Solution:** Cache bounds and only update on setup/resize.

```javascript
class PortraitState {
  updateBounds() {
    const rect = canvasElement.getBoundingClientRect();
    this.bounds.canvas = { left: rect.left, right: rect.right, /* ... */ };
    // Called only on setup() and windowResized()
  }

  handleHover(mouseX, mouseY) {
    // Uses cached this.bounds - no reflow!
    if (mouseX < this.bounds.canvas.left) { /* ... */ }
  }
}
```

**Lesson:** Cache expensive DOM calculations and only update when necessary.

---

### ❌ Mistake 5: Forgetting to Reset Animation on Image Swap

**What We Did Wrong:**
```javascript
loadImage(imagePath) {
  this.img = p.loadImage(imagePath);
  // Forgot to clear canvas or reset animation state
  // New dots drew over old image - created ghosting
}
```

**Problem:** Old dots from previous image remained visible when swapping images.

**Solution:** Always clear canvas and reset animation state on image load.

```javascript
loadImage(imagePath) {
  p.loadImage(imagePath, (loadedImg) => {
    this.img = loadedImg;
    this.resetAnimation(); // Clear canvas and reset state
  });
}
```

**Lesson:** Image swaps require full animation reset for clean visual transitions.

---

### ❌ Mistake 6: Hardcoded Canvas Positioning

**What We Did Wrong:**
```javascript
// Assumed canvas was at fixed position
const canvasX = 100;
const canvasY = 100;

// Broke on resize or when CSS changed
```

**Problem:** Canvas position changes with window resize and CSS layout. Hardcoded values caused incorrect hover detection.

**Solution:** Calculate position dynamically using `getBoundingClientRect()`.

```javascript
updateBounds() {
  const canvasElement = document.querySelector(`#${this.config.containerId} canvas`);
  const rect = canvasElement.getBoundingClientRect();

  this.bounds.canvas = {
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom
  };
}
```

**Lesson:** Always calculate canvas position dynamically for responsive behavior.

---

### ❌ Mistake 7: Not Handling Async Image Loading

**What We Did Wrong:**
```javascript
loadImage(imagePath) {
  this.img = p.loadImage(imagePath);
  this.img.resize(300, 300); // ERROR! Image not loaded yet
}
```

**Problem:** `loadImage()` is asynchronous. Trying to resize immediately fails.

**Solution:** Use callback to wait for load completion.

```javascript
loadImage(imagePath) {
  p.loadImage(imagePath, (loadedImg) => {
    this.img = loadedImg;
    this.img.resize(300, 300); // ✓ Safe - image fully loaded
    this.resetAnimation();
  });
}
```

**Lesson:** Always use p5.js loadImage() callback for post-load operations.

---

### ❌ Mistake 8: Excessive Animation Causing Performance Issues

**What We Did Wrong:**
```javascript
// Original configuration
const ALIVE_SPEED = 500; // Too many dots per frame
// No auto-pause mechanism

// Caused:
// - Frame rate drops
// - Browser lag
// - High CPU usage
```

**Problem:** Continuous high-speed dot drawing consumed excessive CPU.

**Solution:** Reduce dot rate and implement auto-pause.

```javascript
const ALIVE_SPEED = 100; // Reduced
const MAX_ALIVE_FRAMES = 600; // Auto-pause after 10 seconds

if (aliveFrameCount > MAX_ALIVE_FRAMES) {
  p.noLoop(); // Stop animation for performance
}
```

**Lesson:** Balance visual quality with performance. Implement auto-pause for continuous animations.

---

### ❌ Mistake 9: Not Using Static Base Image

**What We Did Wrong:**
```javascript
// Started with blank canvas
// Waited for Phase 1 to complete before anything visible

// User saw:
// 1. Blank white screen (bad first impression)
// 2. Dots slowly appearing
```

**Problem:** Slow initial visual feedback makes site feel unresponsive.

**Solution:** Draw static base image immediately, then overlay dots.

```javascript
const DRAW_STATIC_BASE = true;

setup() {
  p.background(255);
  if (DRAW_STATIC_BASE) {
    p.image(img, 0, 0, canvasSize, canvasSize); // Instant visual feedback
  }
  // Then dots draw over time for animated effect
}
```

**Lesson:** Prioritize fast initial render for better perceived performance.

---

### ❌ Mistake 10: Wrong Asset Paths After Moving Files

**What We Did Wrong:**
```javascript
// In explore/idea1/, used:
images: { center: 'assets/khalid-straight.png' }

// Moved to main folder, forgot to check paths
// Images failed to load
```

**Problem:** Relative paths broke when moving files between folders.

**Solution:** Always verify asset paths after file migration.

```bash
# Check if paths are correct
ls assets/khalid-straight.png

# Test in browser console
new Image().src = 'assets/khalid-straight.png'
```

**Lesson:** Asset paths are relative to HTML file location. Verify after any file moves.

---

## Implementation Guide for Website

### Prerequisites

1. **Required Files** (all in `website/portraits/`):
   - `index.html` - Dual layout HTML
   - `sketch.js` - Dual portrait implementation
   - `style.css` - Flexbox CSS layout
   - `assets/khalid-*.png` - 5 portrait images for Khalid
   - `assets/maria-*.png` - 5 portrait images for Maria

2. **External Dependencies**:
   - p5.js library (via CDN: `https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.7.0/p5.min.js`)

3. **Browser Requirements**:
   - Modern browser with JavaScript enabled
   - Canvas API support
   - Flexbox CSS support

---

### Step-by-Step Website Integration

#### Option 1: Standalone Page (Simplest)

1. Copy entire `portraits/` folder to web server
2. Access via: `https://yoursite.com/portraits/index.html`
3. No additional configuration needed - self-contained

**File Structure:**
```
yoursite.com/
└── portraits/
    ├── index.html
    ├── sketch.js
    ├── style.css
    └── assets/
        └── *.png
```

---

#### Option 2: Embedded in Main Site

**If you want to embed portraits in an existing page:**

```html
<!-- In your main site page -->
<head>
  <link rel="stylesheet" href="/portraits/style.css">
</head>

<body>
  <!-- Your site content -->

  <!-- Embed portraits section -->
  <section id="portraits-section">
    <div class="page">
      <div class="side khalid-side">
        <div class="person-container">
          <h2 class="person-name">Khalid</h2>
          <div id="khalid-sketch-container" class="sketch-container"></div>
        </div>
      </div>

      <div class="side maria-side">
        <div class="person-container">
          <h2 class="person-name">Maria</h2>
          <div id="maria-sketch-container" class="sketch-container"></div>
        </div>
      </div>
    </div>
  </section>

  <!-- Scripts at end of body -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.7.0/p5.min.js"></script>
  <script src="/portraits/sketch.js"></script>
</body>
```

**CSS Adjustments:**

```css
/* Scope portrait styles to avoid conflicts */
#portraits-section .page {
  display: flex;
  height: 600px; /* Or whatever height you want */
}

#portraits-section .side {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
}
```

---

#### Option 3: Full-Screen Landing Page

**Use portraits as hero section:**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Khalid & Maria</title>
  <style>
    body {
      margin: 0;
      overflow: hidden; /* Prevents scroll */
    }
  </style>
  <link rel="stylesheet" href="portraits/style.css">
</head>
<body>
  <div class="page">
    <!-- Portrait containers -->
  </div>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.7.0/p5.min.js"></script>
  <script src="portraits/sketch.js"></script>
</body>
</html>
```

**Result:** Full-screen immersive portrait experience.

---

### Configuration Options

All configuration is in `sketch.js`:

#### Portrait Assets
```javascript
const PORTRAIT_CONFIG = {
  khalid: {
    containerId: 'khalid-sketch-container',
    images: {
      center: 'assets/khalid-straight.png',
      left: 'assets/khalid-left.png',
      right: 'assets/khalid-right.png',
      up: 'assets/khalid-up.png',
      down: 'assets/khalid-down.png'
    }
  },
  maria: { /* same structure */ }
};
```

**To change portrait sources:**
1. Update file paths in `images` object
2. Ensure new images are same format (PNG with transparency)
3. Recommended size: 300-500px square

---

#### Animation Settings
```javascript
const ANIMATION_CONFIG = {
  INITIAL_DOTS_PER_FRAME: 5000,  // Phase 1 speed (higher = faster fill)
  MAX_TOTAL_DOTS: 6000,           // Dots before switching to Phase 2
  SKIP_INITIAL_FILL: true,        // Skip Phase 1 (instant render)
  DRAW_STATIC_BASE: true,         // Show base image immediately

  ALIVE_SPEED: 100,               // Phase 2 dots per frame
  ALIVE_MAX_SIZE: 8,              // Max dot size
  ALIVE_MIN_SIZE: 5,              // Min dot size

  ALPHA_THRESHOLD: 126,           // Min opacity to draw dot (0-255)
  DOT_OPACITY: 200,               // Dot transparency (0-255)
  BRIGHTNESS_SENSITIVITY: 0.4,    // Brightness-to-size multiplier

  MAX_ALIVE_FRAMES: 600           // Auto-pause after 10 sec (60 FPS)
};
```

**Common Tweaks:**
- **Faster initial render:** Increase `INITIAL_DOTS_PER_FRAME`
- **More detailed portraits:** Increase `MAX_TOTAL_DOTS`
- **Skip animation entirely:** Set `SKIP_INITIAL_FILL: true` and `DRAW_STATIC_BASE: true`
- **Longer animation:** Increase `MAX_ALIVE_FRAMES`

---

#### Canvas Size
```javascript
const CANVAS_CONFIG = {
  MAX_WIDTH_PERCENT: 0.45,        // 45% of window width per portrait
  MAX_HEIGHT_PERCENT: 0.9,        // 90% of window height
  MAX_SIZE: 350,                  // Hard limit (performance)
  HOVER_ZONE_MULTIPLIER: 2        // Container = canvas × 2
};
```

**For larger portraits:**
```javascript
MAX_SIZE: 500,                    // Increase max size
MAX_WIDTH_PERCENT: 0.48,          // Use more screen width
```

**Warning:** Larger canvases may impact performance on slower devices.

---

### Performance Optimization

#### For Production Deployment:

1. **Minify sketch.js:**
```bash
npm install -g uglify-js
uglifyjs sketch.js -o sketch.min.js -c -m
```

2. **Optimize images:**
```bash
# Use tools like:
# - TinyPNG (online)
# - ImageOptim (Mac)
# - pngquant (CLI)
```

3. **Add cache headers** (in web server config):
```apache
<FilesMatch "\.(js|css|png)$">
  Header set Cache-Control "max-age=31536000, public"
</FilesMatch>
```

4. **Lazy load on scroll** (if not hero section):
```javascript
// Only initialize when portraits enter viewport
const observer = new IntersectionObserver((entries) => {
  if (entries[0].isIntersecting) {
    initPortraits(); // Load p5.js and initialize
    observer.disconnect();
  }
});
observer.observe(document.getElementById('portraits-section'));
```

---

### Testing Checklist

Before deploying to production:

#### ✅ Visual Testing
- [ ] Both portraits render correctly
- [ ] Dot animation completes without errors
- [ ] Image swapping works in all directions (center, left, right, up, down)
- [ ] No visual glitches or ghosting when swapping
- [ ] Hover zones feel natural (not too sensitive or unresponsive)

#### ✅ Browser Testing
- [ ] Chrome (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest) - especially for iOS
- [ ] Edge (latest)
- [ ] Mobile browsers (Safari iOS, Chrome Android)

#### ✅ Performance Testing
- [ ] Smooth 60 FPS on desktop
- [ ] Acceptable FPS on mobile devices
- [ ] CPU usage reasonable (check browser Task Manager)
- [ ] No memory leaks (check Memory tab in DevTools)
- [ ] Animation pauses after 10 seconds as expected

#### ✅ Responsive Testing
- [ ] Works on 1920×1080 (desktop)
- [ ] Works on 1366×768 (laptop)
- [ ] Works on 768×1024 (tablet portrait)
- [ ] Works on 375×667 (mobile portrait)
- [ ] Window resize updates canvas correctly

#### ✅ Accessibility
- [ ] Alt text for portrait images (if embedding statically)
- [ ] Keyboard navigation (if adding interactive elements)
- [ ] Reduced motion preference respected (optional):
```javascript
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (prefersReducedMotion) {
  ANIMATION_CONFIG.SKIP_INITIAL_FILL = true;
  ANIMATION_CONFIG.MAX_ALIVE_FRAMES = 0; // No animation
}
```

---

### Troubleshooting

#### Problem: Portraits don't appear

**Check:**
1. Browser console for JavaScript errors
2. Network tab - verify all assets loaded (especially p5.js CDN)
3. Asset paths - ensure `assets/*.png` files exist
4. Container IDs - `khalid-sketch-container` and `maria-sketch-container` must exist in HTML

**Solution:**
```javascript
// Add debug logging
console.log('Khalid config:', PORTRAIT_CONFIG.khalid);
console.log('Maria config:', PORTRAIT_CONFIG.maria);

// In preload callback:
p.preload = () => {
  console.log('Loading:', portrait.currentImagePath);
  portrait.img = p.loadImage(
    portrait.currentImagePath,
    () => console.log('Image loaded successfully'),
    () => console.error('Image failed to load')
  );
};
```

---

#### Problem: Hover detection not working

**Check:**
1. Canvas position caching - ensure `updateBounds()` is called on setup and resize
2. Screen split logic - verify `screenMidpoint = window.innerWidth / 2`
3. Console log mouse coordinates to debug:
```javascript
document.addEventListener('mousemove', (event) => {
  console.log('Mouse:', event.clientX, event.clientY);
  console.log('Midpoint:', window.innerWidth / 2);
  console.log('Active portrait:', event.clientX < window.innerWidth / 2 ? 'Khalid' : 'Maria');
});
```

---

#### Problem: Performance issues / lag

**Solutions:**
1. Reduce dot generation rate:
```javascript
ALIVE_SPEED: 50, // Lower from 100
```

2. Decrease max canvas size:
```javascript
MAX_SIZE: 300, // Lower from 350
```

3. Reduce animation duration:
```javascript
MAX_ALIVE_FRAMES: 300, // 5 seconds instead of 10
```

4. Disable Phase 2 entirely:
```javascript
MAX_ALIVE_FRAMES: 0, // No alive mode
```

5. Lower pixel density on mobile:
```javascript
p.setup = () => {
  const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent);
  p.pixelDensity(isMobile ? 1 : 2);
};
```

---

#### Problem: Images don't swap smoothly

**Check:**
1. Ensure `resetAnimation()` is called after image load
2. Verify `DRAW_STATIC_BASE: true` for instant visual feedback
3. Check that old canvas is cleared:
```javascript
resetAnimation() {
  this.p.background(255); // THIS IS CRITICAL
  // ... rest of reset logic
}
```

---

## Configuration Reference

### Complete Configuration Object

```javascript
// Portrait asset paths
const PORTRAIT_CONFIG = {
  khalid: {
    containerId: 'khalid-sketch-container',
    images: {
      center: 'assets/khalid-straight.png',
      left: 'assets/khalid-left.png',
      right: 'assets/khalid-right.png',
      up: 'assets/khalid-up.png',
      down: 'assets/khalid-down.png'
    }
  },
  maria: {
    containerId: 'maria-sketch-container',
    images: {
      center: 'assets/maria-straight.png',
      left: 'assets/maria-left.png',
      right: 'assets/maria-right.png',
      up: 'assets/maria-up.png',
      down: 'assets/maria-down.png'
    }
  }
};

// Animation behavior
const ANIMATION_CONFIG = {
  INITIAL_DOTS_PER_FRAME: 5000,    // Dots per frame in Phase 1 (fast fill)
  MAX_TOTAL_DOTS: 6000,             // Total dots before Phase 2
  SKIP_INITIAL_FILL: true,          // Skip Phase 1, go straight to Phase 2
  DRAW_STATIC_BASE: true,           // Show base image immediately
  ALIVE_SPEED: 100,                 // Dots per frame in Phase 2
  ALIVE_MAX_SIZE: 8,                // Max dot diameter in Phase 2
  ALIVE_MIN_SIZE: 5,                // Min dot diameter in Phase 2
  INITIAL_MAX_SIZE: 7,              // Max dot diameter in Phase 1
  INITIAL_MIN_SIZE: 2,              // Min dot diameter in Phase 1
  RANDOM_WALK_RANGE: 30,            // Random walk step size (Phase 1)
  ALPHA_THRESHOLD: 126,             // Min pixel alpha to draw (0-255)
  DOT_OPACITY: 200,                 // Dot transparency (0-255)
  BRIGHTNESS_SENSITIVITY: 0.4,      // Brightness-to-size multiplier
  MAX_ALIVE_FRAMES: 600             // Auto-pause after N frames (60 FPS)
};

// Canvas sizing
const CANVAS_CONFIG = {
  SCALE_FACTOR: 2,                  // Image sample resolution (higher = better quality)
  MAX_WIDTH_PERCENT: 0.45,          // Max width per portrait (0-1)
  MAX_HEIGHT_PERCENT: 0.9,          // Max height (0-1)
  MAX_SIZE: 350,                    // Absolute max size (pixels)
  PIXEL_DENSITY: 2,                 // Display pixel density (retina = 2)
  HOVER_ZONE_MULTIPLIER: 2          // Container size = canvas × this
};
```

---

### Parameter Tuning Guide

#### Fast Initial Render (Instant)
```javascript
SKIP_INITIAL_FILL: true,
DRAW_STATIC_BASE: true,
MAX_ALIVE_FRAMES: 0
```
**Result:** Static portraits with no animation.

---

#### Slow Artistic Render
```javascript
SKIP_INITIAL_FILL: false,
DRAW_STATIC_BASE: false,
INITIAL_DOTS_PER_FRAME: 1000,   // Slower
MAX_TOTAL_DOTS: 24000,          // More detail
ALIVE_SPEED: 50                 // Slower
```
**Result:** Gradual artistic reveal effect.

---

#### High Performance (Mobile-Friendly)
```javascript
MAX_SIZE: 300,                  // Smaller canvas
PIXEL_DENSITY: 1,               // Lower resolution
ALIVE_SPEED: 50,                // Fewer dots
MAX_ALIVE_FRAMES: 300           // Shorter animation
```
**Result:** Smooth performance on low-end devices.

---

#### Maximum Detail
```javascript
MAX_SIZE: 500,
SCALE_FACTOR: 3,
PIXEL_DENSITY: 2,
MAX_TOTAL_DOTS: 24000,
ALIVE_SPEED: 200
```
**Result:** Highest quality, may impact performance.

---

## Advanced Customization

### Adding a Third Portrait

1. **Update configuration:**
```javascript
const PORTRAIT_CONFIG = {
  khalid: { /* ... */ },
  maria: { /* ... */ },
  john: {
    containerId: 'john-sketch-container',
    images: {
      center: 'assets/john-straight.png',
      // ... etc
    }
  }
};
```

2. **Update HTML:**
```html
<div class="page">
  <div class="side khalid-side"><!-- Khalid --></div>
  <div class="side maria-side"><!-- Maria --></div>
  <div class="side john-side"><!-- John --></div>
</div>
```

3. **Update CSS:**
```css
.side {
  flex: 1; /* Already set - each gets equal width */
}
```

4. **Update mouse handler:**
```javascript
document.addEventListener('mousemove', (event) => {
  const thirdWidth = window.innerWidth / 3;

  if (event.clientX < thirdWidth) {
    khalidSketch.portrait.handleHover(event.clientX, event.clientY);
  } else if (event.clientX < thirdWidth * 2) {
    mariaSketch.portrait.handleHover(event.clientX, event.clientY);
  } else {
    johnSketch.portrait.handleHover(event.clientX, event.clientY);
  }
});
```

5. **Create third sketch:**
```javascript
const johnSketch = createPortraitSketch(PORTRAIT_CONFIG.john);
```

---

### Changing Animation Style

**Example: Circular dot pattern instead of random walk**

```javascript
// Replace drawInitialFill() function
function drawInitialFill(portrait) {
  if (portrait.isAliveMode) return;

  // Draw dots in expanding circles from center
  const angle = portrait.totalDotsDrawn * 0.1;
  const radius = (portrait.totalDotsDrawn / MAX_TOTAL_DOTS) * (portrait.canvasSize / 2);

  const x = portrait.canvasSize / 2 + Math.cos(angle) * radius;
  const y = portrait.canvasSize / 2 + Math.sin(angle) * radius;

  drawDot(portrait, x, y, INITIAL_MIN_SIZE, INITIAL_MAX_SIZE);
  portrait.totalDotsDrawn++;

  if (portrait.totalDotsDrawn >= MAX_TOTAL_DOTS) {
    portrait.isAliveMode = true;
  }
}
```

---

### Adding Sound Interaction

**Example: Play sound on hover zone change**

```javascript
// Preload sounds
p.loadSound('sounds/hover-left.mp3', (sound) => {
  portrait.sounds.left = sound;
});

// In handleHover():
handleHover(mouseX, mouseY) {
  // ... zone detection ...

  const direction = directionMap[minDistance];

  // Play sound if zone changed
  if (direction !== this.currentZone && this.sounds[direction]) {
    this.sounds[direction].play();
  }

  this.currentZone = direction;
  this.loadImage(this.config.images[direction]);
}
```

---

## Summary

This project demonstrates:
- **Dual p5.js instance management** for multiple canvases
- **State encapsulation** to prevent conflicts
- **Zone-based hover detection** for intuitive interaction
- **Two-phase animation system** balancing speed and detail
- **Responsive canvas sizing** for all screen sizes
- **Performance optimization** with auto-pause and caching

**Key Takeaways:**
1. Use instance mode for multiple p5 canvases
2. Encapsulate state in classes per instance
3. Cache expensive calculations (canvas position, bounds)
4. Use global DOM events for cross-canvas interaction
5. Balance visual quality with performance
6. Test across devices and browsers

**File Structure Best Practices:**
- `sketches/archive/` - Keep development history
- `explore/` - Safe experimentation without breaking production
- Main folder - Always production-ready

---

## Questions?

If you encounter issues not covered here:

1. Check browser console for errors
2. Review "Common Mistakes" section
3. Compare your code against `explore/idea1/sketch.js` (last known working version)
4. Check `sketches/archive/` for reference implementations

**Good luck implementing the portraits on your website!**
