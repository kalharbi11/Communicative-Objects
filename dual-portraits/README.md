# Interactive Portrait - Dotted Effect

An interactive dotted portrait effect using p5.js. Features 5 hover zones that switch between different portrait angles.

## Features

- **Dotted Effect**: Portraits are drawn using dots that fill in from the center
- **Responsive Design**: Scales proportionally based on screen size (max 400px)
- **Hover Zones**: 5 interactive zones (center, left, right, up, down)
- **Alive Mode**: Subtle continuous animation after initial fill

## Locked Parameters

- `INITIAL_DOTS_PER_FRAME`: 5000
- `MAX_TOTAL_DOTS`: 24000
- `ALIVE_SPEED`: 85
- `BRIGHTNESS_SENSITIVITY`: 0.4
- `DOT_OPACITY`: 203
- Canvas: Max 400px, responsive

## Files

- `index.html` - HTML structure
- `sketch.js` - p5.js sketch with rendering logic
- `style.css` - Responsive layout
- `assets/` - Portrait images (5 variants)

## Local Development

Use VS Code Five Server extension to test locally with `index.html`
