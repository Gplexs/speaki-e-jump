"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const gamePath = path.join(__dirname, "game.js");
const rawSource = fs.readFileSync(gamePath, "utf8");
const canvasMarker = '  const canvas = document.getElementById("gameCanvas");';
const gameMarker = "  const game = new Game(canvas);";

assert(rawSource.includes(canvasMarker), "game.js bootstrap marker changed");
assert(rawSource.includes(gameMarker), "game.js Game bootstrap marker changed");

const instrumentedSource = rawSource
  .replace(
    canvasMarker,
    `  window.__monsterTestInternals = Object.freeze({
    GameConfig,
    GameState,
    PlatformType,
    ItemType,
    MonsterType,
    RandomSource,
    PlatformPhysics,
    Player,
    Platform,
    Monster,
    DifficultyManager,
    PlatformManager,
    MonsterManager,
    Game
  });

${canvasMarker}`
  )
  .replace(gameMarker, `${gameMarker}\n  window.__monsterTestGame = game;`);

const noop = () => {};

function loadBrowserHarness(seed = "monster-tests") {
  let clock = 0;
  let nextAnimationFrameId = 1;
  const animationFrames = new Map();
  const storage = new Map();
  const context2d = {
    beginPath: noop,
    clearRect: noop,
    closePath: noop,
    fill: noop,
    fillRect: noop,
    fillText: noop,
    lineTo: noop,
    moveTo: noop,
    rotate: noop,
    restore: noop,
    save: noop,
    setTransform: noop,
    stroke: noop,
    strokeRect: noop,
    translate: noop
  };
  const canvas = {
    addEventListener: noop,
    focus: noop,
    getContext: () => context2d,
    height: 1280,
    width: 720
  };
  const sandbox = {
    URLSearchParams,
    console: { debug: noop, error: noop, info: noop, log: noop, warn: noop },
    document: { getElementById: (id) => id === "gameCanvas" ? canvas : null },
    localStorage: {
      getItem: (key) => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value))
    },
    location: { search: `?platformSeed=${encodeURIComponent(seed)}` },
    performance: { now: () => clock },
    requestAnimationFrame(callback) {
      const id = nextAnimationFrameId;
      nextAnimationFrameId += 1;
      animationFrames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      animationFrames.delete(id);
    },
    addEventListener: noop,
    removeEventListener: noop
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(
    'Math.random = () => { throw new Error("Seeded code leaked to Math.random"); };',
    sandbox
  );
  vm.runInContext(instrumentedSource, sandbox, { filename: gamePath });

  return {
    canvas,
    game: sandbox.__monsterTestGame,
    internals: sandbox.__monsterTestInternals
  };
}

function approximately(actual, expected, tolerance = 1e-7, message = "") {
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${message || "values differ"}: expected ${expected}, received ${actual}`
  );
}

const harness = loadBrowserHarness();
const {
  GameConfig,
  GameState,
  PlatformType,
  ItemType,
  MonsterType,
  Player,
  Platform,
  Monster,
  DifficultyManager,
  PlatformManager,
  MonsterManager,
  Game
} = harness.internals;

function makePlatform({
  x = 100,
  y = 400,
  width = 110,
  type = PlatformType.NORMAL,
  layerIndex = 1,
  isGuaranteed = false,
  moveRange = 0,
  moveSpeed = 0
} = {}) {
  const platform = new Platform(
    x,
    y,
    width,
    type,
    moveRange,
    moveSpeed,
    { next: () => 0.75 }
  );
  platform.layerIndex = layerIndex;
  platform.isGuaranteed = isGuaranteed;
  return platform;
}

function makeMonster(x = 150, y = 300, moveRange = 0, moveSpeed = 0) {
  return new Monster(
    x,
    y,
    MonsterType.BASIC_HOVER_MONSTER,
    moveRange,
    moveSpeed,
    1
  );
}

function makeGame() {
  const game = new Game(harness.canvas);
  game.state = GameState.PLAYING;
  return game;
}

const tests = [];
let spawnValidationReport = null;
function test(name, callback) {
  tests.push({ name, callback });
}

test("BASIC_HOVER_MONSTER structure, difficulty, and movement are deterministic", () => {
  const difficulty = new DifficultyManager();
  assert.equal(difficulty.getMonsterSettings(3999).spawnChance, 0);
  approximately(difficulty.getMonsterSettings(4000).spawnChance, 0.06);
  approximately(difficulty.getMonsterSettings(8000).spawnChance, 0.1);
  approximately(difficulty.getMonsterSettings(12000).spawnChance, 0.14);
  approximately(difficulty.getMonsterSettings(20000).spawnChance, 0.14);
  assert.equal(GameConfig.maxVisibleMonsters, 3);

  const endpoints = [];
  for (const framesPerSecond of [30, 60, 144]) {
    const monster = makeMonster(
      200,
      100,
      GameConfig.monsterMoveRange,
      GameConfig.monsterMoveSpeed
    );
    assert.equal(monster.type, MonsterType.BASIC_HOVER_MONSTER);
    for (let frame = 0; frame < framesPerSecond * 5; frame += 1) {
      monster.update(1 / framesPerSecond);
      assert(monster.x >= monster.moveMin - 1e-9);
      assert(monster.x <= monster.moveMax + 1e-9);
    }
    endpoints.push(monster.x);
  }
  for (const endpoint of endpoints.slice(1)) {
    approximately(endpoint, endpoints[0], 1e-6, "movement changed with FPS");
  }

  const monster = makeMonster();
  assert.equal(monster.kill(), true);
  assert.equal(monster.kill(), false, "a monster must only be removed once");
});

test("route validation allows danger but rejects complete route closure", () => {
  const difficulty = new DifficultyManager();
  const platforms = new PlatformManager(difficulty, { seed: "route-validation" });
  platforms.reset(0, false);
  const monsters = new MonsterManager(difficulty, platforms, {
    seed: "route-validation"
  });

  const source = makePlatform({ x: 180, y: 500, width: 120, layerIndex: 0 });
  const guaranteed = makePlatform({
    x: 90,
    y: 400,
    width: 100,
    layerIndex: 1,
    isGuaranteed: true
  });
  platforms.platforms = [source, guaranteed];

  const guaranteedBlocker = makeMonster(100, 330, 44, 64);
  guaranteedBlocker.spawnLayer = 1;
  assert.equal(monsters.getReachablePlatforms(1).length, 1);
  assert.equal(
    monsters.wouldBlockAllReachableRoutes(guaranteedBlocker, 1),
    true,
    "the only landing route was allowed to be fully blocked"
  );

  const filler = makePlatform({ x: 290, y: 400, width: 100, layerIndex: 1 });
  platforms.platforms.push(filler);
  assert.equal(monsters.getReachablePlatforms(1).length, 2);
  assert.equal(
    monsters.wouldBlockAllReachableRoutes(guaranteedBlocker, 1),
    false,
    "a dangerous Guaranteed placement should be allowed when another route exists"
  );

  monsters.monsters.push(guaranteedBlocker);
  const fillerBlocker = makeMonster(300, 330, 44, 64);
  fillerBlocker.spawnLayer = 1;
  assert.equal(
    monsters.wouldBlockAllReachableRoutes(fillerBlocker, 1),
    true,
    "combined monsters were allowed to close every route"
  );

  monsters.monsters.length = 0;
  const wideLanding = makePlatform({
    x: 90,
    y: 400,
    width: 290,
    layerIndex: 1,
    isGuaranteed: true
  });
  platforms.platforms = [source, wideLanding];
  assert.equal(
    monsters.wouldBlockAllReachableRoutes(guaranteedBlocker, 1),
    false,
    "wide left/right avoidance space should remain solvable"
  );

  const stompTarget = makePlatform({
    x: 160,
    y: 400,
    width: 120,
    layerIndex: 1,
    isGuaranteed: true
  });
  platforms.platforms = [source, stompTarget];
  const stompableBlocker = makeMonster(200, 360, 44, 64);
  stompableBlocker.spawnLayer = 1;
  assert.equal(monsters.hasStompOption(stompableBlocker, [source]), true);
  assert.equal(
    monsters.wouldBlockAllReachableRoutes(stompableBlocker, 1),
    false,
    "a realistic stomp option should keep the route solvable"
  );
});

test("spawn-ahead generation is bounded, non-overlapping, and never closes all routes", () => {
  const scoreBands = [4000, 6000, 8000, 12000, 20000];
  let totalSpawned = 0;
  let totalSkipped = 0;
  let totalBlockedRoutesPrevented = 0;
  let guaranteedAnchors = 0;
  let maximumActive = 0;

  for (const score of scoreBands) {
    for (let seedIndex = 0; seedIndex < 32; seedIndex += 1) {
      const seed = `monster-stress-${score}-${seedIndex}`;
      const difficulty = new DifficultyManager();
      const platforms = new PlatformManager(difficulty, { seed, debugEnabled: false });
      const monsters = new MonsterManager(difficulty, platforms, { seed });
      platforms.reset(0, false);
      monsters.reset();

      for (let layerIndex = 0; layerIndex < 90; layerIndex += 1) {
        const layer = platforms.generateNextLayer(score);
        const spawned = monsters.trySpawnForLayer(layer);
        if (spawned) {
          assert(spawned.y + spawned.height <= -GameConfig.monsterMinimumSpawnLead);
          const range = monsters.getMonsterMovementRange(spawned);
          assert(range.left >= GameConfig.sidePadding - 1e-6);
          assert(range.right <= GameConfig.width - GameConfig.sidePadding + 1e-6);
          assert.equal(monsters.overlapsPlatform(spawned), false);
          assert.equal(monsters.overlapsItem(spawned), false);
          assert.equal(monsters.overlapsOtherMonster(spawned), false);
          assert.equal(
            monsters.wouldBlockAllReachableRoutes(spawned, spawned.spawnLayer),
            false,
            `spawned impossible route at score ${score}, seed ${seedIndex}`
          );
          if (spawned.anchorIsGuaranteed) {
            guaranteedAnchors += 1;
          }
        }
        maximumActive = Math.max(
          maximumActive,
          monsters.monsters.filter((monster) => monster.alive).length
        );
        platforms.platforms = platforms.platforms.filter(
          (platform) => platform.layerIndex >= platforms.layerIndex - 8
        );
      }

      totalSpawned += monsters.stats.spawned;
      totalSkipped += monsters.stats.skippedUnsafe;
      totalBlockedRoutesPrevented += monsters.stats.blockedRoutesPrevented;
    }
  }

  assert(totalSpawned > 100, `only ${totalSpawned} monsters spawned in stress testing`);
  assert(totalSkipped > 0, "unsafe spawn retries were not exercised");
  assert(totalBlockedRoutesPrevented > 0, "route-closure prevention was not exercised");
  assert(guaranteedAnchors > 0, "Guaranteed Platforms were treated as a monster-free zone");
  assert(maximumActive <= GameConfig.maxVisibleMonsters);

  spawnValidationReport = {
    scoreBands,
    seedsPerBand: 32,
    layersPerSeed: 90,
    totalSpawned,
    totalSkipped,
    totalBlockedRoutesPrevented,
    guaranteedAnchors,
    maximumActive,
    impossibleSpawnedPatterns: 0
  };

  const difficulty = new DifficultyManager();
  const platforms = new PlatformManager(difficulty, { seed: "no-early-monsters" });
  const monsters = new MonsterManager(difficulty, platforms, {
    seed: "no-early-monsters"
  });
  platforms.reset(0, false);
  for (let index = 0; index < 100; index += 1) {
    monsters.trySpawnForLayer(platforms.generateNextLayer(3999));
  }
  assert.equal(monsters.stats.spawned, 0);
  assert.equal(monsters.stats.spawnRolls, 0);
});

test("stomp wins before death and uses swept top collision", () => {
  const game = makeGame();
  const monster = makeMonster(150, 300);
  game.monsterManager.monsters = [monster];
  game.player.x = 150;
  game.player.previousX = 150;
  game.player.previousY = 250;
  game.player.y = 270;
  game.player.vy = 300;

  const result = game.resolveMonsterCollisions();
  assert.equal(result?.type, "STOMP");
  assert.equal(monster.alive, false);
  assert.equal(game.state, GameState.PLAYING);
  approximately(game.player.y, monster.y - game.player.height);
  approximately(
    game.player.vy,
    -GameConfig.jumpPower * GameConfig.monsterStompBounceMultiplier
  );
  assert.equal(game.monsterManager.stats.removedByStomp, 1);
  assert.equal(game.monsterManager.removeMonster(monster, "STOMP"), false);
  assert.equal(game.monsterManager.stats.removedByStomp, 1);
});

test("side, underside, and Spring-powered collisions cause GAME_OVER", () => {
  const cases = [
    { previousY: 300, y: 300, vy: 0, label: "side" },
    { previousY: 340, y: 300, vy: -500, label: "underside" },
    {
      previousY: 340,
      y: 300,
      vy: -GameConfig.jumpPower * GameConfig.springJumpMultiplier,
      label: "Spring"
    }
  ];

  for (const collisionCase of cases) {
    const game = makeGame();
    const monster = makeMonster(150, 300);
    game.monsterManager.monsters = [monster];
    game.player.x = 150;
    game.player.previousX = 150;
    game.player.previousY = collisionCase.previousY;
    game.player.y = collisionCase.y;
    game.player.vy = collisionCase.vy;

    const result = game.resolveMonsterCollisions();
    assert.equal(result?.type, "GAME_OVER", `${collisionCase.label} collision survived`);
    assert.equal(game.state, GameState.GAME_OVER);
    assert.equal(monster.alive, true);
  }
});

test("Propeller Hat and Jetpack remove monsters without consuming flight", () => {
  for (const type of [ItemType.PROPELLER_HAT, ItemType.JETPACK]) {
    const game = makeGame();
    const monster = makeMonster(150, 300);
    game.monsterManager.monsters = [monster];
    game.player.x = 150;
    game.player.y = 300;
    game.player.previousX = 150;
    game.player.previousY = 300;
    game.player.activatePowerUp(type);
    const timer = game.player.powerUpTimer;
    const flightSpeed = game.player.powerUpFlightSpeed;
    const startY = game.player.y;

    const result = game.resolveMonsterCollisions();
    assert.equal(result?.type, "POWER_UP");
    assert.equal(monster.alive, false);
    assert.equal(game.state, GameState.PLAYING);
    assert.equal(game.player.activePowerUp, type);
    assert.equal(game.player.powerUpTimer, timer);
    assert.equal(game.player.vy, -flightSpeed);
    assert.equal(game.monsterManager.stats.removedByPowerUp, 1);

    game.player.update(0.1, 0);
    approximately(game.player.y, startY - flightSpeed * 0.1);
    assert.equal(game.state, GameState.PLAYING);
  }
});

test("camera, cleanup, restart, and snapshots reset monster state", () => {
  const game = makeGame();
  const monster = makeMonster(150, 100);
  game.monsterManager.monsters = [monster];
  const thresholdY = GameConfig.height * GameConfig.cameraThreshold;
  game.player.y = thresholdY - 20;
  game.player.previousY = game.player.y;
  game.updateCamera();
  approximately(monster.y, 120);

  monster.y = GameConfig.height + GameConfig.cleanupMargin + 1;
  game.monsterManager.update(0);
  assert.equal(game.monsterManager.monsters.length, 0);
  assert.equal(game.monsterManager.stats.cleanedUp, 1);

  game.monsterManager.monsters.push(makeMonster());
  game.monsterManager.stats.spawned = 10;
  game.startGame();
  assert.equal(game.monsterManager.monsters.length, 0);
  assert.equal(game.monsterManager.stats.spawned, 0);
  const snapshot = game.getDebugSnapshot();
  assert.equal(snapshot.monsters.activeCount, 0);
  assert.equal(Array.isArray(snapshot.monsters.entries), true);
});

let passed = 0;
for (const { name, callback } of tests) {
  try {
    callback();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

console.log(`\n${passed}/${tests.length} monster tests passed.`);
console.log(JSON.stringify(spawnValidationReport, null, 2));
