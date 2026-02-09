// Dual Dotted Portrait - Khalid & Maria
// Based on www.lomz.net - 2019
// Two independent portraits with hover effect

console.log('sketch.js loaded');

// ==== CONFIGURATION FOR EACH PERSON ====
const PEOPLE = {
  khalid: {
    name: 'khalid',
    containerId: 'khalid-sketch-container',
    straightImage: 'assets/khalid-straight.png',
    leftImage: 'assets/khalid-left.png',
    rightImage: 'assets/khalid-right.png',
    upImage: 'assets/khalid-up.png',
    downImage: 'assets/khalid-down.png',
    side: 'left'
  },
  maria: {
    name: 'maria',
    containerId: 'maria-sketch-container',
    straightImage: 'assets/maria-straight.png',
    leftImage: 'assets/maria-left.png',
    rightImage: 'assets/maria-right.png',
    upImage: 'assets/maria-up.png',
    downImage: 'assets/maria-down.png',
    side: 'right'
  }
};

// ==== LOCKED PARAMETERS (same for both) ====
const INITIAL_DOTS_PER_FRAME = 5000;
const MAX_TOTAL_DOTS = 6000;
const SKIP_INITIAL_FILL = true;
const DRAW_STATIC_BASE = true;
const ALIVE_SPEED = 80;
const ALIVE_MAX_SIZE = 7;
const ALIVE_MIN_SIZE = 5;
const INITIAL_MAX_SIZE = 7;
const INITIAL_MIN_SIZE = 2;
const RANDOM_WALK_RANGE = 30;
const ALPHA_THRESHOLD = 126;
const DOT_OPACITY = 200;
const BRIGHTNESS_SENSITIVITY = 0.5;
const USE_IMAGE_COLORS = true;

// ==== PERSON STATE CLASS ====
class PersonState {
  constructor(config, pInstance) {
    this.config = config;
    this.p = pInstance; // Store reference to p5 instance
    this.currentImagePath = config.straightImage;

    // State variables
    this.subX = 0;
    this.subY = 0;
    this.totalDotsDrawn = 0;
    this.isAliveMode = SKIP_INITIAL_FILL;
    this.aliveFrameCount = 0;
    this.img = null;

    // Hover zones
    this.containerSize = 0;
    this.canvasX = 0;
    this.canvasY = 0;
    this.containerX = 0;
    this.containerY = 0;
    this.currentZone = 'center';

    // Canvas reference
    this.canvas = null;
    this.canvasSize = 600;
    this.vScale = 2;
  }

  resetEffect() {
    // Redraw the static base with the new image
    this.p.background(255);
    if (DRAW_STATIC_BASE && this.img) {
      this.p.image(this.img, 0, 0, this.canvasSize, this.canvasSize);
    }

    // Reset animation state
    this.subX = 0;
    this.subY = 0;
    this.totalDotsDrawn = 0;
    this.isAliveMode = SKIP_INITIAL_FILL;
    this.aliveFrameCount = 0;

    // IMPORTANT: Restart the draw loop in case it was stopped by previous animation
    this.p.loop();
  }

  swapImage(imagePath) {
    if (this.currentImagePath !== imagePath) {
      console.log(`${this.config.name} - Swapping to ${imagePath}`);
      this.currentImagePath = imagePath;
      // Use p5 instance's loadImage
      this.p.loadImage(imagePath, (loadedImg) => {
        console.log(`${this.config.name} - Image loaded: ${imagePath}`);
        this.img = loadedImg;
        this.img.resize(this.canvasSize / this.vScale, this.canvasSize / this.vScale);
        this.resetEffect();
      });
    }
  }

  updateCanvasPosition() {
    let canvasElement = document.querySelector(`#${this.config.containerId} canvas`);
    if (canvasElement) {
      let rect = canvasElement.getBoundingClientRect();
      this.canvasX = rect.left + window.scrollX;
      this.canvasY = rect.top + window.scrollY;

      let margin = (this.containerSize - this.canvasSize) / 2;
      this.containerX = this.canvasX - margin;
      this.containerY = this.canvasY - margin;
    } else {
      console.warn(`${this.config.name} - Canvas element not found for #${this.config.containerId}`);
    }
  }

  checkHover(mx, my) {
    this.updateCanvasPosition();

    let containerLeft = this.containerX;
    let containerRight = this.containerX + this.containerSize;
    let containerTop = this.containerY;
    let containerBottom = this.containerY + this.containerSize;

    let centerLeft = this.canvasX;
    let centerRight = this.canvasX + this.canvasSize;
    let centerTop = this.canvasY;
    let centerBottom = this.canvasY + this.canvasSize;

    if (mx < containerLeft || mx > containerRight ||
        my < containerTop || my > containerBottom) {
      this.currentZone = 'outside (center)';
      this.swapImage(this.config.straightImage);
    } else if (mx >= centerLeft && mx <= centerRight &&
               my >= centerTop && my <= centerBottom) {
      this.currentZone = 'center';
      this.swapImage(this.config.straightImage);
    } else {
      let distLeft = mx - containerLeft;
      let distRight = containerRight - mx;
      let distTop = my - containerTop;
      let distBottom = containerBottom - my;

      let minDist = Math.min(distLeft, distRight, distTop, distBottom);

      if (minDist === distLeft) {
        this.currentZone = 'left';
        this.swapImage(this.config.leftImage);
      } else if (minDist === distRight) {
        this.currentZone = 'right';
        this.swapImage(this.config.rightImage);
      } else if (minDist === distTop) {
        this.currentZone = 'up';
        this.swapImage(this.config.upImage);
      } else {
        this.currentZone = 'down';
        this.swapImage(this.config.downImage);
      }
    }
  }
}

// ==== CREATE SKETCH FOR KHALID (LEFT) ====
let khalidSketch = new p5((p) => {
  let person = new PersonState(PEOPLE.khalid, p);

  // Global mouse tracking for khalid
  document.addEventListener('mousemove', (e) => {
    if (e.clientX < window.innerWidth / 2) {
      person.checkHover(e.clientX, e.clientY);
      console.log('Khalid hover (global):', person.currentZone, e.clientX);
    }
  });

  p.preload = function() {
    console.log('Khalid preload - loading', person.currentImagePath);
    person.img = p.loadImage(person.currentImagePath);
  };

  p.setup = function() {
    console.log('Khalid setup');
    let maxSize = Math.min(p.windowWidth * 0.45, p.windowHeight * 0.9, 350);
    person.canvasSize = maxSize;
    person.containerSize = person.canvasSize * 2;

    let canvas = p.createCanvas(person.canvasSize, person.canvasSize);
    canvas.parent(person.config.containerId);
    p.pixelDensity(2);

    person.img.resize(person.canvasSize / person.vScale, person.canvasSize / person.vScale);

    p.background(255);
    if (DRAW_STATIC_BASE && person.img) {
      p.image(person.img, 0, 0, person.canvasSize, person.canvasSize);
    }
    p.noStroke();

    person.updateCanvasPosition();
  };

  p.draw = function() {
    // ==== PHASE 1: Initial Fill ====
    if (!person.isAliveMode && person.totalDotsDrawn < MAX_TOTAL_DOTS) {
      person.img.loadPixels();

      for (let i = 0; i < INITIAL_DOTS_PER_FRAME; i++) {
        if (person.totalDotsDrawn >= MAX_TOTAL_DOTS) {
          person.isAliveMode = true;
          break;
        }

        let dotXPosition = person.canvasSize / 2 + person.subX;
        let dotYPosition = person.canvasSize / 2 + person.subY;

        person.subX += p.random(-RANDOM_WALK_RANGE, RANDOM_WALK_RANGE);
        person.subY += p.random(-RANDOM_WALK_RANGE, RANDOM_WALK_RANGE);

        let col = person.img.get(dotXPosition / person.vScale, dotYPosition / person.vScale);
        let alpha = col[3];

        if (alpha > ALPHA_THRESHOLD) {
          let rgb = col[0] + col[1] + col[2];
          let adjustedRgb = rgb * BRIGHTNESS_SENSITIVITY;
          adjustedRgb = p.constrain(adjustedRgb, 0, 765);
          let brushSize = p.map(adjustedRgb, 0, 765, INITIAL_MAX_SIZE, INITIAL_MIN_SIZE);

          p.fill(col[0], col[1], col[2], DOT_OPACITY);
          p.circle(dotXPosition, dotYPosition, brushSize);

          person.totalDotsDrawn++;
        }

        if (person.subX > person.canvasSize / 2 || person.subX < -person.canvasSize / 2 ||
            person.subY > person.canvasSize / 2 || person.subY < -person.canvasSize / 2) {
          person.subX = 0;
          person.subY = 0;
        }
      }
    }

    // ==== PHASE 2: Alive Mode ====
    if (person.isAliveMode) {
      person.aliveFrameCount++;

      if (person.aliveFrameCount > 600) {
        p.noLoop();
        return;
      }

      person.img.loadPixels();

      for (let i = 0; i < ALIVE_SPEED; i++) {
        let dotXPosition = p.random(person.canvasSize);
        let dotYPosition = p.random(person.canvasSize);

        let col = person.img.get(dotXPosition / person.vScale, dotYPosition / person.vScale);
        let alpha = col[3];

        if (alpha > ALPHA_THRESHOLD) {
          let rgb = col[0] + col[1] + col[2];
          let adjustedRgb = rgb * BRIGHTNESS_SENSITIVITY;
          adjustedRgb = p.constrain(adjustedRgb, 0, 765);
          let brushSize = p.map(adjustedRgb, 0, 765, ALIVE_MAX_SIZE, ALIVE_MIN_SIZE);

          p.fill(col[0], col[1], col[2], DOT_OPACITY);
          p.circle(dotXPosition, dotYPosition, brushSize);
        }
      }
    }
  };

  p.windowResized = function() {
    let maxSize = Math.min(p.windowWidth * 0.45, p.windowHeight * 0.9, 350);
    if (person.canvasSize !== maxSize) {
      person.canvasSize = maxSize;
      person.containerSize = person.canvasSize * 2;
      p.resizeCanvas(person.canvasSize, person.canvasSize);
      person.img.resize(person.canvasSize / person.vScale, person.canvasSize / person.vScale);
      person.updateCanvasPosition();
      person.resetEffect();

      p.background(255);
      if (DRAW_STATIC_BASE && person.img) {
        p.image(person.img, 0, 0, person.canvasSize, person.canvasSize);
      }
      p.loop();
    }
  };
});

// ==== CREATE SKETCH FOR MARIA (RIGHT) ====
let mariaSketch = new p5((p) => {
  let person = new PersonState(PEOPLE.maria, p);

  // Global mouse tracking for maria
  document.addEventListener('mousemove', (e) => {
    if (e.clientX >= window.innerWidth / 2) {
      person.checkHover(e.clientX, e.clientY);
      console.log('Maria hover (global):', person.currentZone, e.clientX);
    }
  });

  p.preload = function() {
    console.log('Maria preload - loading', person.currentImagePath);
    person.img = p.loadImage(person.currentImagePath);
  };

  p.setup = function() {
    console.log('Maria setup');
    let maxSize = Math.min(p.windowWidth * 0.45, p.windowHeight * 0.9, 350);
    person.canvasSize = maxSize;
    person.containerSize = person.canvasSize * 2;

    let canvas = p.createCanvas(person.canvasSize, person.canvasSize);
    canvas.parent(person.config.containerId);
    p.pixelDensity(2);

    person.img.resize(person.canvasSize / person.vScale, person.canvasSize / person.vScale);

    p.background(255);
    if (DRAW_STATIC_BASE && person.img) {
      p.image(person.img, 0, 0, person.canvasSize, person.canvasSize);
    }
    p.noStroke();

    person.updateCanvasPosition();
  };

  p.draw = function() {
    // ==== PHASE 1: Initial Fill ====
    if (!person.isAliveMode && person.totalDotsDrawn < MAX_TOTAL_DOTS) {
      person.img.loadPixels();

      for (let i = 0; i < INITIAL_DOTS_PER_FRAME; i++) {
        if (person.totalDotsDrawn >= MAX_TOTAL_DOTS) {
          person.isAliveMode = true;
          break;
        }

        let dotXPosition = person.canvasSize / 2 + person.subX;
        let dotYPosition = person.canvasSize / 2 + person.subY;

        person.subX += p.random(-RANDOM_WALK_RANGE, RANDOM_WALK_RANGE);
        person.subY += p.random(-RANDOM_WALK_RANGE, RANDOM_WALK_RANGE);

        let col = person.img.get(dotXPosition / person.vScale, dotYPosition / person.vScale);
        let alpha = col[3];

        if (alpha > ALPHA_THRESHOLD) {
          let rgb = col[0] + col[1] + col[2];
          let adjustedRgb = rgb * BRIGHTNESS_SENSITIVITY;
          adjustedRgb = p.constrain(adjustedRgb, 0, 765);
          let brushSize = p.map(adjustedRgb, 0, 765, INITIAL_MAX_SIZE, INITIAL_MIN_SIZE);

          p.fill(col[0], col[1], col[2], DOT_OPACITY);
          p.circle(dotXPosition, dotYPosition, brushSize);

          person.totalDotsDrawn++;
        }

        if (person.subX > person.canvasSize / 2 || person.subX < -person.canvasSize / 2 ||
            person.subY > person.canvasSize / 2 || person.subY < -person.canvasSize / 2) {
          person.subX = 0;
          person.subY = 0;
        }
      }
    }

    // ==== PHASE 2: Alive Mode ====
    if (person.isAliveMode) {
      person.aliveFrameCount++;

      if (person.aliveFrameCount > 600) {
        p.noLoop();
        return;
      }

      person.img.loadPixels();

      for (let i = 0; i < ALIVE_SPEED; i++) {
        let dotXPosition = p.random(person.canvasSize);
        let dotYPosition = p.random(person.canvasSize);

        let col = person.img.get(dotXPosition / person.vScale, dotYPosition / person.vScale);
        let alpha = col[3];

        if (alpha > ALPHA_THRESHOLD) {
          let rgb = col[0] + col[1] + col[2];
          let adjustedRgb = rgb * BRIGHTNESS_SENSITIVITY;
          adjustedRgb = p.constrain(adjustedRgb, 0, 765);
          let brushSize = p.map(adjustedRgb, 0, 765, ALIVE_MAX_SIZE, ALIVE_MIN_SIZE);

          p.fill(col[0], col[1], col[2], DOT_OPACITY);
          p.circle(dotXPosition, dotYPosition, brushSize);
        }
      }
    }
  };

  p.windowResized = function() {
    let maxSize = Math.min(p.windowWidth * 0.45, p.windowHeight * 0.9, 350);
    if (person.canvasSize !== maxSize) {
      person.canvasSize = maxSize;
      person.containerSize = person.canvasSize * 2;
      p.resizeCanvas(person.canvasSize, person.canvasSize);
      person.img.resize(person.canvasSize / person.vScale, person.canvasSize / person.vScale);
      person.updateCanvasPosition();
      person.resetEffect();

      p.background(255);
      if (DRAW_STATIC_BASE && person.img) {
        p.image(person.img, 0, 0, person.canvasSize, person.canvasSize);
      }
      p.loop();
    }
  };
});
