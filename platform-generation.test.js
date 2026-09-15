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

// Production classes stay private. Export them only in this in-memory copy.
const instrumentedSource = rawSource
  .replace(
    canvasMarker,
    `  window.__platformTestInternals = Object.freeze({
    GameConfig,
    GameState,
    PlatformType,
    RandomSource,
    PlatformPhysics,
    Platform,
    DifficultyManager,
    PlatformManager,
    Game
  });

${canvasMarker}`
  )
  .replace(gameMarker, `${gameMarker}\n  window.__platformTestGame = game;`);

const round = (value, places = 6) => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

function makeBrowserHarness(seed, forbidMathRandom = true) {
  let clock = 0;
  let nextAnimationFrameId = 1;
  let animationFrameRequestCount = 0;
  const animationFrames = new Map();
  const listeners = new Map();
  const storage = new Map();
  const noop = () => {};
  const context2d = {
    beginPath: noop,
    clearRect: noop,
    fillRect: noop,
    fillText: noop,
    lineTo: noop,
    moveTo: noop,
    restore: noop,
    save: noop,
    stroke: noop
  };
  const canvas = {
    addEventListener: noop,
    focus: noop,
    getContext: () => context2d,
    height: 720,
    width: 480
  };

  const sandbox = {
    URLSearchParams,
    console: { error: noop, info: noop, log: noop, warn: noop },
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
      animationFrameRequestCount += 1;
      animationFrames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      animationFrames.delete(id);
    },
    addEventListener(type, callback) {
      if (!listeners.has(type)) {
        listeners.set(type, []);
      }
      listeners.get(type).push(callback);
    },
    removeEventListener: noop
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  if (forbidMathRandom) {
    vm.runInContext(
      'Math.random = () => { throw new Error("Seeded generation leaked to Math.random"); };',
      sandbox
    );
  }
  vm.runInContext(instrumentedSource, sandbox, { filename: gamePath });

  return {
    canvas,
    game: sandbox.__platformTestGame,
    internals: sandbox.__platformTestInternals,
    raf: {
      get pending() {
        return animationFrames.size;
      },
      get requests() {
        return animationFrameRequestCount;
      },
      step(milliseconds = 1000 / 60) {
        assert.equal(animationFrames.size, 1, "exactly one animation callback must be pending");
        const [[id, callback]] = animationFrames;
        animationFrames.delete(id);
        clock += milliseconds;
        callback(clock);
      }
    },
    sandbox
  };
}

function copyPlatform(platform, scrollOffset) {
  return {
    allowWrappingFromPrevious: Boolean(platform.allowWrappingFromPrevious),
    generationFallback: Boolean(platform.generationFallback),
    itemType: platform.item?.type || null,
    height: platform.height,
    isGuaranteed: Boolean(platform.isGuaranteed),
    layerIndex: platform.layerIndex,
    moveMax: platform.moveMax,
    moveMin: platform.moveMin,
    type: platform.type,
    width: platform.width,
    worldY: platform.y - scrollOffset,
    x: platform.x
  };
}

function horizontalEnvelope(platform, PlatformType) {
  if (platform.type === PlatformType.MOVING) {
    return {
      left: platform.moveMin,
      right: platform.moveMax + platform.width
    };
  }
  return { left: platform.x, right: platform.x + platform.width };
}

function signature(platforms, layerLimit = Infinity) {
  return platforms
    .filter((platform) => platform.layerIndex <= layerLimit)
    .slice()
    .sort((a, b) =>
      a.layerIndex - b.layerIndex ||
      Number(b.isGuaranteed) - Number(a.isGuaranteed) ||
      a.worldY - b.worldY ||
      a.x - b.x
    )
    .map((platform) => [
      platform.layerIndex,
      platform.isGuaranteed,
      round(platform.x),
      round(platform.worldY),
      round(platform.width),
      platform.type,
      platform.itemType,
      platform.allowWrappingFromPrevious,
      platform.generationFallback
    ]);
}

function simulateGeneration(seed, targetGuaranteed = 1000, reverseArray = false) {
  const harness = makeBrowserHarness(seed);
  const { GameConfig } = harness.internals;
  const manager = harness.game.platformManager;
  assert.equal(typeof manager.ensurePlatforms, "function", "PlatformManager.ensurePlatforms missing");

  let scrollOffset = 0;
  let maxActivePlatforms = manager.platforms.length;
  let spawnAheadChecks = 0;
  let generatedAboveViewportChecks = 0;
  const seen = new Set();
  const generated = [];

  const capture = () => {
    for (const platform of manager.platforms) {
      if (!seen.has(platform)) {
        seen.add(platform);
        generated.push(copyPlatform(platform, scrollOffset));
      }
    }
  };
  capture();

  for (let iteration = 0; ; iteration += 1) {
    const guaranteedCount = generated.filter((platform) => platform.isGuaranteed).length;
    if (guaranteedCount >= targetGuaranteed) {
      break;
    }
    assert(iteration < 1000, "generation stalled before reaching requested layer count");

    if (reverseArray && iteration % 7 === 3) {
      manager.platforms.reverse();
    }

    const scrollStep = GameConfig.height * 0.5;
    manager.scroll(scrollStep);
    scrollOffset += scrollStep;
    manager.update(0);

    const cleanupBoundary = GameConfig.height + GameConfig.cleanupMargin;
    for (const platform of manager.platforms) {
      assert(
        platform.y < cleanupBoundary,
        `platform survived below cleanup boundary at y=${platform.y}`
      );
    }

    const before = new Set(manager.platforms);
    manager.ensurePlatforms(Math.floor(scrollOffset));
    const newlyGenerated = manager.platforms.filter((platform) => !before.has(platform));
    for (const platform of newlyGenerated) {
      assert(
        platform.y + platform.height <= 0,
        `platform became visible during generation at y=${platform.y}`
      );
      generatedAboveViewportChecks += 1;
    }

    const liveGuaranteed = manager.platforms.filter((platform) => platform.isGuaranteed);
    assert(liveGuaranteed.length > 0, "no live Guaranteed Platform remains");
    const highestGuaranteedY = Math.min(...liveGuaranteed.map((platform) => platform.y));
    const requiredSpawnAhead = -GameConfig.height * GameConfig.spawnAheadScreens;
    assert(
      highestGuaranteedY <= requiredSpawnAhead,
      `spawn ahead stopped at ${highestGuaranteedY}, expected <= ${requiredSpawnAhead}`
    );
    spawnAheadChecks += 1;

    maxActivePlatforms = Math.max(maxActivePlatforms, manager.platforms.length);
    capture();
  }

  return {
    generated,
    generatedAboveViewportChecks,
    harness,
    maxActivePlatforms,
    spawnAheadChecks
  };
}

function independentFlightProfile(config, verticalGap, deltaTime) {
  let bottomY = 0;
  let velocityY = -config.jumpPower;
  let apex = 0;
  const targetY = -verticalGap;

  for (let step = 1; step <= Math.ceil(2.5 / deltaTime); step += 1) {
    const previousBottomY = bottomY;
    velocityY = Math.min(velocityY + config.gravity * deltaTime, config.maxFallSpeed);
    bottomY += velocityY * deltaTime;
    apex = Math.min(apex, bottomY);

    if (velocityY > 0 && previousBottomY <= targetY + 2 && bottomY >= targetY) {
      const flightTime = step * deltaTime;
      const simulateHorizontal = (initialVelocity, steerTime) => {
        let elapsed = 0;
        let position = 0;
        let velocity = initialVelocity;
        for (let horizontalStep = 0; horizontalStep < step; horizontalStep += 1) {
          if (elapsed < steerTime) {
            velocity += config.moveAcceleration * deltaTime;
          } else {
            velocity *= Math.exp(-config.horizontalFriction * deltaTime);
            if (Math.abs(velocity) < 0.5) {
              velocity = 0;
            }
          }
          velocity = Math.max(
            -config.maxMoveSpeed,
            Math.min(config.maxMoveSpeed, velocity)
          );
          position += velocity * deltaTime;
          elapsed += deltaTime;
        }
        return position;
      };
      const theoreticalHorizontalDistance = simulateHorizontal(0, Infinity);
      const controlledHorizontalDistance = simulateHorizontal(
        -config.maxMoveSpeed,
        flightTime * config.controlledSteerFraction
      );
      const safeHorizontalDistance = Math.min(
        theoreticalHorizontalDistance * config.safeHorizontalReachRatio,
        Math.max(0, controlledHorizontalDistance * 0.92 -
          config.maxMoveSpeed * config.maxDeltaTime)
      );
      return {
        apex: -apex,
        controlledHorizontalDistance,
        reachableHeight: true,
        safeHorizontalDistance,
        steps: step,
        theoreticalHorizontalDistance,
        time: flightTime
      };
    }
  }

  return {
    apex: -apex,
    controlledHorizontalDistance: 0,
    reachableHeight: false,
    safeHorizontalDistance: 0,
    steps: 0,
    theoreticalHorizontalDistance: 0,
    time: 0
  };
}

function validateGeneratedPlatforms(run) {
  const { generated, harness } = run;
  const { GameConfig, PlatformPhysics, PlatformType } = harness.internals;
  const groups = new Map();
  let outOfBounds = 0;

  for (const platform of generated) {
    assert(Number.isFinite(platform.x) && Number.isFinite(platform.worldY));
    assert(Number.isFinite(platform.width) && platform.width > 0);
    const envelope = horizontalEnvelope(platform, PlatformType);
    if (
      envelope.left < GameConfig.sidePadding - 1e-6 ||
      envelope.right > GameConfig.width - GameConfig.sidePadding + 1e-6
    ) {
      outOfBounds += 1;
    }
    if (!groups.has(platform.layerIndex)) {
      groups.set(platform.layerIndex, []);
    }
    groups.get(platform.layerIndex).push(platform);
  }
  assert.equal(
    outOfBounds,
    0,
    `platforms outside horizontal bounds: ${JSON.stringify(
      generated
        .filter((platform) =>
          horizontalEnvelope(platform, PlatformType).left < GameConfig.sidePadding - 1e-6 ||
          horizontalEnvelope(platform, PlatformType).right >
            GameConfig.width - GameConfig.sidePadding + 1e-6
        )
        .slice(0, 5)
    )}`
  );

  const layerIndices = [...groups.keys()].sort((a, b) => a - b);
  assert.equal(layerIndices[0], 0, "starting layer must be zero");
  for (let index = 1; index < layerIndices.length; index += 1) {
    assert.equal(layerIndices[index], layerIndices[index - 1] + 1, "layer index gap");
  }

  for (const layerIndex of layerIndices) {
    const layer = groups.get(layerIndex);
    const guaranteed = layer.filter((platform) => platform.isGuaranteed);
    assert.equal(guaranteed.length, 1, `layer ${layerIndex} must contain one guaranteed platform`);
    assert(
      layer.length >= 1 && layer.length <= 3,
      `layer ${layerIndex} has ${layer.length} platforms instead of 1..3`
    );
  }

  const guaranteed = generated
    .filter((platform) => platform.isGuaranteed)
    .sort((a, b) => a.layerIndex - b.layerIndex);
  let unreachable = 0;
  let independentUnreachable = 0;
  const verticalGaps = [];
  const safeHorizontalTravels = [];

  for (let index = 1; index < guaranteed.length; index += 1) {
    const previous = guaranteed[index - 1];
    const current = guaranteed[index];
    const verticalGap = previous.worldY - current.worldY;
    verticalGaps.push(verticalGap);
    assert(verticalGap > 0, `layer ${current.layerIndex} did not move upward`);
    assert.notEqual(
      current.type,
      PlatformType.BREAKABLE,
      `layer ${current.layerIndex} uses BREAKABLE as the guaranteed route`
    );

    const reachability = PlatformPhysics.getReachability(
      { x: previous.x, y: previous.worldY, width: previous.width },
      { x: current.x, y: current.worldY, width: current.width },
      current.allowWrappingFromPrevious
    );
    if (!reachability.reachable) {
      unreachable += 1;
    }
    safeHorizontalTravels.push(reachability.safeTravel);

    const directDelta =
      current.x + current.width * 0.5 -
      (previous.x + previous.width * 0.5);
    const directDistance = Math.abs(directDelta);
    // Player.update wraps only after the full player width leaves the canvas.
    // The route calculator therefore uses a circumference of width + playerWidth.
    const wrappedDistance = GameConfig.width - directDistance + GameConfig.playerWidth;
    const centerDistance = current.allowWrappingFromPrevious
      ? Math.min(directDistance, wrappedDistance)
      : directDistance;
    const landingAllowance = Math.max(
      0,
      (GameConfig.playerWidth + current.width) * 0.5 -
        GameConfig.minimumLandingOverlap
    );
    const requiredTravel = Math.max(0, centerDistance - landingAllowance);
    const profiles = [
      ...PlatformPhysics.getFrameSteps(),
      1 / 40,
      1 / 48,
      1 / 80,
      1 / 200
    ].map((deltaTime) =>
      independentFlightProfile(GameConfig, verticalGap, deltaTime)
    );
    if (
      profiles.some((profile) =>
        !profile.reachableHeight ||
        requiredTravel > profile.safeHorizontalDistance + 1e-6
      )
    ) {
      independentUnreachable += 1;
    }

    if (current.layerIndex <= GameConfig.safeOpeningLayers) {
      assert.equal(current.type, PlatformType.NORMAL, "opening guaranteed path must be NORMAL");
      assert.equal(
        current.allowWrappingFromPrevious,
        false,
        "opening guaranteed path must not require wrapping"
      );
      assert(
        verticalGap >= GameConfig.openingMinVerticalGap - 1e-6 &&
          verticalGap <= GameConfig.openingMaxVerticalGap + 1e-6,
        `opening vertical gap ${verticalGap} outside configured range`
      );
    }
  }
  assert.equal(unreachable, 0, "unreachable Guaranteed Platforms reported by production physics");
  assert.equal(independentUnreachable, 0, "unreachable Guaranteed Platforms in independent physics");

  const sortedByY = generated.slice().sort((a, b) => a.worldY - b.worldY);
  let overlapCount = 0;
  for (let leftIndex = 0; leftIndex < sortedByY.length; leftIndex += 1) {
    const left = sortedByY[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < sortedByY.length; rightIndex += 1) {
      const right = sortedByY[rightIndex];
      const verticalDistance = right.worldY - left.worldY;
      if (verticalDistance >= GameConfig.platformHeight + GameConfig.platformVerticalPadding) {
        break;
      }
      const leftEnvelope = horizontalEnvelope(left, PlatformType);
      const rightEnvelope = horizontalEnvelope(right, PlatformType);
      const horizontallyTooClose =
        leftEnvelope.left <
          rightEnvelope.right + GameConfig.platformHorizontalPadding &&
        leftEnvelope.right + GameConfig.platformHorizontalPadding >
          rightEnvelope.left;
      if (horizontallyTooClose) {
        overlapCount += 1;
      }
    }
  }
  assert.equal(overlapCount, 0, "overlapping or insufficiently padded platforms");

  const highestWorldY = Math.min(...generated.map((platform) => platform.worldY));
  const densitySamples = [];
  for (
    let viewportTop = -GameConfig.height;
    viewportTop >= highestWorldY + GameConfig.height;
    viewportTop -= GameConfig.height * 0.25
  ) {
    densitySamples.push(generated.filter((platform) =>
      platform.worldY >= viewportTop &&
      platform.worldY < viewportTop + GameConfig.height
    ).length);
  }
  const averageDensity =
    densitySamples.reduce((sum, count) => sum + count, 0) / densitySamples.length;
  assert(
    averageDensity >= 7 && averageDensity <= 11,
    `average visible platform density ${averageDensity} outside target 7..11`
  );

  const buckets = [0, 0, 0];
  for (const platform of generated.slice(1)) {
    const center = platform.x + platform.width * 0.5;
    buckets[Math.min(2, Math.floor(center / (GameConfig.width / 3)))] += 1;
  }
  const usedPlatforms = buckets.reduce((sum, count) => sum + count, 0);
  for (const count of buckets) {
    assert(
      count / usedPlatforms >= 0.15,
      `screen-width distribution is too concentrated: ${buckets.join(",")}`
    );
  }

  return {
    averageDensity: round(averageDensity, 3),
    fallbackCount: guaranteed.filter((platform) => platform.generationFallback).length,
    generatedPlatformCount: generated.length,
    guaranteedCount: guaranteed.length,
    horizontalBucketCounts: buckets,
    independentUnreachable,
    maxSafeHorizontalTravel: round(Math.max(...safeHorizontalTravels), 3),
    maxVerticalGap: round(Math.max(...verticalGaps), 3),
    minSafeHorizontalTravel: round(Math.min(...safeHorizontalTravels), 3),
    minVerticalGap: round(Math.min(...verticalGaps), 3),
    outOfBounds,
    overlapCount,
    unreachable
  };
}

function validateAnimationLoop() {
  const harness = makeBrowserHarness("animation-loop-seed");
  assert.equal(harness.raf.pending, 1, "game must schedule one initial animation frame");
  assert.equal(harness.raf.requests, 1);

  for (let reset = 0; reset < 4; reset += 1) {
    harness.sandbox.speakiJump.start();
    assert.equal(harness.raf.pending, 1, "start/reset scheduled a duplicate game loop");
  }
  assert.equal(harness.sandbox.speakiJump.getSnapshot().state, "PLAYING");

  const frameCount = 240;
  for (let frame = 0; frame < frameCount; frame += 1) {
    harness.raf.step();
    assert.equal(harness.raf.pending, 1, `frame ${frame} did not leave one pending loop`);
  }
  assert.equal(harness.raf.requests, frameCount + 1);
  return { frameCount, pendingCallbacks: harness.raf.pending };
}

function validateForcedFallback() {
  const harness = makeBrowserHarness("forced-fallback-seed");
  const {
    GameConfig,
    DifficultyManager,
    PlatformManager,
    PlatformType
  } = harness.internals;
  const manager = new PlatformManager(new DifficultyManager(), {
    seed: "forced-fallback-seed",
    debugEnabled: false
  });
  manager.reset(0, false);
  let previousLayer = null;
  while (
    manager.layerIndex < GameConfig.safeOpeningLayers &&
    (!previousLayer || previousLayer.fillers.length === 0)
  ) {
    previousLayer = manager.generateNextLayer(0);
  }
  assert(previousLayer && previousLayer.fillers.length > 0);
  const previous = previousLayer.guaranteed;
  const routeSources = manager.getRequiredRouteSources(previous);
  assert(routeSources.length > 1, "fallback probe needs an opening route choice");
  const existingPlatforms = manager.platforms.slice();
  const outsideBefore = manager.stats.rejectedCandidates.outside;
  const createCandidate = manager.createCandidate.bind(manager);

  // Exercise the recovery branch by making every ordinary candidate fail the
  // production bounds check. Filler generation is unrelated to this probe.
  manager.createCandidate = (...args) => {
    const candidate = createCandidate(...args);
    candidate.x = -candidate.width - GameConfig.sidePadding - 1;
    return candidate;
  };
  manager.generateFillerPlatforms = () => [];

  const layer = manager.generateNextLayer(0);
  const fallback = layer.guaranteed;
  const allRoutesReachFallback = routeSources.every((source) =>
    manager.canReachPlatform(source, fallback, false)
  );

  assert.equal(
    manager.stats.rejectedCandidates.outside - outsideBefore,
    GameConfig.maxGenerationAttempts,
    "forced fallback did not exhaust the ordinary candidate attempts"
  );
  assert.equal(fallback.generationFallback, true, "fallback marker missing");
  assert.equal(fallback.type, PlatformType.NORMAL, "fallback must be NORMAL");
  assert.equal(fallback.isGuaranteed, true, "fallback must remain Guaranteed");
  assert.equal(
    fallback.allowWrappingFromPrevious,
    false,
    "fallback must not require screen wrapping"
  );
  assert.equal(manager.isInsideScreen(fallback), true, "fallback is outside the canvas");
  assert.equal(
    allRoutesReachFallback,
    true,
    "fallback is not reachable from every opening route"
  );
  assert.equal(
    existingPlatforms.some((platform) =>
      manager.platformsAreTooClose(fallback, platform)
    ),
    false,
    "fallback overlaps an existing platform"
  );
  assert.equal(
    manager.layerIndex,
    previous.layerIndex + 1,
    "fallback layer did not advance generation"
  );
  assert.equal(manager.lastGuaranteedPlatform, fallback);
  assert.equal(manager.highestGeneratedY, fallback.y);
  assert.equal(manager.stats.fallbackCount, 1);

  return {
    exhaustedAttempts:
      manager.stats.rejectedCandidates.outside - outsideBefore,
    horizontalDistance: round(
      Math.abs(
        previous.x + previous.width * 0.5 -
        (fallback.x + fallback.width * 0.5)
      ),
      3
    ),
    routeSourceCount: routeSources.length,
    verticalGap: round(previous.y - fallback.y, 3)
  };
}

function validateRealPhysicsLandings() {
  const harness = makeBrowserHarness("real-landing-seed");
  const {
    GameConfig,
    Platform,
    PlatformPhysics,
    PlatformType
  } = harness.internals;
  const game = harness.game;
  const deltaTime = 1 / 60;

  const runProbe = ({ fromCenter, targetCenter, verticalGap, direction, wrapped }) => {
    const fromY = 560;
    const targetWidth = 100;
    const target = new Platform(
      targetCenter - targetWidth * 0.5,
      fromY - verticalGap,
      targetWidth,
      PlatformType.NORMAL
    );
    const reachability = PlatformPhysics.getReachability(
      { x: fromCenter - 50, y: fromY, width: 100 },
      target,
      wrapped
    );
    assert.equal(reachability.reachable, true, "landing probe is not generator-reachable");

    game.platformManager.platforms = [target];
    game.player.reset(
      fromCenter - GameConfig.playerWidth * 0.5,
      fromY - GameConfig.playerHeight
    );
    game.player.vx = -direction * GameConfig.maxMoveSpeed;
    game.player.launch();

    const steerTime =
      reachability.flightTime * GameConfig.controlledSteerFraction;
    let elapsed = 0;
    let crossedScreenEdge = false;
    let landed = false;

    for (let frame = 0; frame < 180 && !landed; frame += 1) {
      const previousX = game.player.x;
      const inputDirection = elapsed < steerTime ? direction : 0;
      game.player.update(deltaTime, inputDirection);
      if (
        Math.abs(game.player.x - previousX) > GameConfig.width * 0.5
      ) {
        crossedScreenEdge = true;
      }
      const descendingBeforeCollision = game.player.vy > 0;
      game.resolveLandings();
      landed = descendingBeforeCollision && game.player.vy < 0;
      elapsed += deltaTime;
    }

    assert.equal(landed, true, wrapped ? "wrapped landing failed" : "direct landing failed");
    assert.equal(
      crossedScreenEdge,
      wrapped,
      wrapped
        ? "wrapped probe never crossed the screen edge"
        : "direct probe unexpectedly wrapped"
    );
    assert.equal(
      round(game.player.y + game.player.height, 6),
      round(target.y, 6),
      "real collision did not snap the player to the target top"
    );

    return {
      crossedScreenEdge,
      directDistance: round(reachability.directDistance, 3),
      horizontalDistance: round(reachability.horizontalDistance, 3),
      wrappedDistance: round(reachability.wrappedDistance, 3)
    };
  };

  const direct = runProbe({
    fromCenter: 190,
    targetCenter: 285,
    verticalGap: 90,
    direction: 1,
    wrapped: false
  });
  const wrapped = runProbe({
    fromCenter: 50,
    targetCenter: 420,
    verticalGap: 80,
    direction: -1,
    wrapped: true
  });
  assert(
    wrapped.horizontalDistance < wrapped.directDistance,
    "wrapped route was not the shorter route"
  );

  return { direct, wrapped };
}

function validateOpeningRoutes() {
  const harness = makeBrowserHarness("opening-route-bootstrap");
  const {
    GameConfig,
    DifficultyManager,
    PlatformManager,
    PlatformPhysics
  } = harness.internals;
  const seedCount = Number.parseInt(
    process.env.OPENING_ROUTE_SEEDS || "512",
    10
  );
  assert(Number.isInteger(seedCount) && seedCount >= 1);
  let totalFillers = 0;
  let minimumFillers = Infinity;
  let maximumFillers = 0;
  let unreachableIntoFiller = 0;
  let unreachableFromFiller = 0;

  for (let seedIndex = 0; seedIndex < seedCount; seedIndex += 1) {
    const seed = Math.imul(seedIndex + 1, 0x9e3779b1) >>> 0;
    const manager = new PlatformManager(new DifficultyManager(), {
      seed,
      debugEnabled: false
    });
    const start = manager.reset(0, false);
    const layers = [];

    for (
      let layerIndex = 1;
      layerIndex <= GameConfig.safeOpeningLayers + 1;
      layerIndex += 1
    ) {
      const previous = manager.lastGuaranteedPlatform;
      const score = Math.max(0, Math.floor(GameConfig.startPlatformY - previous.y));
      layers.push(manager.generateNextLayer(score));
    }

    let fillersForSeed = 0;
    for (
      let layerOffset = 0;
      layerOffset < GameConfig.safeOpeningLayers;
      layerOffset += 1
    ) {
      const previousGuaranteed = layerOffset === 0
        ? start
        : layers[layerOffset - 1].guaranteed;
      const currentLayer = layers[layerOffset];
      const nextGuaranteed = layers[layerOffset + 1].guaranteed;
      fillersForSeed += currentLayer.fillers.length;

      for (const filler of currentLayer.fillers) {
        if (!PlatformPhysics.getReachability(
          previousGuaranteed,
          filler,
          false
        ).reachable) {
          unreachableIntoFiller += 1;
        }
        if (!PlatformPhysics.getReachability(
          filler,
          nextGuaranteed,
          false
        ).reachable) {
          unreachableFromFiller += 1;
        }
      }
    }

    assert(
      fillersForSeed >= 2,
      `seed ${seed} did not create two opening route choices`
    );
    totalFillers += fillersForSeed;
    minimumFillers = Math.min(minimumFillers, fillersForSeed);
    maximumFillers = Math.max(maximumFillers, fillersForSeed);
  }

  assert.equal(unreachableIntoFiller, 0, "an opening filler cannot be entered safely");
  assert.equal(unreachableFromFiller, 0, "an opening filler cannot rejoin the safe path");

  return {
    maximumFillers,
    minimumFillers,
    seedCount,
    totalFillers,
    unreachableFromFiller,
    unreachableIntoFiller
  };
}

function validateProductionBatch(PlatformManager) {
  const seedCount = Number.parseInt(process.env.BATCH_SEEDS || "32", 10);
  assert(Number.isInteger(seedCount) && seedCount >= 1);
  const layersPerSeed = 1024;
  const aggregate = {
    fallbackCount: 0,
    generationFailures: 0,
    generatedGuaranteedPlatforms: 0,
    horizontalReachViolations: 0,
    layerCountViolations: 0,
    outsidePlatforms: 0,
    overlappingPlatforms: 0,
    totalGeneratedPlatforms: 0,
    unreachableGuaranteed: 0,
    verticalGapViolations: 0
  };
  const densities = [];
  const startedAt = process.hrtime.bigint();

  for (let index = 0; index < seedCount; index += 1) {
    const seed = Math.imul(index + 1, 0x9e3779b1) >>> 0;
    const report = PlatformManager.validateGeneratedPlatforms(layersPerSeed, seed);
    assert.equal(report.generatedGuaranteedPlatforms, layersPerSeed, `seed ${seed} stalled`);
    for (const key of [
      "generationFailures",
      "horizontalReachViolations",
      "layerCountViolations",
      "outsidePlatforms",
      "overlappingPlatforms",
      "unreachableGuaranteed",
      "verticalGapViolations"
    ]) {
      assert.equal(report[key], 0, `production validator ${key} for seed ${seed}`);
    }
    assert(
      report.averageVisiblePlatforms >= 7 && report.averageVisiblePlatforms <= 11,
      `production density ${report.averageVisiblePlatforms} for seed ${seed}`
    );

    for (const key of Object.keys(aggregate)) {
      aggregate[key] += report[key];
    }
    densities.push(report.averageVisiblePlatforms);
  }

  const elapsedSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
  return {
    ...aggregate,
    averageVisiblePlatforms: round(
      densities.reduce((sum, density) => sum + density, 0) / densities.length,
      3
    ),
    elapsedSeconds: round(elapsedSeconds, 3),
    layersPerSeed,
    maximumAverageVisiblePlatforms: Math.max(...densities),
    minimumAverageVisiblePlatforms: Math.min(...densities),
    seedCount
  };
}

const targetGuaranteed = Number.parseInt(process.env.TEST_LAYERS || "1200", 10);
assert(Number.isInteger(targetGuaranteed) && targetGuaranteed >= 1000);
const mainRun = simulateGeneration("layer-validation-seed", targetGuaranteed, false);
const report = validateGeneratedPlatforms(mainRun);

const comparisonLayers = 160;
const repeatedRun = simulateGeneration("layer-validation-seed", 180, false);
assert.deepEqual(
  signature(repeatedRun.generated, comparisonLayers),
  signature(mainRun.generated, comparisonLayers),
  "identical debug seeds did not reproduce the same layout"
);

const reorderedRun = simulateGeneration("layer-validation-seed", 180, true);
assert.deepEqual(
  signature(reorderedRun.generated, comparisonLayers),
  signature(mainRun.generated, comparisonLayers),
  "platform array order changed subsequent generation"
);

const alternateRun = simulateGeneration("different-layout-seed", 120, false);
assert.notDeepEqual(
  signature(alternateRun.generated, 100),
  signature(mainRun.generated, 100),
  "different debug seeds produced an identical layout"
);

const animationLoop = validateAnimationLoop();
const forcedFallback = validateForcedFallback();
const openingRoutes = validateOpeningRoutes();
const realPhysicsLandings = validateRealPhysicsLandings();
const productionBatch = validateProductionBatch(
  mainRun.harness.internals.PlatformManager
);
const output = {
  ...report,
  animationLoop,
  forcedFallback,
  generatedAboveViewportChecks: mainRun.generatedAboveViewportChecks,
  maxActivePlatforms: mainRun.maxActivePlatforms,
  openingRoutes,
  productionBatch,
  reproducibleSeed: true,
  orderIndependent: true,
  realPhysicsLandings,
  spawnAheadChecks: mainRun.spawnAheadChecks
};

process.stdout.write(`Platform generation validation passed.\n${JSON.stringify(output, null, 2)}\n`);
