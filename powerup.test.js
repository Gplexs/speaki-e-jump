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

// Production classes remain private. Only this in-memory VM copy exposes them.
const instrumentedSource = rawSource
  .replace(
    canvasMarker,
    `  window.__powerUpTestInternals = Object.freeze({
    GameConfig,
    GameState,
    PlatformType,
    ItemType,
    RandomSource,
    PlatformPhysics,
    Player,
    Item,
    PowerUp,
    Spring,
    PropellerHat,
    Jetpack,
    Platform,
    DifficultyManager,
    PlatformManager,
    Game
  });

${canvasMarker}`
  )
  .replace(gameMarker, `${gameMarker}\n  window.__powerUpTestGame = game;`);

const noop = () => {};

function loadBrowserHarness(seed = "powerup-tests") {
  let clock = 0;
  let nextAnimationFrameId = 1;
  const animationFrames = new Map();
  const storage = new Map();
  const context2d = {
    arc: noop,
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
    game: sandbox.__powerUpTestGame,
    internals: sandbox.__powerUpTestInternals
  };
}

function fixedRandom(nextValue = 0, rangeRatio = 0.5) {
  return {
    next: () => nextValue,
    range: (minimum, maximum) => minimum + (maximum - minimum) * rangeRatio,
    chance: (probability) => nextValue < probability
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
  PlatformPhysics,
  Player,
  Item,
  PowerUp,
  Spring,
  PropellerHat,
  Jetpack,
  Platform,
  DifficultyManager,
  PlatformManager,
  Game
} = harness.internals;

function makePlatform(
  x = 100,
  y = 300,
  width = 120,
  type = PlatformType.NORMAL
) {
  return new Platform(x, y, width, type, 0, 0, fixedRandom());
}

function makeGame() {
  const game = new Game(harness.canvas);
  game.state = GameState.PLAYING;
  return game;
}

const tests = [];
function test(name, callback) {
  tests.push({ name, callback });
}

test("item hierarchy, type identity, safe placement, and one-item ownership", () => {
  const platform = makePlatform(80, 320, 132);
  const spring = new Spring(platform, 20);
  const propeller = new PropellerHat(platform, fixedRandom(0, 0.5));
  const jetpack = new Jetpack(platform, fixedRandom(0, 0.5));

  assert(spring instanceof Item);
  assert(propeller instanceof PowerUp);
  assert(propeller instanceof Item);
  assert(jetpack instanceof PowerUp);
  assert(jetpack instanceof Item);
  assert.equal(spring.type, ItemType.SPRING);
  assert.equal(propeller.type, ItemType.PROPELLER_HAT);
  assert.equal(jetpack.type, ItemType.JETPACK);

  for (const item of [propeller, jetpack]) {
    const itemCenter = item.x + item.width * 0.5;
    const platformCenter = platform.x + platform.width * 0.5;
    approximately(itemCenter, platformCenter, 1e-9, "power-up should be centered");
    assert.equal(item.y + item.height, platform.y, "item should sit on its platform");
    assert(item.offsetX >= 6, "item should keep a left inset");
    assert(
      item.offsetX + item.width <= platform.width - 6,
      "item should keep a right inset"
    );
  }

  assert.equal(platform.addPowerUp(ItemType.PROPELLER_HAT, fixedRandom()), true);
  const firstItem = platform.item;
  assert.equal(platform.addPowerUp(ItemType.JETPACK, fixedRandom()), false);
  assert.equal(platform.item, firstItem, "a platform must never replace its existing item");

  const moving = makePlatform(80, 320, 132, PlatformType.MOVING);
  const breakable = makePlatform(80, 320, 132, PlatformType.BREAKABLE);
  assert.equal(moving.addPowerUp(ItemType.PROPELLER_HAT, fixedRandom()), false);
  assert.equal(breakable.addPowerUp(ItemType.JETPACK, fixedRandom()), false);
  assert.equal(moving.item, null);
  assert.equal(breakable.item, null);
});

test("score-based item probabilities match every threshold and decay point", () => {
  const difficulty = new DifficultyManager();
  const gameplayLayer = GameConfig.safeOpeningLayers + 1;
  const assertChances = (score, spring, propeller, jetpack) => {
    approximately(difficulty.getSettings(score, gameplayLayer).springChance, spring);
    const flights = difficulty.getFlightPowerUpChances(score);
    approximately(flights.propeller, propeller);
    approximately(flights.jetpack, jetpack);
  };

  assertChances(0, 0.4, 0, 0);
  assertChances(5999, 0.4, 0, 0);
  assertChances(6000, 0.4, 0.15, 0.15);
  assertChances(7000, 0.4, 0.15, 0.15 - 0.1 / 6);
  assertChances(7999, 0.4, 0.15, 0.15 - 0.1 * 1999 / 6000);
  assertChances(8000, 0.4, 0.15, 0.15 - 0.1 / 3);
  assertChances(10000, 0.4, 0.1, 0.15 - 0.1 * 2 / 3);
  assertChances(12000, 0.4, 0.05, 0.05);
  assertChances(16000, 0.4, 0.05, 0.05);
});

test("flight spawn roll ordering, NORMAL-only placement, and opening exclusion", () => {
  const difficulty = new DifficultyManager();
  const peakScore = GameConfig.propellerMinScore;
  const peakChances = difficulty.getFlightPowerUpChances(peakScore);

  const manager = new PlatformManager(difficulty, { seed: "spawn-order" });
  manager.reset(0, false);

  const opening = makePlatform();
  manager.itemRandom = fixedRandom(peakChances.propeller * 0.5);
  assert.equal(
    manager.tryAddFlightPowerUp(opening, GameConfig.safeOpeningLayers, peakScore),
    null
  );
  assert.equal(opening.item, null);

  for (const type of [PlatformType.MOVING, PlatformType.BREAKABLE]) {
    const unsafe = makePlatform(100, 300, 120, type);
    assert.equal(
      manager.tryAddFlightPowerUp(
        unsafe,
        GameConfig.safeOpeningLayers + 30,
        peakScore
      ),
      null
    );
    assert.equal(unsafe.item, null);
  }

  manager.lastFlightPowerUpLayer = -Infinity;
  manager.itemRandom = fixedRandom(0);
  assert.equal(manager.tryAddFlightPowerUp(makePlatform(), 30, 5999), null);
  assert.equal(
    manager.tryAddFlightPowerUp(makePlatform(), 30, 6000)?.type,
    ItemType.PROPELLER_HAT
  );

  const propellerPlatform = makePlatform();
  manager.lastFlightPowerUpLayer = -Infinity;
  manager.itemRandom = fixedRandom(peakChances.propeller * 0.5);
  const propeller = manager.tryAddFlightPowerUp(propellerPlatform, 30, peakScore);
  assert.equal(propeller?.type, ItemType.PROPELLER_HAT);

  const jetpackPlatform = makePlatform();
  manager.lastFlightPowerUpLayer = -Infinity;
  manager.itemRandom = fixedRandom(
    peakChances.propeller + peakChances.jetpack * 0.5
  );
  const jetpack = manager.tryAddFlightPowerUp(jetpackPlatform, 30, peakScore);
  assert.equal(jetpack?.type, ItemType.JETPACK);

  const boundaryPlatform = makePlatform();
  manager.lastFlightPowerUpLayer = -Infinity;
  manager.itemRandom = fixedRandom(peakChances.propeller);
  assert.equal(
    manager.tryAddFlightPowerUp(boundaryPlatform, 30, peakScore)?.type,
    ItemType.JETPACK,
    "the propeller interval must precede the jetpack interval"
  );

  const missPlatform = makePlatform();
  manager.lastFlightPowerUpLayer = -Infinity;
  manager.itemRandom = fixedRandom(
    peakChances.propeller + peakChances.jetpack
  );
  assert.equal(manager.tryAddFlightPowerUp(missPlatform, 30, peakScore), null);
});

test("Propeller and Jetpack share the layer cooldown", () => {
  const difficulty = new DifficultyManager();
  const score = GameConfig.propellerMinScore;
  const chances = difficulty.getFlightPowerUpChances(score);
  const manager = new PlatformManager(difficulty, { seed: "cooldown" });
  manager.reset(0, false);

  manager.itemRandom = fixedRandom(chances.propeller * 0.5);
  assert.equal(
    manager.tryAddFlightPowerUp(makePlatform(), 30, score)?.type,
    ItemType.PROPELLER_HAT
  );
  assert.equal(manager.lastFlightPowerUpLayer, 30);

  manager.itemRandom = fixedRandom(
    chances.propeller + chances.jetpack * 0.5
  );
  assert.equal(
    manager.tryAddFlightPowerUp(
      makePlatform(),
      30 + GameConfig.jetpackMinSpawnGap - 1,
      score
    ),
    null,
    "a recent propeller must block a too-close jetpack"
  );
  assert.equal(
    manager.tryAddFlightPowerUp(
      makePlatform(),
      30 + GameConfig.jetpackMinSpawnGap,
      score
    )?.type,
    ItemType.JETPACK
  );

  const jetpackLayer = 30 + GameConfig.jetpackMinSpawnGap;
  manager.itemRandom = fixedRandom(chances.propeller * 0.5);
  assert.equal(
    manager.tryAddFlightPowerUp(
      makePlatform(),
      jetpackLayer + GameConfig.propellerMinSpawnGap - 1,
      score
    ),
    null,
    "a recent jetpack must block a too-close propeller"
  );
  assert.equal(
    manager.tryAddFlightPowerUp(
      makePlatform(),
      jetpackLayer + GameConfig.propellerMinSpawnGap,
      score
    )?.type,
    ItemType.PROPELLER_HAT
  );
});

test("seeded generation integrates power-ups without weakening the safe route", () => {
  const manager = new PlatformManager(new DifficultyManager(), {
    seed: "powerup-generation-integration",
    debugEnabled: false
  });
  manager.reset(0, false);

  const flights = [];
  for (let index = 0; index < 900; index += 1) {
    const result = manager.generateNextLayer(Math.min(index * 16, 12000));
    for (const platform of [result.guaranteed, ...result.fillers]) {
      if (
        platform.item?.type === ItemType.PROPELLER_HAT ||
        platform.item?.type === ItemType.JETPACK
      ) {
        flights.push({ layerIndex: platform.layerIndex, item: platform.item, platform });
      }
    }
  }

  assert(flights.length > 0, "seeded generation should produce flight power-ups");
  assert(
    flights.some(({ item }) => item.type === ItemType.PROPELLER_HAT),
    "seeded generation should exercise Propeller Hat"
  );
  assert(
    flights.some(({ item }) => item.type === ItemType.JETPACK),
    "seeded generation should exercise Jetpack"
  );

  for (let index = 0; index < flights.length; index += 1) {
    const current = flights[index];
    assert.equal(current.platform.type, PlatformType.NORMAL);
    assert.equal(current.platform.isGuaranteed, true);
    assert(
      current.platform.generationScore >=
        (current.item.type === ItemType.PROPELLER_HAT
          ? GameConfig.propellerMinScore
          : GameConfig.jetpackMinScore)
    );
    assert(current.layerIndex > GameConfig.safeOpeningLayers);
    assert.equal(current.platform.item, current.item);
    assert.equal(current.item.collected, false);
    assert(
      Math.abs(
        current.item.x + current.item.width * 0.5 -
          (current.platform.x + current.platform.width * 0.5)
      ) <= 6 + 1e-9
    );

    if (index > 0) {
      const previous = flights[index - 1];
      const requiredGap = current.item.type === ItemType.PROPELLER_HAT
        ? GameConfig.propellerMinSpawnGap
        : GameConfig.jetpackMinSpawnGap;
      assert(
        current.layerIndex - previous.layerIndex >= requiredGap,
        `shared cooldown violated between layers ${previous.layerIndex} and ${current.layerIndex}`
      );
    }
  }

  const validation = PlatformManager.validateGeneratedPlatforms(900, "powerup-route-check");
  assert.equal(validation.unreachableGuaranteed, 0);
  assert.equal(validation.outsidePlatforms, 0);
  assert.equal(validation.overlappingPlatforms, 0);
  assert.equal(validation.verticalGapViolations, 0);
  assert.equal(validation.horizontalReachViolations, 0);
  assert.equal(validation.layerCountViolations, 0);
  assert.equal(validation.generationFailures, 0);
});

test("aggregate generation keeps Spring more common than both flight power-ups", () => {
  const totals = {
    [ItemType.SPRING]: 0,
    [ItemType.PROPELLER_HAT]: 0,
    [ItemType.JETPACK]: 0
  };

  for (let seed = 0; seed < 8; seed += 1) {
    const manager = new PlatformManager(new DifficultyManager(), {
      seed: `rarity-${seed}`,
      debugEnabled: false
    });
    manager.reset(0, false);
    for (let layer = 0; layer < 1000; layer += 1) {
      manager.generateNextLayer(Math.min(layer * 16, 12000));
      manager.platforms = manager.platforms.filter(
        (platform) => platform.y < manager.highestGeneratedY + GameConfig.height
      );
    }
    for (const type of Object.keys(totals)) {
      totals[type] += manager.stats.itemsGenerated[type];
    }
  }

  assert(totals[ItemType.PROPELLER_HAT] > 0, "Propeller Hat must be generated");
  assert(totals[ItemType.JETPACK] > 0, "Jetpack must be generated");
  assert(
    totals[ItemType.SPRING] > totals[ItemType.PROPELLER_HAT] &&
      totals[ItemType.SPRING] > totals[ItemType.JETPACK],
    `unexpected item frequency order: ${JSON.stringify(totals)}`
  );
});

test("overlap pickup is swept, immediate, single-use, and replaces P and J safely", () => {
  const game = makeGame();
  const platform = makePlatform(120, 330, 130);
  assert.equal(platform.addPowerUp(ItemType.PROPELLER_HAT, fixedRandom()), true);
  const propeller = platform.item;
  game.platformManager.platforms = [platform];
  game.player.x = propeller.x;
  game.player.previousX = propeller.x;
  game.player.previousY = propeller.y + propeller.height + 30;
  game.player.y = propeller.y - game.player.height - 30;

  assert.equal(game.resolvePowerUpPickups(), propeller);
  assert.equal(propeller.collected, true);
  assert.equal(platform.item, null, "a collected item must disappear immediately");
  assert.equal(game.player.activePowerUp, ItemType.PROPELLER_HAT);
  assert.equal(game.player.powerUpTimer, GameConfig.propellerDuration);

  const timerAfterPickup = game.player.powerUpTimer;
  assert.equal(game.resolvePowerUpPickups(), null);
  assert.equal(game.player.powerUpTimer, timerAfterPickup, "pickup must not retrigger");

  const jetpackPlatform = makePlatform(120, 330, 130);
  jetpackPlatform.addPowerUp(ItemType.JETPACK, fixedRandom());
  const jetpack = jetpackPlatform.item;
  game.platformManager.platforms = [jetpackPlatform];
  game.player.x = jetpack.x;
  game.player.previousX = jetpack.x;
  game.player.y = jetpack.y;
  game.player.previousY = jetpack.y;
  assert.equal(game.resolvePowerUpPickups(), jetpack);
  assert.equal(game.player.activePowerUp, ItemType.JETPACK);
  assert.equal(game.player.powerUpTimer, GameConfig.jetpackDuration);
  assert.equal(game.player.powerUpFlightSpeed, GameConfig.jetpackFlightSpeed);

  const replacementPlatform = makePlatform(120, 330, 130);
  replacementPlatform.addPowerUp(ItemType.PROPELLER_HAT, fixedRandom());
  game.platformManager.platforms = [replacementPlatform];
  game.player.x = replacementPlatform.item.x;
  game.player.previousX = game.player.x;
  game.player.y = replacementPlatform.item.y;
  game.player.previousY = game.player.y;
  assert.equal(game.resolvePowerUpPickups()?.type, ItemType.PROPELLER_HAT);
  assert.equal(game.player.activePowerUp, ItemType.PROPELLER_HAT);
  assert.equal(game.player.powerUpTimer, GameConfig.propellerDuration);
  assert.equal(game.player.powerUpFlightSpeed, GameConfig.propellerFlightSpeed);
});

test("the real Game.update pickup path suppresses a same-frame platform bounce", () => {
  const game = makeGame();
  const platform = makePlatform(120, 330, 130);
  platform.addPowerUp(ItemType.PROPELLER_HAT, fixedRandom());
  const item = platform.item;
  game.platformManager.platforms = [platform];
  game.platformManager.ensurePlatforms = () => {};
  game.player.reset(item.x, platform.y - game.player.height - 5);
  game.player.vy = 300;

  game.update(1 / 60);

  assert.equal(platform.item, null);
  assert.equal(game.player.activePowerUp, ItemType.PROPELLER_HAT);
  assert.equal(game.player.vy, -GameConfig.propellerFlightSpeed);
  assert.notEqual(game.player.vy, -GameConfig.jumpPower);
  assert.notEqual(game.player.vy, -GameConfig.jumpPower * GameConfig.springJumpMultiplier);
});

test("timed flight has exact rise, ignores gravity, and returns naturally to gravity", () => {
  assert.equal(GameConfig.propellerFlightSpeed, 350);
  assert.equal(GameConfig.jetpackFlightSpeed, 650);
  assert(GameConfig.jetpackFlightSpeed > GameConfig.propellerFlightSpeed);
  assert(
    GameConfig.jetpackFlightSpeed * GameConfig.jetpackDuration >
      GameConfig.propellerFlightSpeed * GameConfig.propellerDuration
  );

  const propellerPlayer = new Player(100, 2000);
  propellerPlayer.vy = GameConfig.maxFallSpeed;
  const propellerStartY = propellerPlayer.y;
  assert.equal(propellerPlayer.activatePowerUp(ItemType.PROPELLER_HAT), true);
  assert.equal(propellerPlayer.y, propellerStartY, "activation must not teleport the player");
  propellerPlayer.update(GameConfig.propellerDuration, 0);
  approximately(
    propellerPlayer.y,
    propellerStartY - GameConfig.propellerFlightSpeed * GameConfig.propellerDuration,
    1e-6,
    "Propeller Hat total rise"
  );
  assert.equal(propellerPlayer.activePowerUp, null);
  assert.equal(propellerPlayer.isFlying, false);
  assert.equal(propellerPlayer.powerUpTimer, 0);
  assert.equal(propellerPlayer.vy, 0);
  assert.equal(propellerPlayer.powerUpEndedThisFrame, true);

  const gravityStep = 0.1;
  const yAtFlightEnd = propellerPlayer.y;
  propellerPlayer.update(gravityStep, 0);
  approximately(propellerPlayer.vy, GameConfig.gravity * gravityStep);
  approximately(
    propellerPlayer.y,
    yAtFlightEnd + GameConfig.gravity * gravityStep * gravityStep
  );

  const jetpackPlayer = new Player(100, 2400);
  const jetpackStartY = jetpackPlayer.y;
  jetpackPlayer.activatePowerUp(ItemType.JETPACK);
  jetpackPlayer.update(GameConfig.jetpackDuration + gravityStep, 0);
  approximately(
    jetpackPlayer.y,
    jetpackStartY - GameConfig.jetpackFlightSpeed * GameConfig.jetpackDuration +
      GameConfig.gravity * gravityStep * gravityStep,
    1e-6,
    "a frame crossing the timer boundary must integrate flight and gravity separately"
  );
  approximately(jetpackPlayer.vy, GameConfig.gravity * gravityStep);
  assert.equal(jetpackPlayer.powerUpEndedThisFrame, true);

  for (const [type, duration, speed] of [
    [ItemType.PROPELLER_HAT, GameConfig.propellerDuration, GameConfig.propellerFlightSpeed],
    [ItemType.JETPACK, GameConfig.jetpackDuration, GameConfig.jetpackFlightSpeed]
  ]) {
    for (const framesPerSecond of [30, 60, 144]) {
      const player = new Player(100, 3000);
      const startY = player.y;
      player.activatePowerUp(type);
      while (player.isFlying) {
        const step = Math.min(1 / framesPerSecond, player.powerUpTimer);
        const previousY = player.y;
        player.update(step, 0);
        assert(
          previousY - player.y <= speed * step + 1e-6,
          "a flight frame must not teleport farther than its time step"
        );
      }
      approximately(
        startY - player.y,
        speed * duration,
        1e-6,
        `${type} rise at ${framesPerSecond} FPS`
      );
      assert.equal(player.vy, 0);
    }
  }
});

test("30% jump spin completes one turn and never carries into flight", () => {
  const decisions = [true, false, true];
  const observedChances = [];
  const spinRandom = {
    chance(probability) {
      observedChances.push(probability);
      return decisions.shift();
    }
  };
  const player = new Player(100, 400, spinRandom);

  assert.equal(GameConfig.jumpSpinChance, 0.3);
  assert.equal(player.launch(), true);
  assert.equal(player.jumpSpinActive, true);
  approximately(player.rotation, 0);

  player.update(GameConfig.jumpSpinDuration * 0.5, 0);
  assert.equal(player.jumpSpinActive, true);
  approximately(player.rotation, Math.PI, 1e-9, "halfway spin angle");

  player.update(GameConfig.jumpSpinDuration * 0.5, 0);
  assert.equal(player.jumpSpinActive, false);
  approximately(player.rotation, 0, 1e-9, "completed spin returns upright");

  player.launch();
  assert.equal(player.jumpSpinActive, false, "failed 30% roll must stay upright");

  player.launch();
  assert.equal(player.jumpSpinActive, true);
  player.activatePowerUp(ItemType.PROPELLER_HAT);
  assert.equal(player.jumpSpinActive, false, "flight must cancel a jump spin");
  approximately(player.rotation, 0);
  assert.deepEqual(observedChances, [0.3, 0.3, 0.3]);
});

test("horizontal control and full-width wrap remain active during flight", () => {
  const player = new Player(100, 400);
  player.activatePowerUp(ItemType.PROPELLER_HAT);
  const startY = player.y;
  player.update(0.1, 1);
  approximately(player.vx, 220);
  approximately(player.x, 122);
  approximately(player.y, startY - GameConfig.propellerFlightSpeed * 0.1);
  assert.equal(player.vy, -GameConfig.propellerFlightSpeed);

  player.x = GameConfig.width - 1;
  player.vx = GameConfig.maxMoveSpeed;
  player.update(0.1, 1);
  assert.equal(player.x, -player.width);
  assert.equal(player.previousX, -player.width);
  assert.equal(player.isFlying, true);

  const leftWrappingPlayer = new Player(-GameConfig.playerWidth + 1, 400);
  leftWrappingPlayer.activatePowerUp(ItemType.JETPACK);
  leftWrappingPlayer.vx = -GameConfig.maxMoveSpeed;
  leftWrappingPlayer.update(0.1, -1);
  assert.equal(leftWrappingPlayer.x, GameConfig.width);
  assert.equal(leftWrappingPlayer.previousX, GameConfig.width);
  assert.equal(leftWrappingPlayer.isFlying, true);
});

test("platform and Spring bounce are suppressed in flight, then Spring works normally", () => {
  const game = makeGame();
  const breakable = makePlatform(100, 300, 130, PlatformType.BREAKABLE);
  game.platformManager.platforms = [breakable];
  game.player.reset(120, 265);
  game.player.previousY = 240;
  game.player.activatePowerUp(ItemType.PROPELLER_HAT);
  game.player.vy = 500;
  const flyingY = game.player.y;
  game.resolveLandings();
  assert.equal(game.player.y, flyingY);
  assert.equal(game.player.vy, 500);
  assert.equal(breakable.breaking, false);

  const springPlatform = makePlatform(100, 300, 130);
  springPlatform.addSpring(fixedRandom());
  game.platformManager.platforms = [springPlatform];
  game.player.x = springPlatform.item.x;
  game.player.previousY = springPlatform.item.y - game.player.height - 6;
  game.player.y = springPlatform.item.y - game.player.height + 5;
  game.player.vy = 500;
  game.resolveLandings();
  assert.equal(game.player.vy, 500, "Spring must not launch during flight");

  game.player.launch(GameConfig.springJumpMultiplier);
  assert.equal(game.player.vy, 500, "direct launch calls must also be ignored in flight");

  game.player.clearPowerUp();
  game.player.previousY = springPlatform.item.y - game.player.height - 6;
  game.player.y = springPlatform.item.y - game.player.height + 5;
  game.player.vy = 500;
  game.resolveLandings();
  approximately(game.player.vy, -GameConfig.jumpPower * GameConfig.springJumpMultiplier);
  approximately(game.player.y, springPlatform.item.y - game.player.height);
});

test("camera, height score, and dynamic generation track fast flight continuously", () => {
  const game = makeGame();
  for (const platform of game.platformManager.platforms) {
    if (platform.item?.type !== ItemType.SPRING) {
      platform.item = null;
    }
  }
  const thresholdY = GameConfig.height * GameConfig.cameraThreshold;
  game.player.y = thresholdY - 10;
  game.player.previousY = game.player.y;
  game.player.activatePowerUp(ItemType.JETPACK);

  game.update(0.1);
  const firstCameraOffset = game.cameraOffset;
  approximately(game.player.y, thresholdY);
  approximately(firstCameraOffset, 10 + GameConfig.jetpackFlightSpeed * 0.1);
  assert.equal(
    game.score,
    Math.floor(game.cameraOffset + Math.max(0, game.startPlayerY - game.player.y)),
    "flight must use the ordinary height score and no item bonus"
  );
  let reserve = game.player.remainingFlightDistance +
    PlatformPhysics.getMaximumJumpHeight() * GameConfig.safeVerticalGapRatio;
  assert(
    game.platformManager.highestGeneratedY <=
      -GameConfig.height * GameConfig.spawnAheadScreens - reserve + 1e-6,
    "generation must stay ahead of the remaining flight distance"
  );

  game.update(0.1);
  approximately(game.player.y, thresholdY);
  approximately(game.cameraOffset - firstCameraOffset, GameConfig.jetpackFlightSpeed * 0.1);
  assert(game.cameraOffset > firstCameraOffset);
  reserve = game.player.remainingFlightDistance +
    PlatformPhysics.getMaximumJumpHeight() * GameConfig.safeVerticalGapRatio;
  assert(
    game.platformManager.highestGeneratedY <=
      -GameConfig.height * GameConfig.spawnAheadScreens - reserve + 1e-6
  );
});

test("flight completion does not create or repurpose a recovery platform", () => {
  const game = makeGame();
  const existingPlatform = makePlatform(100, 500, 130);
  existingPlatform.isGuaranteed = true;
  existingPlatform.layerIndex = 20;
  game.platformManager.platforms = [existingPlatform];
  game.platformManager.ensurePlatforms = () => {};
  game.player.x = 150;
  game.player.y = 300;
  game.player.previousX = game.player.x;
  game.player.previousY = game.player.y;
  game.player.activatePowerUp(ItemType.PROPELLER_HAT);
  game.player.powerUpTimer = 0.05;

  game.update(0.1);

  assert.equal(game.player.isFlying, false);
  assert(game.player.vy > 0, "gravity should resume in the timer-overrun portion");
  assert.equal(game.platformManager.platforms.length, 1);
  assert.equal(game.platformManager.platforms[0], existingPlatform);
  assert.equal(typeof game.platformManager.ensureFlightExitPlatform, "undefined");
  assert.equal("recoveryPlatformsCreated" in game.platformManager.stats, false);
  assert.equal("recoveryPlatformsReused" in game.platformManager.stats, false);
});

test("Guaranteed Path becomes BREAKABLE at a 25% rate from 8,000 points", () => {
  assert.equal(GameConfig.guaranteedBreakableScoreThreshold, 8000);
  assert.equal(GameConfig.guaranteedBreakableChance, 0.25);

  const manager = new PlatformManager(new DifficultyManager(), {
    seed: "guaranteed-breakable-boundaries",
    debugEnabled: false
  });
  manager.reset(0, false);

  manager.routeTypeRandom = fixedRandom(0);
  const beforeThreshold = makePlatform();
  assert.equal(
    manager.applyGuaranteedPlatformDifficulty(beforeThreshold, 7999),
    false
  );
  assert.equal(beforeThreshold.type, PlatformType.NORMAL);

  const atThreshold = makePlatform();
  assert.equal(
    manager.applyGuaranteedPlatformDifficulty(atThreshold, 8000),
    true
  );
  assert.equal(atThreshold.type, PlatformType.BREAKABLE);
  assert.equal(atThreshold.generationScore, 8000);

  manager.routeTypeRandom = fixedRandom(0.25);
  const boundaryMiss = makePlatform();
  assert.equal(
    manager.applyGuaranteedPlatformDifficulty(boundaryMiss, 8000),
    false
  );
  assert.equal(boundaryMiss.type, PlatformType.NORMAL);

  const aggregate = new PlatformManager(new DifficultyManager(), {
    seed: "guaranteed-breakable-rate",
    debugEnabled: false
  });
  aggregate.reset(0, false);
  let breakableCount = 0;
  const sampleCount = 4000;
  for (let index = 0; index < sampleCount; index += 1) {
    const result = aggregate.generateNextLayer(8000);
    if (result.guaranteed.type === PlatformType.BREAKABLE) {
      breakableCount += 1;
      assert.equal(result.guaranteed.item, null);
    }
    aggregate.platforms = aggregate.platforms.filter(
      (platform) => platform.y < aggregate.highestGeneratedY + GameConfig.height
    );
  }
  const observedRate = breakableCount / sampleCount;
  assert(
    observedRate >= 0.23 && observedRate <= 0.27,
    `observed Guaranteed BREAKABLE rate ${observedRate} is not near 25%`
  );
  assert.equal(aggregate.stats.guaranteedBreakablesGenerated, breakableCount);

  const breakableRoute = makePlatform(100, 300, 130, PlatformType.BREAKABLE);
  breakableRoute.isGuaranteed = true;
  const game = makeGame();
  game.platformManager.platforms = [breakableRoute];
  game.player.reset(120, breakableRoute.y - game.player.height + 5);
  game.player.previousY = breakableRoute.y - game.player.height - 5;
  game.player.vy = 300;
  game.resolveLandings();
  assert.equal(breakableRoute.breaking, true);
  assert.equal(game.player.vy, -GameConfig.jumpPower);
  breakableRoute.update(GameConfig.breakDelay);
  assert.equal(breakableRoute.removed, true);
});

test("game over, restart, collection, and cleanup leave no active stale state", () => {
  const game = makeGame();
  game.player.activatePowerUp(ItemType.JETPACK);
  game.finishGame();
  assert.equal(game.state, GameState.GAME_OVER);
  assert.equal(game.player.activePowerUp, null);
  assert.equal(game.player.powerUpTimer, 0);

  const stalePlatform = makePlatform(100, 300, 130);
  stalePlatform.addPowerUp(ItemType.PROPELLER_HAT, fixedRandom());
  game.platformManager.platforms.push(stalePlatform);
  game.player.activatePowerUp(ItemType.PROPELLER_HAT);
  game.startGame();
  assert.equal(game.state, GameState.PLAYING);
  assert.equal(game.player.activePowerUp, null);
  assert.equal(game.player.powerUpTimer, 0);
  assert.equal(game.player.isFlying, false);
  assert.equal(game.platformManager.platforms.includes(stalePlatform), false);
  assert.equal(game.platformManager.stats.guaranteedBreakablesGenerated, 0);

  const manager = new PlatformManager(new DifficultyManager(), { seed: "cleanup" });
  manager.reset(0, false);
  const expiredPlatform = makePlatform(
    100,
    GameConfig.height + GameConfig.cleanupMargin + 1,
    130
  );
  expiredPlatform.addPowerUp(ItemType.JETPACK, fixedRandom());
  manager.platforms.push(expiredPlatform);
  manager.cleanupPlatforms();
  assert.equal(manager.platforms.includes(expiredPlatform), false);

  const collectiblePlatform = makePlatform();
  collectiblePlatform.addPowerUp(ItemType.PROPELLER_HAT, fixedRandom());
  const collectible = collectiblePlatform.item;
  assert.equal(collectible.collect(), true);
  assert.equal(collectible.collect(), false);
  assert.equal(collectiblePlatform.item, null);

  let maximumLivePlatforms = 0;
  for (let step = 0; step < 240; step += 1) {
    manager.scroll(GameConfig.height * 0.25);
    manager.update(0);
    manager.ensurePlatforms(step * 100);
    maximumLivePlatforms = Math.max(maximumLivePlatforms, manager.platforms.length);
    for (const platform of manager.platforms) {
      if (platform.item) {
        assert.equal(platform.item.platform, platform);
        assert.equal(platform.item.collected, false);
      }
    }
  }
  assert(maximumLivePlatforms < 50, `live platform count grew to ${maximumLivePlatforms}`);
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

console.log(`\n${passed}/${tests.length} power-up tests passed.`);

if (process.argv.includes("--find-preload-seeds")) {
  const found = {
    [ItemType.PROPELLER_HAT]: null,
    [ItemType.JETPACK]: null
  };
  for (let seed = 0; seed < 10000; seed += 1) {
    const manager = new PlatformManager(new DifficultyManager(), {
      seed: String(seed),
      debugEnabled: false
    });
    manager.reset(0, true);
    for (const platform of manager.platforms) {
      if (
        platform.item &&
        Object.prototype.hasOwnProperty.call(found, platform.item.type) &&
        (!found[platform.item.type] || platform.layerIndex < found[platform.item.type].layer)
      ) {
        found[platform.item.type] = {
          seed: String(seed),
          layer: platform.layerIndex,
          y: Math.round(platform.y * 10) / 10
        };
      }
    }
    if (Object.values(found).every((entry) => entry?.layer === GameConfig.safeOpeningLayers + 1)) {
      break;
    }
  }
  console.log("PRELOAD_SEEDS", JSON.stringify(found));
}
