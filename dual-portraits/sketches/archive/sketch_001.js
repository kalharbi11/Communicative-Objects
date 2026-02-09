// Dotted Portrait - Locked Parameters Version
// Based on www.lomz.net - 2019
// Optimized for fixed parameters, automated effect

// ==== LOCKED PARAMETERS ====
const INITIAL_DOTS_PER_FRAME = 5000;
const MAX_TOTAL_DOTS = 24000;
const ALIVE_SPEED = 85;
const ALIVE_MAX_SIZE = 6;
const ALIVE_MIN_SIZE = 3;
const INITIAL_MAX_SIZE = 8;
const INITIAL_MIN_SIZE = 4;
const RANDOM_WALK_RANGE = 30;
const ALPHA_THRESHOLD = 126;
const DOT_OPACITY = 203;
const BRIGHTNESS_SENSITIVITY = 0.4;
const COLOR_MIX_AMOUNT = 0;
const USE_IMAGE_COLORS = true;

// ==== PHASE 2: Image swap variable (will be updated on hover) ====
let currentImagePath = 'assets/khalid-straight.png';

// ==== HOVER ZONES ====
let containerSize; // Responsive container size
let canvasX, canvasY; // Canvas position on page
let containerX, containerY; // Container position on page
const DEBUG_ZONES = false; // Set to false to hide debug visualization
let currentZone = 'center'; // Track current zone for debug

// ==== STATE VARIABLES ====
let subX = 0;
let subY = 0;
let totalDotsDrawn = 0;
let isAliveMode = false;
let aliveFrameCount = 0;
let img;
let vScale = 2;
let canvasSize = 600; // Will be adjusted for responsive

function preload() {
  img = loadImage(currentImagePath);
}

function setup() {
  // Calculate responsive canvas size (max 400px, scale down on smaller screens)
  let maxSize = Math.min(windowWidth * 0.9, windowHeight * 0.9, 400);
  canvasSize = maxSize;

  // Calculate container size (2x canvas for 800px when canvas is 400px)
  containerSize = canvasSize * 2;

  let canvas = createCanvas(canvasSize, canvasSize);
  canvas.parent('sketch-container');
  pixelDensity(2);

  // Resize image to fit canvas
  img.resize(canvasSize / vScale, canvasSize / vScale);

  background(255);
  noStroke();

  // Calculate canvas position on page for hover zones
  updateCanvasPosition();
}

// Update canvas position (called on setup and resize)
function updateCanvasPosition() {
  let canvasElement = document.querySelector('canvas');
  let rect = canvasElement.getBoundingClientRect();
  canvasX = rect.left + window.scrollX;
  canvasY = rect.top + window.scrollY;

  // Calculate container position (centered around canvas)
  let margin = (containerSize - canvasSize) / 2;
  containerX = canvasX - margin;
  containerY = canvasY - margin;
}

function draw() {
  // ==== PHASE 1: Initial Fill ====
  if (!isAliveMode && totalDotsDrawn < MAX_TOTAL_DOTS) {
    img.loadPixels();

    for (let i = 0; i < INITIAL_DOTS_PER_FRAME; i++) {
      if (totalDotsDrawn >= MAX_TOTAL_DOTS) {
        isAliveMode = true;
        break;
      }

      // Random walk algorithm
      let dotXPosition = canvasSize / 2 + subX;
      let dotYPosition = canvasSize / 2 + subY;

      subX += random(-RANDOM_WALK_RANGE, RANDOM_WALK_RANGE);
      subY += random(-RANDOM_WALK_RANGE, RANDOM_WALK_RANGE);

      // Sample image color
      let col = img.get(dotXPosition / vScale, dotYPosition / vScale);
      let alpha = col[3];

      if (alpha > ALPHA_THRESHOLD) {
        // Calculate dot size based on brightness
        let rgb = col[0] + col[1] + col[2];
        let adjustedRgb = rgb * BRIGHTNESS_SENSITIVITY;
        adjustedRgb = constrain(adjustedRgb, 0, 765);
        let brushSize = map(adjustedRgb, 0, 765, INITIAL_MAX_SIZE, INITIAL_MIN_SIZE);

        // Set color (using image colors as locked parameter)
        fill(col[0], col[1], col[2], DOT_OPACITY);
        circle(dotXPosition, dotYPosition, brushSize);

        totalDotsDrawn++;
      }

      // Reset walk if out of bounds
      if (subX > canvasSize / 2 || subX < -canvasSize / 2 ||
          subY > canvasSize / 2 || subY < -canvasSize / 2) {
        subX = 0;
        subY = 0;
      }
    }
  }

  // ==== PHASE 2: Alive Mode (subtle continuous details) ====
  if (isAliveMode) {
    aliveFrameCount++;

    // Auto-pause after 10 seconds for performance
    if (aliveFrameCount > 600) {
      noLoop();
      return;
    }

    img.loadPixels();

    for (let i = 0; i < ALIVE_SPEED; i++) {
      let dotXPosition = random(canvasSize);
      let dotYPosition = random(canvasSize);

      let col = img.get(dotXPosition / vScale, dotYPosition / vScale);
      let alpha = col[3];

      if (alpha > ALPHA_THRESHOLD) {
        let rgb = col[0] + col[1] + col[2];
        let adjustedRgb = rgb * BRIGHTNESS_SENSITIVITY;
        adjustedRgb = constrain(adjustedRgb, 0, 765);
        let brushSize = map(adjustedRgb, 0, 765, ALIVE_MAX_SIZE, ALIVE_MIN_SIZE);

        fill(col[0], col[1], col[2], DOT_OPACITY);
        circle(dotXPosition, dotYPosition, brushSize);
      }
    }
  }

  // Debug: Draw zone boundaries
  if (DEBUG_ZONES) {
    drawZoneDebug();
  }
}

// Draw visual representation of zones for debugging
function drawZoneDebug() {
  push();

  // Draw container rectangle
  stroke(0, 255, 0, 150);
  strokeWeight(3);
  noFill();

  // Convert container to canvas-relative coordinates
  let margin = (containerSize - canvasSize) / 2;
  rect(-margin, -margin, containerSize, containerSize);

  // Draw center zone rectangle (canvas - red)
  stroke(255, 0, 0, 150);
  strokeWeight(3);
  rect(0, 0, canvasSize, canvasSize);

  // Draw zone labels
  textSize(20);
  fill(0);
  noStroke();

  // Left zone label
  text('LEFT', -margin + 50, canvasSize / 2);

  // Right zone label
  text('RIGHT', canvasSize + 20, canvasSize / 2);

  // Top zone label
  text('UP', canvasSize / 2 - 20, -margin + 30);

  // Bottom zone label
  text('DOWN', canvasSize / 2 - 30, canvasSize + margin - 20);

  // Center label
  text('CENTER', canvasSize / 2 - 50, canvasSize / 2);

  // Draw crosshair at canvas center
  stroke(0, 0, 255, 150);
  strokeWeight(1);
  line(canvasSize/2 - 20, canvasSize/2, canvasSize/2 + 20, canvasSize/2);
  line(canvasSize/2, canvasSize/2 - 20, canvasSize/2, canvasSize/2 + 20);

  // Display current zone as text
  textSize(16);
  fill(0);
  noStroke();
  text(`Mouse: ${winMouseX.toFixed(0)}, ${winMouseY.toFixed(0)}`, 10, 20);
  text(`Canvas: ${canvasSize}px at (${canvasX.toFixed(0)}, ${canvasY.toFixed(0)})`, 10, 40);
  text(`Container: ${containerSize.toFixed(0)}px at (${containerX.toFixed(0)}, ${containerY.toFixed(0)})`, 10, 60);
  text(`Window: ${windowWidth} x ${windowHeight}`, 10, 80);
  text(`Current zone: ${currentZone}`, 10, 100);
  text(`Current image: ${currentImagePath.split('/').pop()}`, 10, 120);

  pop();
}

// ==== PHASE 2: Helper function to swap image (called on hover) ====
function swapImage(imagePath) {
  if (currentImagePath !== imagePath) {
    currentImagePath = imagePath;
    loadImage(currentImagePath, (loadedImg) => {
      img = loadedImg;
      img.resize(canvasSize / vScale, canvasSize / vScale);
      resetEffect();
    });
  }
}

function resetEffect() {
  background(255);
  subX = 0;
  subY = 0;
  totalDotsDrawn = 0;
  isAliveMode = false;
  aliveFrameCount = 0;
  loop();
}

// ==== HOVER ZONE DETECTION ====
function mouseMoved() {
  // Use window mouse coordinates
  let mx = winMouseX;
  let my = winMouseY;

  // Calculate container boundaries
  let containerLeft = containerX;
  let containerRight = containerX + containerSize;
  let containerTop = containerY;
  let containerBottom = containerY + containerSize;

  // Calculate canvas (center zone) boundaries
  let centerLeft = canvasX;
  let centerRight = canvasX + canvasSize;
  let centerTop = canvasY;
  let centerBottom = canvasY + canvasSize;

  // Check if outside container - default image
  if (mx < containerLeft || mx > containerRight ||
      my < containerTop || my > containerBottom) {
    currentZone = 'outside (center)';
    swapImage('assets/khalid-straight.png');
  }
  // Check if inside center zone - default image
  else if (mx >= centerLeft && mx <= centerRight &&
           my >= centerTop && my <= centerBottom) {
    currentZone = 'center';
    swapImage('assets/khalid-straight.png');
  }
  // Inside container but outside center - check which zone
  else {
    // Determine priority: check which edge is closest
    let distLeft = mx - containerLeft;
    let distRight = containerRight - mx;
    let distTop = my - containerTop;
    let distBottom = containerBottom - my;

    // Find minimum distance to determine which zone
    let minDist = Math.min(distLeft, distRight, distTop, distBottom);

    if (minDist === distLeft) {
      // Left zone
      currentZone = 'left';
      swapImage('assets/khalid-left.png');
    } else if (minDist === distRight) {
      // Right zone
      currentZone = 'right';
      swapImage('assets/khalid-right.png');
    } else if (minDist === distTop) {
      // Up zone
      currentZone = 'up';
      swapImage('assets/khalid-up.png');
    } else {
      // Down zone
      currentZone = 'down';
      swapImage('assets/khalid-down.png');
    }
  }
}

// Helper: Calculate cross product to determine which side of a line a point is on
// Returns positive if point (px, py) is to the left of line from (x1,y1) to (x2,y2)
function crossProduct(x1, y1, x2, y2, px, py) {
  return (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1);
}

// Helper: Check if point (px, py) is above the line from (x1, y1) to (x2, y2)
function isPointAboveLine(px, py, x1, y1, x2, y2) {
  // Use cross product to determine which side of the line the point is on
  // Positive = above/left, Negative = below/right
  return ((x2 - x1) * (py - y1) - (y2 - y1) * (px - x1)) < 0;
}

// Handle window resize
function windowResized() {
  let maxSize = Math.min(windowWidth * 0.9, windowHeight * 0.9, 400);
  if (canvasSize !== maxSize) {
    canvasSize = maxSize;
    containerSize = canvasSize * 2; // Recalculate container size (800px when canvas is 400px)
    resizeCanvas(canvasSize, canvasSize);
    img.resize(canvasSize / vScale, canvasSize / vScale);
    updateCanvasPosition(); // Update position after resize
    resetEffect();
  }
}
