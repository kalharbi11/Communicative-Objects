// Dotted Portrait - Interactive Editor Version
// Based on www.lomz.net - 2019

var subX = 0;
var subY = 0;
var dotXstart = 320;
var dotYstart = 327;
var rndMin = -10;
var rndMax = 10;
var nDots = 195;
var aliveSpeed = 0;
var aliveMaxSize = 2;
var aliveMinSize = 0.5;
var maxBrushSize = 7;
var minBrushSize = 1;
var alphaThreshold = 42;
var dotOpacity = 229;
var brightnessSensitivity = 1.6;
var colorMixAmount = 0.38;
var maxTotalDots = 40000;
var totalDotsDrawn = 0;
var isAliveMode = false;
var aliveFrameCount = 0; // Track frames in alive mode
var currentDotColor;
var currentBgColor;
var useImageColors = false;

var img;
var vScale = 2;

function preload() {
  img = loadImage('assets/self-portrait-example.png',
    () => {
      console.log('Image loaded successfully');
      document.body.insertAdjacentHTML('beforeend', '<div style="color:green;font-weight:bold;">Image loaded successfully</div>');
    },
    (err) => {
      console.error('Error loading image:', err);
      document.body.insertAdjacentHTML('beforeend', '<div style="color:red;font-weight:bold;">Error loading image: ' + err + '</div>');
    }
  );
}

function setup() {
  console.log('Setup started');
  let canvas = createCanvas(640, 654);
  canvas.parent('canvas-container');
  pixelDensity(2); // Reduced from 3 for better performance

  img.resize(width / vScale, height / vScale);
  console.log('Canvas created:', width, 'x', height);

  currentBgColor = color(255);
  currentDotColor = color(50);

  background(currentBgColor);
  noStroke();

  setupControls();
}

function draw() {
  // INITIAL FILLING PHASE: Fill up to maxTotalDots
  if (!isAliveMode && totalDotsDrawn < maxTotalDots) {
    img.loadPixels(); // Load once per frame, not per dot

    for (var i = 0; i < nDots; i++) {
      if (totalDotsDrawn >= maxTotalDots) {
        isAliveMode = true;
        console.log('Switched to alive mode');
        break;
      }

      var dotXPosition = dotXstart + subX;
      var dotYPosition = dotYstart + subY;

      subX += random(rndMin, rndMax);
      subY += random(rndMin, rndMax);

      var col = img.get(dotXPosition / vScale, dotYPosition / vScale);

      var alpha = col[3];
      if (alpha > alphaThreshold) {
        var rgb = col[0] + col[1] + col[2];
        var adjustedRgb = rgb * brightnessSensitivity;
        adjustedRgb = constrain(adjustedRgb, 0, 765);
        var brushSize = map(adjustedRgb, 0, 765, maxBrushSize, minBrushSize);

        var dotColor;
        if (useImageColors) {
          dotColor = color(col[0], col[1], col[2], dotOpacity);
        } else if (colorMixAmount > 0) {
          let r = lerp(red(currentDotColor), col[0], colorMixAmount);
          let g = lerp(green(currentDotColor), col[1], colorMixAmount);
          let b = lerp(blue(currentDotColor), col[2], colorMixAmount);
          dotColor = color(r, g, b, dotOpacity);
        } else {
          dotColor = color(red(currentDotColor), green(currentDotColor), blue(currentDotColor), dotOpacity);
        }

        fill(dotColor);
        circle(dotXPosition, dotYPosition, brushSize);

        totalDotsDrawn++;
      }

      // Boundary checks
      if (subX > 320) { subX = 0; subY = 0; }
      if (subX < -320) { subX = 0; subY = 0; }
      if (subY > 327) { subX = 0; subY = 0; }
      if (subY < -327) { subX = 0; subY = 0; }
    }
  }

  // ALIVE MODE: Continuously add dots with different parameters
  if (isAliveMode) {
    aliveFrameCount++;

    // Auto-pause after 600 frames (~10 seconds at 60fps) to save CPU
    if (aliveFrameCount > 600) {
      noLoop();
      console.log('Alive mode auto-paused for performance');
      return;
    }

    img.loadPixels(); // Load once per frame, not per dot

    for (var i = 0; i < aliveSpeed; i++) {
      // Random position anywhere on canvas
      var dotXPosition = random(width);
      var dotYPosition = random(height);

      var col = img.get(dotXPosition / vScale, dotYPosition / vScale);

      var alpha = col[3];
      if (alpha > alphaThreshold) {
        var rgb = col[0] + col[1] + col[2];
        var adjustedRgb = rgb * brightnessSensitivity;
        adjustedRgb = constrain(adjustedRgb, 0, 765);
        var brushSize = map(adjustedRgb, 0, 765, aliveMaxSize, aliveMinSize);

        var dotColor;
        if (useImageColors) {
          dotColor = color(col[0], col[1], col[2], dotOpacity);
        } else if (colorMixAmount > 0) {
          let r = lerp(red(currentDotColor), col[0], colorMixAmount);
          let g = lerp(green(currentDotColor), col[1], colorMixAmount);
          let b = lerp(blue(currentDotColor), col[2], colorMixAmount);
          dotColor = color(r, g, b, dotOpacity);
        } else {
          dotColor = color(red(currentDotColor), green(currentDotColor), blue(currentDotColor), dotOpacity);
        }

        fill(dotColor);
        circle(dotXPosition, dotYPosition, brushSize);
      }
    }
  }
}

function setupControls() {
  document.getElementById('dotsPerFrame').addEventListener('input', function() {
    nDots = parseInt(this.value);
    document.getElementById('dotsValue').textContent = nDots;
  });

  document.getElementById('aliveSpeed').addEventListener('input', function() {
    aliveSpeed = parseInt(this.value);
    document.getElementById('aliveSpeedValue').textContent = aliveSpeed;
  });

  document.getElementById('aliveMaxSize').addEventListener('input', function() {
    aliveMaxSize = parseFloat(this.value);
    document.getElementById('aliveMaxSizeValue').textContent = aliveMaxSize;
  });

  document.getElementById('aliveMinSize').addEventListener('input', function() {
    aliveMinSize = parseFloat(this.value);
    document.getElementById('aliveMinSizeValue').textContent = aliveMinSize;
  });

  document.getElementById('maxSize').addEventListener('input', function() {
    maxBrushSize = parseFloat(this.value);
    document.getElementById('maxSizeValue').textContent = maxBrushSize;
  });

  document.getElementById('minSize').addEventListener('input', function() {
    minBrushSize = parseFloat(this.value);
    document.getElementById('minSizeValue').textContent = minBrushSize;
  });

  document.getElementById('walkRange').addEventListener('input', function() {
    let range = parseInt(this.value);
    rndMin = -range;
    rndMax = range;
    document.getElementById('walkRangeValue').textContent = range;
  });

  document.getElementById('alphaThreshold').addEventListener('input', function() {
    alphaThreshold = parseInt(this.value);
    document.getElementById('alphaValue').textContent = alphaThreshold;
  });

  document.getElementById('dotOpacity').addEventListener('input', function() {
    dotOpacity = parseInt(this.value);
    document.getElementById('opacityValue').textContent = dotOpacity;
  });

  document.getElementById('brightnessSensitivity').addEventListener('input', function() {
    brightnessSensitivity = parseFloat(this.value);
    document.getElementById('sensitivityValue').textContent = brightnessSensitivity.toFixed(1);
  });

  document.getElementById('colorMix').addEventListener('input', function() {
    colorMixAmount = parseFloat(this.value);
    document.getElementById('colorMixValue').textContent = colorMixAmount.toFixed(2);
  });

  document.getElementById('maxTotalDots').addEventListener('input', function() {
    maxTotalDots = parseInt(this.value);
    document.getElementById('maxDotsValue').textContent = maxTotalDots.toLocaleString();
  });

  document.getElementById('dotColor').addEventListener('input', function() {
    currentDotColor = color(this.value);
  });

  document.getElementById('bgColor').addEventListener('input', function() {
    currentBgColor = color(this.value);
    background(currentBgColor);
  });

  document.getElementById('resetBtn').addEventListener('click', resetCanvas);

  document.getElementById('useOriginalColors').addEventListener('click', function() {
    useImageColors = !useImageColors;
    this.textContent = useImageColors ? 'Use Solid Color' : 'Use Image Colors';
  });

  document.getElementById('makeDefault').addEventListener('click', function() {
    saveSettings();
    // Visual feedback
    const originalText = this.textContent;
    this.textContent = 'Saved!';
    setTimeout(() => {
      this.textContent = originalText;
    }, 1500);
  });

  console.log('Controls initialized');

  // Load saved settings on startup
  loadSettings();
}

function resetCanvas() {
  background(currentBgColor);
  subX = 0;
  subY = 0;
  totalDotsDrawn = 0;
  isAliveMode = false;
  aliveFrameCount = 0;
  loop();
}

function saveSettings() {
  const settings = {
    nDots: nDots,
    aliveSpeed: aliveSpeed,
    aliveMaxSize: aliveMaxSize,
    aliveMinSize: aliveMinSize,
    maxBrushSize: maxBrushSize,
    minBrushSize: minBrushSize,
    rndRange: rndMax,
    alphaThreshold: alphaThreshold,
    dotOpacity: dotOpacity,
    brightnessSensitivity: brightnessSensitivity,
    colorMixAmount: colorMixAmount,
    maxTotalDots: maxTotalDots,
    useImageColors: useImageColors,
    dotColor: red(currentDotColor) + ',' + green(currentDotColor) + ',' + blue(currentDotColor),
    bgColor: red(currentBgColor) + ',' + green(currentBgColor) + ',' + blue(currentBgColor)
  };
  localStorage.setItem('dottedPortraitSettings', JSON.stringify(settings));
  console.log('Settings saved!');
}

function loadSettings() {
  const saved = localStorage.getItem('dottedPortraitSettings');
  if (!saved) {
    console.log('No saved settings found');
    return;
  }

  try {
    const settings = JSON.parse(saved);

    // Update variables
    nDots = settings.nDots || 195;
    aliveSpeed = settings.aliveSpeed || 50;
    aliveMaxSize = settings.aliveMaxSize || 2;
    aliveMinSize = settings.aliveMinSize || 0.5;
    maxBrushSize = settings.maxBrushSize || 7;
    minBrushSize = settings.minBrushSize || 1;
    rndMin = -(settings.rndRange || 10);
    rndMax = settings.rndRange || 10;
    alphaThreshold = settings.alphaThreshold || 42;
    dotOpacity = settings.dotOpacity || 229;
    brightnessSensitivity = settings.brightnessSensitivity || 0.6;
    colorMixAmount = settings.colorMixAmount || 0.38;
    maxTotalDots = settings.maxTotalDots || 40000;

    // Update useImageColors (default true)
    useImageColors = (settings.useImageColors !== undefined) ? settings.useImageColors : false;

    // Update colors
    if (settings.dotColor) {
      const dotRGB = settings.dotColor.split(',');
      currentDotColor = color(parseInt(dotRGB[0]), parseInt(dotRGB[1]), parseInt(dotRGB[2]));
    }
    if (settings.bgColor) {
      const bgRGB = settings.bgColor.split(',');
      currentBgColor = color(parseInt(bgRGB[0]), parseInt(bgRGB[1]), parseInt(bgRGB[2]));
    }

    // Update UI elements
    document.getElementById('dotsPerFrame').value = nDots;
    document.getElementById('dotsValue').textContent = nDots;

    document.getElementById('aliveSpeed').value = aliveSpeed;
    document.getElementById('aliveSpeedValue').textContent = aliveSpeed;

    document.getElementById('aliveMaxSize').value = aliveMaxSize;
    document.getElementById('aliveMaxSizeValue').textContent = aliveMaxSize;

    document.getElementById('aliveMinSize').value = aliveMinSize;
    document.getElementById('aliveMinSizeValue').textContent = aliveMinSize;

    document.getElementById('maxSize').value = maxBrushSize;
    document.getElementById('maxSizeValue').textContent = maxBrushSize;

    document.getElementById('minSize').value = minBrushSize;
    document.getElementById('minSizeValue').textContent = minBrushSize;

    document.getElementById('walkRange').value = rndMax;
    document.getElementById('walkRangeValue').textContent = rndMax;

    document.getElementById('alphaThreshold').value = alphaThreshold;
    document.getElementById('alphaValue').textContent = alphaThreshold;

    document.getElementById('dotOpacity').value = dotOpacity;
    document.getElementById('opacityValue').textContent = dotOpacity;

    document.getElementById('brightnessSensitivity').value = brightnessSensitivity;
    document.getElementById('sensitivityValue').textContent = brightnessSensitivity.toFixed(1);

    document.getElementById('colorMix').value = colorMixAmount;
    document.getElementById('colorMixValue').textContent = colorMixAmount.toFixed(2);

    document.getElementById('maxTotalDots').value = maxTotalDots;
    document.getElementById('maxDotsValue').textContent = maxTotalDots.toLocaleString();

    // Update button text based on useImageColors state
    document.getElementById('useOriginalColors').textContent = useImageColors ? 'Use Solid Color' : 'Use Image Colors';

    console.log('Settings loaded!');
  } catch (e) {
    console.error('Error loading settings:', e);
  }
}

function keyReleased() {
  if (key == 'r' || key == 'R') {
    resetCanvas();
  }
}
