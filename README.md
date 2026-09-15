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
- Normal jump height increased by 50% from the initial prototype
- Horizontal screen wrapping
- One-way platform collision using the previous frame position
- Layer-based endless generation with a physics-validated safe path
- Reachable optional platforms that create regular route choices
- Opening route choices safely rejoin the next guaranteed platform
- Controlled variation across platform height, spacing, and screen position
- Normal, horizontally moving, and breakable platforms
- Moving platforms have a 20% chance to also collapse after landing
- Extra normal platforms make the route more forgiving through 3,000 points
- Guaranteed Path platforms become breakable at a 25% rate from 8,000 points
- Spring items with a stronger jump and a 45% early / 30% late spawn chance
- Propeller Hats spawn from 8,000 points, decreasing from 15% to 5% by 12,000
- Jetpacks spawn from 6,000 points at 10%, decreasing to 5% from 8,000 to 12,000
- Power-up-aware spawn-ahead generation
- Upward-only camera scrolling
- Height-based score and locally saved best score
- Menu, gameplay, game-over, and stable restart states
- Responsive 480 × 720 Canvas rendering
- Delta-time clamping and off-screen object cleanup

## Run locally

No installation, package manager, build step, or local server is required. Double-click `index.html` and play in a modern desktop browser.

Run the deterministic platform-generation regression suite with Node.js:

```text
node platform-generation.test.js
node powerup.test.js
```

When served locally, `?platformDebug=1&platformSeed=example` labels guaranteed (`G`) and filler (`F`) platforms and reproduces the same layout. Debug display is disabled by default. Runtime power-up state and remaining flight distance are available through `window.speakiJump.getSnapshot()`.

## GitHub Pages

Play the deployed game at <https://gplexs.github.io/speaki-e-jump/>.

## Project structure

```text
speaki-e-jump/
├── assets/       # Reserved for user-provided graphics and audio
├── .nojekyll
├── game.js       # Game rules, physics, state, object management, and rendering
├── index.html
├── platform-generation.test.js
├── powerup.test.js
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
