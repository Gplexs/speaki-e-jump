# Speaki-e Jump

Speaki-e Jump is a playable, endless vertical-jumping web game prototype. The current version focuses on gameplay systems and stability; its simple shapes and colors are temporary development graphics.

## Controls

- Move left: `A` or `Left Arrow`
- Move right: `D` or `Right Arrow`
- Start: `Enter`, `Space`, or click the canvas
- Restart after game over: `R`, `Enter`, `Space`, or click the canvas

The player jumps automatically whenever it lands on a platform.

## Implemented features

- Accelerated horizontal movement with friction and air control
- Horizontal screen wrapping
- One-way platform collision using the previous frame position
- Reachability-aware endless platform generation
- Normal, horizontally moving, and breakable platforms
- Spring items with a stronger jump
- Upward-only camera scrolling
- Height-based score and locally saved best score
- Menu, gameplay, game-over, and stable restart states
- Responsive 480 × 720 Canvas rendering
- Delta-time clamping and off-screen object cleanup

## Run locally

No installation, package manager, build step, or local server is required. Double-click `index.html` and play in a modern desktop browser.

## GitHub Pages

The public GitHub Pages URL will be added here after the repository is published and deployment is verified.

## Project structure

```text
speaki-e-jump/
├── assets/       # Reserved for user-provided graphics and audio
├── .nojekyll
├── game.js       # Game rules, physics, state, object management, and rendering
├── index.html
├── README.md
└── style.css
```

## Technology

- HTML5
- CSS
- Vanilla JavaScript
- HTML5 Canvas API

There are no external libraries, CDN dependencies, npm packages, modules, or build tools.

## Asset status

Final character art, platforms, items, backgrounds, UI, animation, sound effects, and music are intentionally not included yet. Game logic and rendering are separated so user-provided assets can be integrated in a later design phase without rewriting the core physics and rules.
