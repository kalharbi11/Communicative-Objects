// Dotted Portrait - Modified to use static image
// Based on www.lomz.net - 2019

// Press R to reload canvas
// For save image: Right click > Save image as

var subX = 0;
var subY = 0;
var dotXstart = 320; // Dot start X position (half of canvas width)
var dotYstart = 327; // Dot start Y position (half of canvas height)
var rndMin = -10; // random MIN
var rndMax = 10; // random MAX
var nDots = 100; // number of dots
var maxBrushSize = 3; //max brush size
var minBrushSize = 0; // min brush size
var alphaThreshold = 50; // transparency threshold

var img;
var vScale = 2;

function preload() {
  // Load your image here
  img = loadImage('assets/portrait.png',
    () => console.log('Image loaded successfully'),
    (err) => console.error('Error loading image:', err)
  );
}

function setup() {
  console.log('Setup started');
  createCanvas(640, 654); // Match image aspect ratio 1011:1033
  pixelDensity(3);

  // Resize image to match canvas dimensions divided by scale
  img.resize(width / vScale, height / vScale);
  console.log('Canvas created:', width, 'x', height);
  console.log('Image resized to:', img.width, 'x', img.height);

  background(255); // White background
  noStroke();
}

function draw() {
  img.loadPixels();

  for (var i = 0; i < nDots; i++) {

    var dotXPosition = dotXstart + subX;
    var dotYPosition = dotYstart + subY;

    subX += random(rndMin, rndMax);
    subY += random(rndMin, rndMax);

    var col = img.get(dotXPosition / vScale, dotYPosition / vScale);

    // Check alpha channel - skip if transparent
    var alpha = col[3];
    if (alpha > alphaThreshold) { // Only draw if pixel is not transparent
      var rgb = col[0] + col[1] + col[2];

      var brushSize = map(rgb, 0, 765, maxBrushSize, minBrushSize);

      fill(50);
      circle(dotXPosition, dotYPosition, brushSize);
    }

    if (subX > 320) {
      subX = 0;
      subY = 0;
    }

    if (subX < -320) {
      subX = 0;
      subY = 0;
    }

    if (subY > 327) {
      subX = 0;
      subY = 0;
    }

    if (subY < -327) {
      subX = 0;
      subY = 0;
    }
  }
}

function keyReleased() {
  if (key == 'r' || key == 'R') {
    background(255); // White background
    subX = 0;
    subY = 0;
  }
}
