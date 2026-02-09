/**
 * Dual Interactive Dotted Portraits
 *
 * Interactive portrait system with animated dot rendering and directional hover detection.
 * Features dual independent p5.js instances with optimized performance for production use.
 * Based on www.lomz.net - 2019
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

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

const ANIMATION_CONFIG = {
  INITIAL_DOTS_PER_FRAME: 5000,
  MAX_TOTAL_DOTS: 6000,
  SKIP_INITIAL_FILL: true,
  DRAW_STATIC_BASE: true,
  ALIVE_SPEED: 100,
  ALIVE_MAX_SIZE: 8,
  ALIVE_MIN_SIZE: 5,
  INITIAL_MAX_SIZE: 7,
  INITIAL_MIN_SIZE: 2,
  RANDOM_WALK_RANGE: 30,
  ALPHA_THRESHOLD: 126,
  DOT_OPACITY: 200,
  BRIGHTNESS_SENSITIVITY: 0.4,
  MAX_ALIVE_FRAMES: 600
};

const CANVAS_CONFIG = {
  SCALE_FACTOR: 2,
  MAX_WIDTH_PERCENT: 0.45,
  MAX_HEIGHT_PERCENT: 0.9,
  MAX_SIZE: 350,
  PIXEL_DENSITY: 2,
  HOVER_ZONE_MULTIPLIER: 2
};

// ============================================================================
// PORTRAIT STATE CLASS
// ============================================================================

class PortraitState {
  constructor(config, pInstance) {
    this.config = config;
    this.p = pInstance;
    this.currentImagePath = config.images.center;
    this.img = null;

    // Canvas dimensions
    this.canvasSize = 600;
    this.containerSize = 0;

    // Cached canvas position
    this.bounds = {
      canvas: { left: 0, right: 0, top: 0, bottom: 0 },
      container: { left: 0, right: 0, top: 0, bottom: 0 }
    };

    // Animation state for random walk
    this.walkPosition = { x: 0, y: 0 };
    this.totalDotsDrawn = 0;
    this.isAliveMode = ANIMATION_CONFIG.SKIP_INITIAL_FILL;
    this.aliveFrameCount = 0;

    // Current hover zone
    this.currentZone = 'center';
  }

  /**
   * Reset animation to initial state
   */
  resetAnimation() {
    this.p.background(255);

    if (ANIMATION_CONFIG.DRAW_STATIC_BASE && this.img) {
      this.p.image(this.img, 0, 0, this.canvasSize, this.canvasSize);
    }

    this.walkPosition = { x: 0, y: 0 };
    this.totalDotsDrawn = 0;
    this.isAliveMode = ANIMATION_CONFIG.SKIP_INITIAL_FILL;
    this.aliveFrameCount = 0;
    this.p.loop();
  }

  /**
   * Load and swap to a different image
   */
  loadImage(imagePath) {
    if (this.currentImagePath === imagePath) return;

    this.currentImagePath = imagePath;
    this.p.loadImage(imagePath, (loadedImg) => {
      this.img = loadedImg;
      this.img.resize(
        this.canvasSize / CANVAS_CONFIG.SCALE_FACTOR,
        this.canvasSize / CANVAS_CONFIG.SCALE_FACTOR
      );
      this.resetAnimation();
    });
  }

  /**
   * Update cached canvas position
   */
  updateBounds() {
    const canvasElement = document.querySelector(`#${this.config.containerId} canvas`);
    if (!canvasElement) return;

    const rect = canvasElement.getBoundingClientRect();
    const margin = (this.containerSize - this.canvasSize) / 2;

    this.bounds.canvas = {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom
    };

    this.bounds.container = {
      left: rect.left - margin,
      right: rect.right + margin,
      top: rect.top - margin,
      bottom: rect.bottom + margin
    };
  }

  /**
   * Detect which zone the mouse is in and swap image accordingly
   */
  handleHover(mouseX, mouseY) {
    this.updateBounds();

    const { canvas, container } = this.bounds;

    // Check if mouse is outside hover zone
    const isOutside = (
      mouseX < container.left || mouseX > container.right ||
      mouseY < container.top || mouseY > container.bottom
    );

    // Check if mouse is in center zone (directly over canvas)
    const isCenter = (
      mouseX >= canvas.left && mouseX <= canvas.right &&
      mouseY >= canvas.top && mouseY <= canvas.bottom
    );

    if (isOutside || isCenter) {
      this.loadImage(this.config.images.center);
      this.currentZone = 'center';
      return;
    }

    // Calculate distances to each edge to find nearest direction
    const distances = {
      left: mouseX - container.left,
      right: container.right - mouseX,
      top: mouseY - container.top,
      bottom: container.bottom - mouseY
    };

    const minDistance = Math.min(...Object.values(distances));

    // Map closest edge to direction
    const directionMap = {
      [distances.left]: 'left',
      [distances.right]: 'right',
      [distances.top]: 'up',
      [distances.bottom]: 'down'
    };

    const direction = directionMap[minDistance];
    this.loadImage(this.config.images[direction]);
    this.currentZone = direction;
  }
}

// ============================================================================
// ANIMATION RENDERING
// ============================================================================

/**
 * Calculate dot size based on pixel brightness
 */
function calculateDotSize(pixel, minSize, maxSize, p) {
  const brightness = (pixel[0] + pixel[1] + pixel[2]) * ANIMATION_CONFIG.BRIGHTNESS_SENSITIVITY;
  const constrainedBrightness = p.constrain(brightness, 0, 765);
  return p.map(constrainedBrightness, 0, 765, maxSize, minSize);
}

/**
 * Draw a single dot if pixel is visible
 */
function drawDot(portrait, x, y, minSize, maxSize) {
  const { p, img } = portrait;
  const scaledX = x / CANVAS_CONFIG.SCALE_FACTOR;
  const scaledY = y / CANVAS_CONFIG.SCALE_FACTOR;

  const pixel = img.get(scaledX, scaledY);

  if (pixel[3] > ANIMATION_CONFIG.ALPHA_THRESHOLD) {
    const dotSize = calculateDotSize(pixel, minSize, maxSize, p);
    p.fill(pixel[0], pixel[1], pixel[2], ANIMATION_CONFIG.DOT_OPACITY);
    p.circle(x, y, dotSize);
    return true;
  }

  return false;
}

/**
 * Phase 1: Fill canvas using random walk algorithm
 */
function drawInitialFill(portrait) {
  if (portrait.isAliveMode || portrait.totalDotsDrawn >= ANIMATION_CONFIG.MAX_TOTAL_DOTS) {
    portrait.isAliveMode = true;
    return;
  }

  portrait.img.loadPixels();

  for (let i = 0; i < ANIMATION_CONFIG.INITIAL_DOTS_PER_FRAME; i++) {
    if (portrait.totalDotsDrawn >= ANIMATION_CONFIG.MAX_TOTAL_DOTS) {
      portrait.isAliveMode = true;
      break;
    }

    // Calculate current position from center using walk offset
    const x = portrait.canvasSize / 2 + portrait.walkPosition.x;
    const y = portrait.canvasSize / 2 + portrait.walkPosition.y;

    // Random walk step
    portrait.walkPosition.x += portrait.p.random(
      -ANIMATION_CONFIG.RANDOM_WALK_RANGE,
      ANIMATION_CONFIG.RANDOM_WALK_RANGE
    );
    portrait.walkPosition.y += portrait.p.random(
      -ANIMATION_CONFIG.RANDOM_WALK_RANGE,
      ANIMATION_CONFIG.RANDOM_WALK_RANGE
    );

    // Draw dot and increment counter
    if (drawDot(portrait, x, y, ANIMATION_CONFIG.INITIAL_MIN_SIZE, ANIMATION_CONFIG.INITIAL_MAX_SIZE)) {
      portrait.totalDotsDrawn++;
    }

    // Reset walk if out of bounds
    const halfSize = portrait.canvasSize / 2;
    if (Math.abs(portrait.walkPosition.x) > halfSize || Math.abs(portrait.walkPosition.y) > halfSize) {
      portrait.walkPosition = { x: 0, y: 0 };
    }
  }
}

/**
 * Phase 2: Continuous random dot placement (alive mode)
 */
function drawAliveMode(portrait) {
  if (!portrait.isAliveMode) return;

  portrait.aliveFrameCount++;

  // Stop after max frames for performance
  if (portrait.aliveFrameCount > ANIMATION_CONFIG.MAX_ALIVE_FRAMES) {
    portrait.p.noLoop();
    return;
  }

  portrait.img.loadPixels();

  for (let i = 0; i < ANIMATION_CONFIG.ALIVE_SPEED; i++) {
    const x = portrait.p.random(portrait.canvasSize);
    const y = portrait.p.random(portrait.canvasSize);
    drawDot(portrait, x, y, ANIMATION_CONFIG.ALIVE_MIN_SIZE, ANIMATION_CONFIG.ALIVE_MAX_SIZE);
  }
}

/**
 * Main draw function
 */
function renderPortrait(portrait) {
  if (!portrait.img) return;

  drawInitialFill(portrait);
  drawAliveMode(portrait);
}

// ============================================================================
// CANVAS SETUP
// ============================================================================

/**
 * Calculate optimal canvas size
 */
function calculateCanvasSize(p) {
  return Math.min(
    p.windowWidth * CANVAS_CONFIG.MAX_WIDTH_PERCENT,
    p.windowHeight * CANVAS_CONFIG.MAX_HEIGHT_PERCENT,
    CANVAS_CONFIG.MAX_SIZE
  );
}

/**
 * Initialize canvas and portrait
 */
function setupCanvas(p, portrait) {
  portrait.canvasSize = calculateCanvasSize(p);
  portrait.containerSize = portrait.canvasSize * CANVAS_CONFIG.HOVER_ZONE_MULTIPLIER;

  const canvas = p.createCanvas(portrait.canvasSize, portrait.canvasSize);
  canvas.parent(portrait.config.containerId);
  p.pixelDensity(CANVAS_CONFIG.PIXEL_DENSITY);
  p.noStroke();

  portrait.img.resize(
    portrait.canvasSize / CANVAS_CONFIG.SCALE_FACTOR,
    portrait.canvasSize / CANVAS_CONFIG.SCALE_FACTOR
  );

  p.background(255);

  if (ANIMATION_CONFIG.DRAW_STATIC_BASE) {
    p.image(portrait.img, 0, 0, portrait.canvasSize, portrait.canvasSize);
  }

  portrait.updateBounds();
}

/**
 * Handle window resize
 */
function handleResize(p, portrait) {
  const newSize = calculateCanvasSize(p);

  if (portrait.canvasSize === newSize) return;

  portrait.canvasSize = newSize;
  portrait.containerSize = newSize * CANVAS_CONFIG.HOVER_ZONE_MULTIPLIER;

  p.resizeCanvas(portrait.canvasSize, portrait.canvasSize);
  portrait.img.resize(
    portrait.canvasSize / CANVAS_CONFIG.SCALE_FACTOR,
    portrait.canvasSize / CANVAS_CONFIG.SCALE_FACTOR
  );

  portrait.updateBounds();
  portrait.resetAnimation();

  p.background(255);

  if (ANIMATION_CONFIG.DRAW_STATIC_BASE) {
    p.image(portrait.img, 0, 0, portrait.canvasSize, portrait.canvasSize);
  }

  p.loop();
}

// ============================================================================
// P5.JS SKETCH INSTANCES
// ============================================================================

/**
 * Create a p5.js sketch instance for a portrait
 */
function createPortraitSketch(config) {
  return new p5((p) => {
    const portrait = new PortraitState(config, p);

    p.preload = () => {
      portrait.img = p.loadImage(portrait.currentImagePath);
    };

    p.setup = () => setupCanvas(p, portrait);
    p.draw = () => renderPortrait(portrait);
    p.windowResized = () => handleResize(p, portrait);

    // Expose portrait for external access
    p.portrait = portrait;
  });
}

// Initialize both portrait sketches
const khalidSketch = createPortraitSketch(PORTRAIT_CONFIG.khalid);
const mariaSketch = createPortraitSketch(PORTRAIT_CONFIG.maria);

// ============================================================================
// GLOBAL MOUSE TRACKING
// ============================================================================

/**
 * Single global mousemove listener for efficiency
 * Delegates to the appropriate portrait based on screen position
 */
document.addEventListener('mousemove', (event) => {
  const screenMidpoint = window.innerWidth / 2;

  if (event.clientX < screenMidpoint && khalidSketch.portrait) {
    khalidSketch.portrait.handleHover(event.clientX, event.clientY);
  } else if (event.clientX >= screenMidpoint && mariaSketch.portrait) {
    mariaSketch.portrait.handleHover(event.clientX, event.clientY);
  }
});
