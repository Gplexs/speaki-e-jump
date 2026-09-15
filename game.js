(function () {
  "use strict";

  const GameConfig = Object.freeze({
    width: 480,
    height: 720,
    gravity: 1850,
    jumpHeightMultiplier: 1.5,
    // Jump height is proportional to launch velocity squared.
    jumpPower: 720 * Math.sqrt(1.5),
    springJumpMultiplier: 1.7,
    moveAcceleration: 2200,
    horizontalFriction: 8,
    maxMoveSpeed: 330,
    maxFallSpeed: 980,
    playerWidth: 34,
    playerHeight: 42,
    platformHeight: 14,
    startPlatformWidth: 132,
    startPlatformY: 650,
    safeOpeningLayers: 7,
    openingMinVerticalGap: 74,
    openingMaxVerticalGap: 94,
    safeVerticalGapRatio: 0.74,
    safeHorizontalReachRatio: 0.76,
    controlledSteerFraction: 0.7,
    minimumLandingOverlap: 12,
    sidePadding: 10,
    platformHorizontalPadding: 14,
    platformVerticalPadding: 18,
    layerYVariation: 20,
    maxGenerationAttempts: 30,
    spawnAheadScreens: 1.25,
    cameraThreshold: 0.4,
    cleanupMargin: 180,
    maxDeltaTime: 1 / 30,
    breakDelay: 0.22,
    bestScoreKey: "speaki-e-jump-best-score",
    debugPlatformGeneration: false,
    debugSeed: null
  });

  const GameState = Object.freeze({
    MENU: "MENU",
    PLAYING: "PLAYING",
    GAME_OVER: "GAME_OVER"
  });

  const PlatformType = Object.freeze({
    NORMAL: "NORMAL",
    MOVING: "MOVING",
    BREAKABLE: "BREAKABLE"
  });

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const lerp = (start, end, amount) => start + (end - start) * amount;
  const round = (value, precision = 3) => {
    const scale = 10 ** precision;
    return Math.round(value * scale) / scale;
  };

  class RandomSource {
    constructor(seed = null) {
      this.initialSeed = seed;
      this.reset();
    }

    static normalizeSeed(seed) {
      if (seed === null || seed === undefined || seed === "") {
        return null;
      }
      if (Number.isFinite(Number(seed))) {
        return Number(seed) >>> 0;
      }

      let hash = 2166136261;
      for (const character of String(seed)) {
        hash ^= character.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
      }
      return hash >>> 0;
    }

    reset(seed = this.initialSeed) {
      this.initialSeed = seed;
      this.state = RandomSource.normalizeSeed(seed);
    }

    next() {
      if (this.state === null) {
        return Math.random();
      }

      // Mulberry32 is compact, deterministic, and sufficient for layout testing.
      this.state = (this.state + 0x6d2b79f5) >>> 0;
      let value = this.state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    }

    range(min, max) {
      return min + this.next() * (max - min);
    }

    chance(probability) {
      return this.next() < probability;
    }

    integer(min, maxInclusive) {
      return Math.floor(this.range(min, maxInclusive + 1));
    }
  }

  class PlatformPhysics {
    static getFrameSteps() {
      return [30, 36, 45, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240]
        .map((framesPerSecond) => 1 / framesPerSecond);
    }

    static simulateVerticalFlight(verticalGap, deltaTime) {
      let y = 0;
      let vy = -GameConfig.jumpPower;
      let elapsed = 0;
      let apex = 0;
      const targetY = -verticalGap;
      const maxSteps = Math.ceil(2.5 / deltaTime);

      for (let step = 1; step <= maxSteps; step += 1) {
        const previousY = y;
        vy = Math.min(vy + GameConfig.gravity * deltaTime, GameConfig.maxFallSpeed);
        y += vy * deltaTime;
        elapsed += deltaTime;
        apex = Math.min(apex, y);

        const crossesTarget =
          vy > 0 &&
          previousY <= targetY + 2 &&
          y >= targetY;
        if (crossesTarget) {
          return { reachable: true, elapsed, steps: step, apex: -apex };
        }

        if (vy > 0 && previousY > targetY + 2 && y > targetY) {
          break;
        }
      }

      return { reachable: false, elapsed, steps: 0, apex: -apex };
    }

    static simulateHorizontalTravel(steps, deltaTime, options = {}) {
      const steerTime = options.steerTime ?? Infinity;
      let vx = options.initialVelocity ?? 0;
      let x = 0;
      let elapsed = 0;

      for (let step = 0; step < steps; step += 1) {
        const direction = elapsed < steerTime ? 1 : 0;
        if (direction !== 0) {
          vx += direction * GameConfig.moveAcceleration * deltaTime;
        } else {
          vx *= Math.exp(-GameConfig.horizontalFriction * deltaTime);
          if (Math.abs(vx) < 0.5) {
            vx = 0;
          }
        }
        vx = clamp(vx, -GameConfig.maxMoveSpeed, GameConfig.maxMoveSpeed);
        x += vx * deltaTime;
        elapsed += deltaTime;
      }

      return { distance: x, velocity: vx };
    }

    static getMaximumJumpHeight() {
      if (Number.isFinite(this.maximumJumpHeightCache)) {
        return this.maximumJumpHeightCache;
      }
      this.maximumJumpHeightCache = Math.min(...this.getFrameSteps().map((deltaTime) => {
        let y = 0;
        let vy = -GameConfig.jumpPower;
        let apex = 0;
        while (vy < 0) {
          vy = Math.min(vy + GameConfig.gravity * deltaTime, GameConfig.maxFallSpeed);
          y += vy * deltaTime;
          apex = Math.min(apex, y);
        }
        return -apex;
      }));
      return this.maximumJumpHeightCache;
    }

    static getHorizontalFlightMetrics(verticalGap) {
      // Rounding the target upward is conservative: a higher platform is reached
      // sooner and leaves less time for horizontal movement. It also lets the
      // generator reuse the same real-physics result for nearby candidates.
      const simulatedGap = Math.ceil(verticalGap * 2) / 2;
      const cacheKey = simulatedGap.toFixed(1);
      if (!this.flightMetricCache) {
        this.flightMetricCache = new Map();
      }
      if (this.flightMetricCache.has(cacheKey)) {
        return this.flightMetricCache.get(cacheKey);
      }

      const profiles = this.getFrameSteps().map((deltaTime) => {
        const vertical = this.simulateVerticalFlight(simulatedGap, deltaTime);
        if (!vertical.reachable) {
          return { vertical, theoretical: 0, controlled: 0 };
        }

        const steerTime = vertical.elapsed * GameConfig.controlledSteerFraction;
        const theoretical = this.simulateHorizontalTravel(
          vertical.steps,
          deltaTime
        );
        const controlled = this.simulateHorizontalTravel(
          vertical.steps,
          deltaTime,
          {
            steerTime,
            // A safe route remains controllable even after landing at full speed
            // in the direction opposite to the next platform.
            initialVelocity: -GameConfig.maxMoveSpeed
          }
        );
        return { vertical, theoretical, controlled };
      });
      const frameQuantizationReserve = GameConfig.maxMoveSpeed * GameConfig.maxDeltaTime;
      const theoreticalTravel = Math.min(
        ...profiles.map((profile) => profile.theoretical.distance)
      );
      const controlledTravel = Math.min(
        ...profiles.map((profile) => Math.max(0, profile.controlled.distance))
      );
      const metrics = {
        allFramesReachHeight: profiles.every((profile) => profile.vertical.reachable),
        theoreticalTravel,
        controlledTravel,
        safeTravel: Math.min(
          theoreticalTravel * GameConfig.safeHorizontalReachRatio,
          Math.max(0, controlledTravel * 0.92 - frameQuantizationReserve)
        ),
        flightTime: Math.min(...profiles.map((profile) => profile.vertical.elapsed))
      };
      this.flightMetricCache.set(cacheKey, metrics);
      return metrics;
    }

    static getReachability(fromPlatform, toPlatform, allowWrapping) {
      const verticalGap = fromPlatform.y - toPlatform.y;
      const maximumJumpHeight = this.getMaximumJumpHeight();
      const safeVerticalReach = maximumJumpHeight * GameConfig.safeVerticalGapRatio;
      const directDistance = Math.abs(
        (fromPlatform.x + fromPlatform.width * 0.5) -
        (toPlatform.x + toPlatform.width * 0.5)
      );
      // Player wrapping occurs only after its full width has left the screen.
      const wrappedDistance = GameConfig.width - directDistance + GameConfig.playerWidth;
      const horizontalDistance = allowWrapping
        ? Math.min(directDistance, wrappedDistance)
        : directDistance;
      const landingAllowance = Math.max(
        0,
        (GameConfig.playerWidth + toPlatform.width) * 0.5 -
          GameConfig.minimumLandingOverlap
      );

      if (verticalGap <= 0 || verticalGap > safeVerticalReach) {
        return {
          reachable: false,
          verticalGap,
          maximumJumpHeight,
          safeVerticalReach,
          directDistance,
          wrappedDistance,
          horizontalDistance,
          landingAllowance,
          requiredTravel: Infinity,
          theoreticalTravel: 0,
          safeTravel: 0,
          safeCenterReach: 0,
          flightTime: 0
        };
      }

      const flight = this.getHorizontalFlightMetrics(verticalGap);
      const safeTravel = flight.safeTravel;
      const safeCenterReach = safeTravel + landingAllowance;
      const requiredTravel = Math.max(0, horizontalDistance - landingAllowance);

      return {
        reachable: flight.allFramesReachHeight && requiredTravel <= safeTravel + 1e-6,
        verticalGap,
        maximumJumpHeight,
        safeVerticalReach,
        directDistance,
        wrappedDistance,
        horizontalDistance,
        landingAllowance,
        requiredTravel,
        theoreticalTravel: flight.theoreticalTravel,
        controlledTravel: flight.controlledTravel,
        safeTravel,
        safeCenterReach,
        flightTime: flight.flightTime
      };
    }
  }

  function getPlatformDebugOptions() {
    let enabled = GameConfig.debugPlatformGeneration;
    let seed = GameConfig.debugSeed;
    try {
      const parameters = new URLSearchParams(window.location.search);
      enabled = enabled || parameters.get("platformDebug") === "1";
      if (parameters.has("platformSeed")) {
        seed = parameters.get("platformSeed");
      }
    } catch (error) {
      // URL options are unavailable in a minimal test environment.
    }
    return { enabled, seed };
  }

  class InputManager {
    constructor(canvas, onAction) {
      this.canvas = canvas;
      this.onAction = onAction;
      this.left = false;
      this.right = false;

      this.handleKeyDown = this.handleKeyDown.bind(this);
      this.handleKeyUp = this.handleKeyUp.bind(this);
      this.handlePointerDown = this.handlePointerDown.bind(this);
      this.clear = this.clear.bind(this);

      window.addEventListener("keydown", this.handleKeyDown, { passive: false });
      window.addEventListener("keyup", this.handleKeyUp, { passive: false });
      window.addEventListener("blur", this.clear);
      canvas.addEventListener("pointerdown", this.handlePointerDown);
    }

    handleKeyDown(event) {
      const handledKeys = ["ArrowLeft", "ArrowRight", "Space", "Enter", "KeyA", "KeyD", "KeyR"];
      if (handledKeys.includes(event.code)) {
        event.preventDefault();
      }

      if (event.code === "ArrowLeft" || event.code === "KeyA") {
        this.left = true;
      }
      if (event.code === "ArrowRight" || event.code === "KeyD") {
        this.right = true;
      }

      if (!event.repeat && ["Space", "Enter", "KeyR"].includes(event.code)) {
        this.onAction(event.code);
      }
    }

    handleKeyUp(event) {
      if (["ArrowLeft", "ArrowRight", "Space"].includes(event.code)) {
        event.preventDefault();
      }
      if (event.code === "ArrowLeft" || event.code === "KeyA") {
        this.left = false;
      }
      if (event.code === "ArrowRight" || event.code === "KeyD") {
        this.right = false;
      }
    }

    handlePointerDown(event) {
      event.preventDefault();
      this.canvas.focus({ preventScroll: true });
      this.onAction("Pointer");
    }

    get direction() {
      return Number(this.right) - Number(this.left);
    }

    clear() {
      this.left = false;
      this.right = false;
    }
  }

  class Player {
    constructor(x, y) {
      this.width = GameConfig.playerWidth;
      this.height = GameConfig.playerHeight;
      this.reset(x, y);
    }

    reset(x, y) {
      this.x = x;
      this.y = y;
      this.previousX = x;
      this.previousY = y;
      this.vx = 0;
      this.vy = 0;
    }

    launch(multiplier = 1) {
      this.vy = -GameConfig.jumpPower * multiplier;
    }

    update(deltaTime, direction) {
      this.previousX = this.x;
      this.previousY = this.y;

      if (direction !== 0) {
        this.vx += direction * GameConfig.moveAcceleration * deltaTime;
      } else {
        this.vx *= Math.exp(-GameConfig.horizontalFriction * deltaTime);
        if (Math.abs(this.vx) < 0.5) {
          this.vx = 0;
        }
      }

      this.vx = clamp(this.vx, -GameConfig.maxMoveSpeed, GameConfig.maxMoveSpeed);
      this.vy = Math.min(this.vy + GameConfig.gravity * deltaTime, GameConfig.maxFallSpeed);
      this.x += this.vx * deltaTime;
      this.y += this.vy * deltaTime;

      if (this.x + this.width < 0) {
        this.x = GameConfig.width;
        this.previousX = this.x;
      } else if (this.x > GameConfig.width) {
        this.x = -this.width;
        this.previousX = this.x;
      }
    }
  }

  class Spring {
    constructor(platform, offsetX) {
      this.platform = platform;
      this.offsetX = offsetX;
      this.width = 20;
      this.height = 12;
    }

    get x() {
      return this.platform.x + this.offsetX;
    }

    get y() {
      return this.platform.y - this.height;
    }
  }

  class Platform {
    constructor(
      x,
      y,
      width,
      type = PlatformType.NORMAL,
      moveRange = 0,
      moveSpeed = 0,
      random = null
    ) {
      this.x = x;
      this.y = y;
      this.width = width;
      this.height = GameConfig.platformHeight;
      this.type = type;
      this.item = null;
      this.breaking = false;
      this.breakTimer = 0;
      this.removed = false;
      this.layerIndex = 0;
      this.isGuaranteed = false;
      this.allowWrappingFromPrevious = false;
      this.generationFallback = false;
      this.generationSettings = null;
      this.moveDirection = type === PlatformType.MOVING && random && random.next() < 0.5
        ? -1
        : 1;
      this.moveSpeed = moveSpeed;
      this.moveMin = Math.max(GameConfig.sidePadding, x - moveRange);
      this.moveMax = Math.min(
        GameConfig.width - width - GameConfig.sidePadding,
        x + moveRange
      );
    }

    addSpring(random) {
      const inset = 8;
      const maxOffset = Math.max(inset, this.width - 20 - inset);
      this.item = new Spring(this, random.range(inset, maxOffset));
    }

    beginBreaking() {
      if (this.type === PlatformType.BREAKABLE && !this.breaking) {
        this.breaking = true;
        this.breakTimer = GameConfig.breakDelay;
      }
    }

    update(deltaTime) {
      if (this.type === PlatformType.MOVING && !this.breaking) {
        this.x += this.moveDirection * this.moveSpeed * deltaTime;
        if (this.x <= this.moveMin) {
          this.x = this.moveMin;
          this.moveDirection = 1;
        } else if (this.x >= this.moveMax) {
          this.x = this.moveMax;
          this.moveDirection = -1;
        }
      }

      if (this.breaking) {
        this.breakTimer -= deltaTime;
        if (this.breakTimer <= 0) {
          this.removed = true;
        }
      }
    }
  }

  class DifficultyManager {
    getSettings(score, layerIndex) {
      const level = clamp(score / 12000, 0, 1);
      const maximumJumpHeight = PlatformPhysics.getMaximumJumpHeight();
      const safeVerticalReach = maximumJumpHeight * GameConfig.safeVerticalGapRatio;
      const opening = layerIndex <= GameConfig.safeOpeningLayers;

      const minGap = opening
        ? GameConfig.openingMinVerticalGap
        : maximumJumpHeight * lerp(0.45, 0.53, level);
      const maxGap = opening
        ? GameConfig.openingMaxVerticalGap
        : Math.min(
          maximumJumpHeight * lerp(0.59, 0.73, level),
          safeVerticalReach - 2
        );

      return {
        level,
        opening,
        minGap,
        maxGap,
        minWidth: opening ? 102 : lerp(94, 72, level),
        maxWidth: opening ? 116 : lerp(116, 96, level),
        movingChance: lerp(0.06, 0.23, level),
        breakableChance: lerp(0.04, 0.18, level),
        springChance: lerp(0.05, 0.1, level),
        oneFillerChance: opening ? 0.1 : lerp(0.22, 0.18, level),
        twoFillerChance: opening ? 0.01 : lerp(0.04, 0.025, level),
        wrapChance: opening ? 0 : lerp(0.12, 0.28, level),
        maximumJumpHeight,
        safeVerticalReach
      };
    }
  }

  class PlatformManager {
    constructor(difficultyManager, options = {}) {
      this.difficultyManager = difficultyManager;
      const debugOptions = getPlatformDebugOptions();
      const hasSeedOverride = Object.prototype.hasOwnProperty.call(options, "seed");
      this.debugEnabled = options.debugEnabled ?? debugOptions.enabled;
      this.seed = hasSeedOverride ? options.seed : debugOptions.seed;
      this.random = new RandomSource(this.seed);
      this.platforms = [];
      this.generatedCount = 0;
      this.layerIndex = 0;
      this.lastGuaranteedPlatform = null;
      this.highestGeneratedY = GameConfig.startPlatformY;
      this.recentGuaranteed = [];
      this.recentVerticalGaps = [];
      this.layersSinceFiller = 0;
      this.stats = this.createEmptyStats();
    }

    createEmptyStats() {
      return {
        layersGenerated: 0,
        platformsGenerated: 0,
        fallbackCount: 0,
        skippedFillers: 0,
        rejectedCandidates: {
          unreachable: 0,
          outside: 0,
          overlap: 0,
          unsafe: 0
        }
      };
    }

    initialize(score = 0) {
      return this.reset(score);
    }

    reset(score = 0, preload = true) {
      this.platforms.length = 0;
      this.random.reset(this.seed);
      this.generatedCount = 1;
      this.layerIndex = 0;
      this.recentGuaranteed.length = 0;
      this.recentVerticalGaps.length = 0;
      this.layersSinceFiller = 0;
      this.stats = this.createEmptyStats();

      const startX = (GameConfig.width - GameConfig.startPlatformWidth) / 2;
      const start = new Platform(
        startX,
        GameConfig.startPlatformY,
        GameConfig.startPlatformWidth,
        PlatformType.NORMAL,
        0,
        0,
        this.random
      );
      start.isGuaranteed = true;
      start.layerIndex = 0;
      this.platforms.push(start);
      this.lastGuaranteedPlatform = start;
      this.highestGeneratedY = start.y;
      this.recentGuaranteed.push(start);
      this.stats.platformsGenerated = 1;

      if (preload) {
        this.ensurePlatforms(score);
      }
      return start;
    }

    update(deltaTime) {
      for (const platform of this.platforms) {
        platform.update(deltaTime);
      }
      this.cleanupPlatforms();
    }

    scroll(distance) {
      for (const platform of this.platforms) {
        platform.y += distance;
      }
      this.highestGeneratedY += distance;
    }

    ensurePlatforms(score) {
      const spawnTargetY = -GameConfig.height * GameConfig.spawnAheadScreens;
      let generatedThisUpdate = 0;

      while (this.highestGeneratedY > spawnTargetY && generatedThisUpdate < 64) {
        this.generateNextLayer(score);
        generatedThisUpdate += 1;
      }

      if (this.highestGeneratedY > spawnTargetY) {
        throw new Error("Platform generation did not advance above the spawn target.");
      }
    }

    generateInitialPlatforms(score = 0) {
      return this.reset(score);
    }

    generateNextLayer(score) {
      const nextLayerIndex = this.layerIndex + 1;
      const settings = this.getDifficultySettings(score, nextLayerIndex);
      const previousGuaranteed = this.lastGuaranteedPlatform;
      const routeSources = this.getRequiredRouteSources(previousGuaranteed);
      const guaranteed = this.generateGuaranteedPlatform(
        previousGuaranteed,
        settings,
        nextLayerIndex,
        routeSources
      );

      this.platforms.push(guaranteed);
      const fillers = this.generateFillerPlatforms(
        previousGuaranteed,
        guaranteed,
        settings,
        nextLayerIndex
      );
      this.platforms.push(...fillers);

      this.layerIndex = nextLayerIndex;
      this.lastGuaranteedPlatform = guaranteed;
      this.highestGeneratedY = guaranteed.y;
      this.recentGuaranteed.push(guaranteed);
      if (this.recentGuaranteed.length > 10) {
        this.recentGuaranteed.shift();
      }
      const verticalGap = previousGuaranteed.y - guaranteed.y;
      this.recentVerticalGaps.push(verticalGap);
      if (this.recentVerticalGaps.length > 8) {
        this.recentVerticalGaps.shift();
      }

      if (fillers.length > 0) {
        this.layersSinceFiller = 0;
      } else {
        this.layersSinceFiller += 1;
      }
      this.generatedCount += 1 + fillers.length;
      this.stats.layersGenerated += 1;
      this.stats.platformsGenerated += 1 + fillers.length;

      if (this.debugEnabled) {
        const reach = PlatformPhysics.getReachability(
          previousGuaranteed,
          guaranteed,
          guaranteed.allowWrappingFromPrevious
        );
        console.debug("[Platform layer]", {
          layer: nextLayerIndex,
          x: round(guaranteed.x),
          y: round(guaranteed.y),
          verticalGap: round(reach.verticalGap),
          horizontalDistance: round(reach.horizontalDistance),
          safeHorizontalReach: round(reach.safeCenterReach),
          reachable: reach.reachable,
          fillers: fillers.length,
          fallback: guaranteed.generationFallback
        });
      }

      return { guaranteed, fillers, settings };
    }

    generateGuaranteedPlatform(previous, settings, layerIndex, routeSources = [previous]) {
      let bestCandidate = null;
      let bestScore = -Infinity;

      for (let attempt = 0; attempt < GameConfig.maxGenerationAttempts; attempt += 1) {
        const candidate = this.createCandidate(previous, settings, layerIndex);
        if (!this.isInsideScreen(candidate)) {
          this.rejectCandidate("outside");
          continue;
        }

        const reach = PlatformPhysics.getReachability(
          previous,
          candidate,
          candidate.allowWrappingFromPrevious
        );
        if (!reach.reachable) {
          this.rejectCandidate("unreachable");
          continue;
        }
        const rejoinsOpeningRoutes = routeSources.every((source) =>
          PlatformPhysics.getReachability(
            source,
            candidate,
            source === previous ? candidate.allowWrappingFromPrevious : false
          ).reachable
        );
        if (!rejoinsOpeningRoutes) {
          this.rejectCandidate("unreachable");
          continue;
        }
        if (this.overlapsExistingPlatform(candidate)) {
          this.rejectCandidate("overlap");
          continue;
        }

        candidate.reachability = reach;
        const candidateScore = this.scoreGuaranteedCandidate(candidate, reach);
        if (candidateScore > bestScore) {
          bestCandidate = candidate;
          bestScore = candidateScore;
        }
      }

      if (bestCandidate) {
        return bestCandidate;
      }

      return this.createFallbackGuaranteed(
        previous,
        settings,
        layerIndex,
        routeSources
      );
    }

    getRequiredRouteSources(previousGuaranteed) {
      if (previousGuaranteed.layerIndex > GameConfig.safeOpeningLayers) {
        return [previousGuaranteed];
      }

      return this.platforms.filter(
        (platform) =>
          platform.layerIndex === previousGuaranteed.layerIndex &&
          !platform.removed
      );
    }

    createCandidate(previous, settings, layerIndex) {
      const gap = this.sampleVerticalGap(settings);
      const width = this.random.range(settings.minWidth, settings.maxWidth);
      const y = previous.y - gap;
      const allowWrapping = !settings.opening && this.random.chance(settings.wrapChance);
      const previousCenter = previous.x + previous.width * 0.5;
      const probe = new Platform(
        previousCenter - width * 0.5,
        y,
        width,
        PlatformType.NORMAL
      );
      const reachBudget = PlatformPhysics.getReachability(previous, probe, allowWrapping);
      const reachScale = settings.opening ? 0.56 : 0.96;
      const maximumShift = reachBudget.safeCenterReach * reachScale;
      const direction = this.random.next() < 0.5 ? -1 : 1;
      let magnitude = maximumShift * lerp(0.12, 1, Math.sqrt(this.random.next()));
      if (this.random.chance(0.14)) {
        magnitude = maximumShift * this.random.range(0.02, 0.2);
      }
      const signedOffset = direction * magnitude;
      let center = previousCenter + signedOffset;
      if (allowWrapping) {
        center = ((center % GameConfig.width) + GameConfig.width) % GameConfig.width;
      }

      const candidate = new Platform(
        center - width * 0.5,
        y,
        width,
        PlatformType.NORMAL,
        0,
        0,
        this.random
      );
      candidate.layerIndex = layerIndex;
      candidate.isGuaranteed = true;
      candidate.allowWrappingFromPrevious = allowWrapping;
      candidate.generationSettings = settings;
      candidate.generationSignedOffset = signedOffset;
      return candidate;
    }

    sampleVerticalGap(settings) {
      let gap = this.random.range(settings.minGap, settings.maxGap);
      for (let attempt = 0; attempt < 6 && this.recentVerticalGaps.length >= 2; attempt += 1) {
        const recent = this.recentVerticalGaps.slice(-2);
        const repeatsBoth = recent.every((value) => Math.abs(value - gap) < 4);
        if (!repeatsBoth) {
          break;
        }
        gap = this.random.range(settings.minGap, settings.maxGap);
      }
      return gap;
    }

    scoreGuaranteedCandidate(candidate, reach) {
      const center = candidate.x + candidate.width * 0.5;
      const zone = this.getHorizontalZone(center);
      const zoneCounts = [0, 0, 0];
      for (const platform of this.recentGuaranteed.slice(-8)) {
        zoneCounts[this.getHorizontalZone(platform.x + platform.width * 0.5)] += 1;
      }

      const leastUsed = Math.min(...zoneCounts);
      let score = (leastUsed - zoneCounts[zone]) * 13;
      const distanceRatio = reach.safeCenterReach > 0
        ? reach.horizontalDistance / reach.safeCenterReach
        : 0;
      const idealDistanceRatio = candidate.generationSettings.opening ? 0.34 : 0.55;
      score += 32 - Math.abs(distanceRatio - idealDistanceRatio) * 42;

      const recentZones = this.recentGuaranteed
        .slice(-3)
        .map((platform) => this.getHorizontalZone(platform.x + platform.width * 0.5));
      if (recentZones.length === 3 && recentZones.every((recentZone) => recentZone === zone)) {
        score -= 38;
      }

      const recentDirections = this.recentGuaranteed
        .slice(-2)
        .map((platform) => Math.sign(platform.generationSignedOffset || 0))
        .filter((direction) => direction !== 0);
      const direction = Math.sign(candidate.generationSignedOffset);
      if (
        recentDirections.length === 2 &&
        recentDirections[0] === -recentDirections[1] &&
        direction === -recentDirections[1]
      ) {
        score -= 28;
      }

      if (
        this.recentVerticalGaps.length >= 2 &&
        this.recentVerticalGaps.slice(-2).every(
          (gap) => Math.abs(gap - reach.verticalGap) < 5
        )
      ) {
        score -= 22;
      }

      return score + this.random.range(0, 18);
    }

    createFallbackGuaranteed(
      previous,
      settings,
      layerIndex,
      routeSources = [previous]
    ) {
      const width = settings.maxWidth;
      const gap = settings.minGap;
      const y = previous.y - gap;
      const previousCenter = previous.x + previous.width * 0.5;
      const minimumCenter = GameConfig.sidePadding + width * 0.5;
      const maximumCenter = GameConfig.width - GameConfig.sidePadding - width * 0.5;
      let feasibleMinimumCenter = minimumCenter;
      let feasibleMaximumCenter = maximumCenter;
      let canPreserveEveryRoute = true;

      for (const source of routeSources) {
        const sourceCenter = source.x + source.width * 0.5;
        const probe = new Platform(
          sourceCenter - width * 0.5,
          y,
          width,
          PlatformType.NORMAL
        );
        const reach = PlatformPhysics.getReachability(source, probe, false);
        if (!reach.reachable) {
          canPreserveEveryRoute = false;
          break;
        }
        feasibleMinimumCenter = Math.max(
          feasibleMinimumCenter,
          sourceCenter - reach.safeCenterReach
        );
        feasibleMaximumCenter = Math.min(
          feasibleMaximumCenter,
          sourceCenter + reach.safeCenterReach
        );
      }

      let fallbackRouteSources = routeSources;
      if (
        !canPreserveEveryRoute ||
        feasibleMinimumCenter > feasibleMaximumCenter
      ) {
        feasibleMinimumCenter = minimumCenter;
        feasibleMaximumCenter = maximumCenter;
        // Optional opening branches may be dropped only if their safe ranges
        // cannot intersect. The primary Guaranteed Path must still continue.
        fallbackRouteSources = [previous];
      }
      const fallbackCenter = clamp(
        previousCenter,
        feasibleMinimumCenter,
        feasibleMaximumCenter
      );
      const centers = [
        fallbackCenter,
        (feasibleMinimumCenter + feasibleMaximumCenter) * 0.5,
        feasibleMinimumCenter,
        feasibleMaximumCenter
      ];

      for (const center of centers) {
        const fallback = new Platform(
          center - width * 0.5,
          y,
          width,
          PlatformType.NORMAL,
          0,
          0,
          this.random
        );
        fallback.layerIndex = layerIndex;
        fallback.isGuaranteed = true;
        fallback.allowWrappingFromPrevious = false;
        fallback.generationFallback = true;
        fallback.generationSettings = settings;
        fallback.generationSignedOffset = center - previousCenter;
        const reach = PlatformPhysics.getReachability(previous, fallback, false);
        const rejoinsOpeningRoutes = fallbackRouteSources.every((source) =>
          PlatformPhysics.getReachability(source, fallback, false).reachable
        );
        if (
          this.isInsideScreen(fallback) &&
          reach.reachable &&
          rejoinsOpeningRoutes &&
          !this.overlapsExistingPlatform(fallback)
        ) {
          fallback.reachability = reach;
          this.stats.fallbackCount += 1;
          return fallback;
        }
      }

      throw new Error("Unable to create a safe guaranteed fallback platform.");
    }

    generateFillerPlatforms(previous, guaranteed, settings, layerIndex) {
      const desiredCount = this.chooseFillerCount(settings);
      const fillers = [];

      for (let fillerIndex = 0; fillerIndex < desiredCount; fillerIndex += 1) {
        let created = null;
        for (let attempt = 0; attempt < GameConfig.maxGenerationAttempts; attempt += 1) {
          const width = this.random.range(settings.minWidth * 0.88, settings.maxWidth);
          const y = guaranteed.y + this.random.range(
            -GameConfig.layerYVariation,
            GameConfig.layerYVariation
          );
          // Every filler is a genuine alternative for the same jump rather than
          // decorative clutter that can only be reached after the guaranteed one.
          const anchor = previous;
          const allowWrapping = !settings.opening && this.random.chance(settings.wrapChance);
          const probe = new Platform(anchor.x, y, width, PlatformType.NORMAL);
          const budget = PlatformPhysics.getReachability(anchor, probe, allowWrapping);
          if (!budget.reachable) {
            this.rejectCandidate("unsafe");
            continue;
          }

          const direction = this.random.next() < 0.5 ? -1 : 1;
          const shift = budget.safeCenterReach * this.random.range(0.3, 0.9) * direction;
          const anchorCenter = anchor.x + anchor.width * 0.5;
          let center = anchorCenter + shift;
          if (allowWrapping) {
            center = ((center % GameConfig.width) + GameConfig.width) % GameConfig.width;
          }

          let type = PlatformType.NORMAL;
          if (!settings.opening) {
            const typeRoll = this.random.next();
            if (typeRoll < settings.movingChance) {
              type = PlatformType.MOVING;
            } else if (typeRoll < settings.movingChance + settings.breakableChance) {
              type = PlatformType.BREAKABLE;
            }
          }
          const moveRange = type === PlatformType.MOVING
            ? this.random.range(24, 48)
            : 0;
          const moveSpeed = type === PlatformType.MOVING
            ? this.random.range(42, 78)
            : 0;
          const candidate = new Platform(
            center - width * 0.5,
            y,
            width,
            type,
            moveRange,
            moveSpeed,
            this.random
          );
          candidate.layerIndex = layerIndex;
          candidate.isGuaranteed = false;
          candidate.allowWrappingFromPrevious = allowWrapping;
          candidate.generationSettings = settings;

          const reach = PlatformPhysics.getReachability(anchor, candidate, allowWrapping);
          if (!this.isInsideScreen(candidate)) {
            this.rejectCandidate("outside");
            continue;
          }
          if (!reach.reachable) {
            this.rejectCandidate("unreachable");
            continue;
          }
          if (this.overlapsExistingPlatform(candidate, fillers)) {
            this.rejectCandidate("overlap");
            continue;
          }

          candidate.reachability = reach;
          if (
            type === PlatformType.NORMAL &&
            this.random.chance(settings.springChance)
          ) {
            candidate.addSpring(this.random);
          }
          created = candidate;
          break;
        }

        if (
          !created &&
          settings.opening &&
          fillerIndex === 0 &&
          this.layersSinceFiller >= 2
        ) {
          created = this.createOpeningFillerFallback(
            previous,
            guaranteed,
            settings,
            layerIndex,
            fillers
          );
        }

        if (created) {
          fillers.push(created);
        } else {
          this.stats.skippedFillers += 1;
        }
      }

      return fillers;
    }

    createOpeningFillerFallback(
      anchor,
      guaranteed,
      settings,
      layerIndex,
      additionalPlatforms
    ) {
      // A rare forced opening choice may need a narrower landing surface to fit
      // safely between a screen edge and the Guaranteed Platform.
      const width = Math.max(72, settings.minWidth * 0.7);
      const halfWidth = width * 0.5;
      const anchorCenter = anchor.x + anchor.width * 0.5;
      const guaranteedCenter = guaranteed.x + guaranteed.width * 0.5;
      const verticalVariations = [
        0,
        -GameConfig.layerYVariation,
        GameConfig.layerYVariation,
        -GameConfig.layerYVariation * 0.5,
        GameConfig.layerYVariation * 0.5
      ];

      for (const variation of verticalVariations) {
        const y = guaranteed.y + variation;
        const probe = new Platform(
          anchorCenter - halfWidth,
          y,
          width,
          PlatformType.NORMAL
        );
        const budget = PlatformPhysics.getReachability(anchor, probe, false);
        if (!budget.reachable) {
          continue;
        }

        const minimumCenter = Math.max(
          GameConfig.sidePadding + halfWidth,
          anchorCenter - budget.safeCenterReach
        );
        const maximumCenter = Math.min(
          GameConfig.width - GameConfig.sidePadding - halfWidth,
          anchorCenter + budget.safeCenterReach
        );
        const separation =
          (width + guaranteed.width) * 0.5 +
          GameConfig.platformHorizontalPadding;
        const leftClearCenter = Math.min(
          maximumCenter,
          guaranteedCenter - separation
        );
        const rightClearCenter = Math.max(
          minimumCenter,
          guaranteedCenter + separation
        );
        const centers = guaranteedCenter >= anchorCenter
          ? [leftClearCenter, minimumCenter, rightClearCenter, maximumCenter]
          : [rightClearCenter, maximumCenter, leftClearCenter, minimumCenter];

        for (const center of centers) {
          if (center < minimumCenter || center > maximumCenter) {
            continue;
          }
          const candidate = new Platform(
            center - halfWidth,
            y,
            width,
            PlatformType.NORMAL,
            0,
            0,
            this.random
          );
          candidate.layerIndex = layerIndex;
          candidate.isGuaranteed = false;
          candidate.allowWrappingFromPrevious = false;
          candidate.generationSettings = settings;

          const reach = PlatformPhysics.getReachability(anchor, candidate, false);
          if (
            this.isInsideScreen(candidate) &&
            reach.reachable &&
            !this.overlapsExistingPlatform(candidate, additionalPlatforms)
          ) {
            candidate.reachability = reach;
            return candidate;
          }
        }
      }

      return null;
    }

    chooseFillerCount(settings) {
      const roll = this.random.next();
      let count = roll < settings.twoFillerChance
        ? 2
        : roll < settings.twoFillerChance + settings.oneFillerChance
          ? 1
          : 0;
      if (this.layersSinceFiller >= 2) {
        count = Math.max(1, count);
      }
      return count;
    }

    canReachPlatform(fromPlatform, toPlatform, allowWrapping = false) {
      return PlatformPhysics.getReachability(
        fromPlatform,
        toPlatform,
        allowWrapping
      ).reachable;
    }

    overlapsExistingPlatform(candidate, additionalPlatforms = []) {
      return [...this.platforms, ...additionalPlatforms].some(
        (platform) => this.platformsAreTooClose(candidate, platform)
      );
    }

    platformsAreTooClose(first, second) {
      const firstEnvelope = this.getHorizontalEnvelope(first);
      const secondEnvelope = this.getHorizontalEnvelope(second);
      const horizontalOverlap =
        firstEnvelope.left <
          secondEnvelope.right + GameConfig.platformHorizontalPadding &&
        firstEnvelope.right + GameConfig.platformHorizontalPadding >
          secondEnvelope.left;
      const verticalOverlap =
        first.y <
          second.y + second.height + GameConfig.platformVerticalPadding &&
        first.y + first.height + GameConfig.platformVerticalPadding >
          second.y;
      return horizontalOverlap && verticalOverlap;
    }

    getHorizontalEnvelope(platform) {
      if (platform.type === PlatformType.MOVING) {
        return {
          left: platform.moveMin,
          right: platform.moveMax + platform.width
        };
      }
      return { left: platform.x, right: platform.x + platform.width };
    }

    isInsideScreen(platform) {
      const envelope = this.getHorizontalEnvelope(platform);
      return (
        platform.x >= GameConfig.sidePadding - 1e-6 &&
        platform.x + platform.width <= GameConfig.width - GameConfig.sidePadding + 1e-6 &&
        envelope.left >= GameConfig.sidePadding - 1e-6 &&
        envelope.right <= GameConfig.width - GameConfig.sidePadding + 1e-6
      );
    }

    getHorizontalZone(center) {
      return Math.min(2, Math.floor(center / (GameConfig.width / 3)));
    }

    rejectCandidate(reason) {
      if (Object.prototype.hasOwnProperty.call(this.stats.rejectedCandidates, reason)) {
        this.stats.rejectedCandidates[reason] += 1;
      }
    }

    getDifficultySettings(score, layerIndex) {
      return this.difficultyManager.getSettings(score, layerIndex);
    }

    cleanupPlatforms() {
      const cleanupY = GameConfig.height + GameConfig.cleanupMargin;
      this.platforms = this.platforms.filter(
        (platform) => !platform.removed && platform.y < cleanupY
      );
    }

    static validateGeneratedPlatforms(requestedCount = 1000, seed = 1337) {
      const count = clamp(Math.floor(requestedCount), 1, 10000);
      const manager = new PlatformManager(new DifficultyManager(), {
        seed,
        debugEnabled: false
      });
      const start = manager.reset(0, false);
      const allPlatforms = [start];
      let previous = start;
      let unreachableGuaranteed = 0;
      let outsidePlatforms = 0;
      let overlappingPlatforms = 0;
      let verticalGapViolations = 0;
      let horizontalReachViolations = 0;
      let layerCountViolations = 0;
      let generationFailures = 0;
      const verticalGaps = [];
      const safeHorizontalTravel = [];
      const safeCenterReach = [];

      for (let index = 0; index < count; index += 1) {
        const score = Math.max(0, Math.floor(GameConfig.startPlatformY - previous.y));
        const previouslyActive = manager.platforms.slice();
        let layer;
        try {
          layer = manager.generateNextLayer(score);
        } catch (error) {
          generationFailures += 1;
          break;
        }

        const additions = [layer.guaranteed, ...layer.fillers];
        if (additions.length < 1 || additions.length > 3) {
          layerCountViolations += 1;
        }

        const reach = PlatformPhysics.getReachability(
          previous,
          layer.guaranteed,
          layer.guaranteed.allowWrappingFromPrevious
        );
        if (!reach.reachable) {
          unreachableGuaranteed += 1;
        }
        if (
          reach.verticalGap < layer.settings.minGap - 1e-6 ||
          reach.verticalGap > layer.settings.maxGap + 1e-6 ||
          reach.verticalGap > layer.settings.safeVerticalReach + 1e-6
        ) {
          verticalGapViolations += 1;
        }
        if (reach.requiredTravel > reach.safeTravel + 1e-6) {
          horizontalReachViolations += 1;
        }
        verticalGaps.push(reach.verticalGap);
        safeHorizontalTravel.push(reach.safeTravel);
        safeCenterReach.push(reach.safeCenterReach);

        const checkedAdditions = [];
        for (const platform of additions) {
          if (!manager.isInsideScreen(platform)) {
            outsidePlatforms += 1;
          }
          for (const existing of [...previouslyActive, ...checkedAdditions]) {
            if (manager.platformsAreTooClose(platform, existing)) {
              overlappingPlatforms += 1;
            }
          }
          checkedAdditions.push(platform);
          allPlatforms.push(platform);
        }
        previous = layer.guaranteed;
        // Keep production candidate checks bounded like runtime cleanup while
        // retaining all generated platforms separately for aggregate metrics.
        manager.platforms = manager.platforms.filter(
          (platform) => platform.y < manager.highestGeneratedY + GameConfig.height
        );
      }

      const visibleCounts = [];
      for (
        let viewportTop = 0;
        viewportTop >= manager.highestGeneratedY;
        viewportTop -= GameConfig.height * 0.25
      ) {
        const viewportBottom = viewportTop + GameConfig.height;
        visibleCounts.push(allPlatforms.filter(
          (platform) =>
            platform.y + platform.height >= viewportTop &&
            platform.y <= viewportBottom
        ).length);
      }
      const average = (values) => values.length > 0
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : 0;

      return {
        requestedGuaranteedPlatforms: count,
        generatedGuaranteedPlatforms: manager.stats.layersGenerated,
        totalGeneratedPlatforms: allPlatforms.length,
        unreachableGuaranteed,
        outsidePlatforms,
        overlappingPlatforms,
        verticalGapViolations,
        horizontalReachViolations,
        layerCountViolations,
        generationFailures,
        fallbackCount: manager.stats.fallbackCount,
        skippedFillers: manager.stats.skippedFillers,
        maximumJumpHeight: round(PlatformPhysics.getMaximumJumpHeight()),
        safeVerticalReach: round(
          PlatformPhysics.getMaximumJumpHeight() * GameConfig.safeVerticalGapRatio
        ),
        observedMinVerticalGap: round(Math.min(...verticalGaps)),
        observedMaxVerticalGap: round(Math.max(...verticalGaps)),
        observedMinSafeHorizontalTravel: round(Math.min(...safeHorizontalTravel)),
        observedMaxSafeHorizontalTravel: round(Math.max(...safeHorizontalTravel)),
        observedMinSafeCenterReach: round(Math.min(...safeCenterReach)),
        observedMaxSafeCenterReach: round(Math.max(...safeCenterReach)),
        averagePlatformsPerLayer: round(
          (allPlatforms.length - 1) / Math.max(1, manager.stats.layersGenerated)
        ),
        averageVisiblePlatforms: round(average(visibleCounts)),
        minimumVisiblePlatforms: Math.min(...visibleCounts),
        maximumVisiblePlatforms: Math.max(...visibleCounts),
        rejectedCandidates: { ...manager.stats.rejectedCandidates }
      };
    }
  }

  class GameRenderer {
    constructor(context) {
      this.context = context;
      this.colors = Object.freeze({
        background: "#18242f",
        player: "#f2f2f2",
        normal: "#49b36b",
        moving: "#418ad6",
        breakable: "#dc8735",
        spring: "#e7df55",
        text: "#ffffff",
        overlay: "rgba(8, 13, 18, 0.78)",
        button: "#33495c"
      });
    }

    clear() {
      this.context.fillStyle = this.colors.background;
      this.context.fillRect(0, 0, GameConfig.width, GameConfig.height);
    }

    drawWorld(player, platforms, debugPlatformGeneration = false) {
      for (const platform of platforms) {
        this.drawPlatform(platform, debugPlatformGeneration);
      }
      this.drawPlayer(player);
    }

    drawPlayer(player) {
      const context = this.context;
      context.fillStyle = this.colors.player;
      this.drawWrappedRectangle(player.x, player.y, player.width, player.height);
    }

    drawPlatform(platform, debugPlatformGeneration = false) {
      const colorByType = {
        [PlatformType.NORMAL]: this.colors.normal,
        [PlatformType.MOVING]: this.colors.moving,
        [PlatformType.BREAKABLE]: this.colors.breakable
      };
      const context = this.context;
      context.save();
      context.globalAlpha = platform.breaking
        ? clamp(platform.breakTimer / GameConfig.breakDelay, 0.25, 1)
        : 1;
      context.fillStyle = colorByType[platform.type];
      context.fillRect(platform.x, platform.y, platform.width, platform.height);

      if (platform.type === PlatformType.BREAKABLE) {
        context.fillStyle = this.colors.background;
        context.fillRect(platform.x + platform.width * 0.48, platform.y, 3, platform.height);
      }
      context.restore();

      if (platform.item && !platform.breaking) {
        this.drawSpring(platform.item);
      }

      if (debugPlatformGeneration) {
        context.fillStyle = this.colors.text;
        context.font = "bold 12px Arial, sans-serif";
        context.textAlign = "center";
        context.textBaseline = "bottom";
        context.fillText(
          platform.isGuaranteed ? "G" : "F",
          platform.x + platform.width * 0.5,
          platform.y - 3
        );
      }
    }

    drawSpring(spring) {
      const context = this.context;
      context.strokeStyle = this.colors.spring;
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(spring.x, spring.y + spring.height);
      context.lineTo(spring.x + spring.width * 0.25, spring.y);
      context.lineTo(spring.x + spring.width * 0.5, spring.y + spring.height);
      context.lineTo(spring.x + spring.width * 0.75, spring.y);
      context.lineTo(spring.x + spring.width, spring.y + spring.height);
      context.stroke();
    }

    drawWrappedRectangle(x, y, width, height) {
      const context = this.context;
      context.fillRect(x, y, width, height);
      if (x < 0) {
        context.fillRect(x + GameConfig.width, y, width, height);
      } else if (x + width > GameConfig.width) {
        context.fillRect(x - GameConfig.width, y, width, height);
      }
    }

    drawHud(score, best) {
      const context = this.context;
      context.fillStyle = this.colors.text;
      context.font = "bold 20px Arial, sans-serif";
      context.textAlign = "left";
      context.textBaseline = "top";
      context.fillText(`Score: ${score}`, 16, 15);
      context.textAlign = "right";
      context.fillText(`Best: ${Math.max(score, best)}`, GameConfig.width - 16, 15);
    }

    drawMenu() {
      this.drawOverlay();
      this.drawCenteredText("Speaki-e Jump", 236, "bold 42px Arial, sans-serif");
      this.drawCenteredText("A / D or Arrow Keys to Move", 304, "20px Arial, sans-serif");
      this.drawButton("PLAY", 360);
      this.drawCenteredText("Enter / Space / Click", 432, "17px Arial, sans-serif");
    }

    drawGameOver(score, best) {
      this.drawOverlay();
      this.drawCenteredText("GAME OVER", 230, "bold 42px Arial, sans-serif");
      this.drawCenteredText(`Score: ${score}`, 294, "24px Arial, sans-serif");
      this.drawCenteredText(`Best: ${best}`, 328, "24px Arial, sans-serif");
      this.drawButton("PLAY AGAIN", 382);
      this.drawCenteredText("R / Enter / Space / Click", 454, "17px Arial, sans-serif");
    }

    drawOverlay() {
      this.context.fillStyle = this.colors.overlay;
      this.context.fillRect(0, 0, GameConfig.width, GameConfig.height);
    }

    drawButton(label, y) {
      const width = 190;
      const height = 52;
      const x = (GameConfig.width - width) * 0.5;
      this.context.fillStyle = this.colors.button;
      this.context.fillRect(x, y, width, height);
      this.drawCenteredText(label, y + 15, "bold 20px Arial, sans-serif", "top");
    }

    drawCenteredText(text, y, font, baseline = "top") {
      const context = this.context;
      context.fillStyle = this.colors.text;
      context.font = font;
      context.textAlign = "center";
      context.textBaseline = baseline;
      context.fillText(text, GameConfig.width * 0.5, y);
    }
  }

  class Game {
    constructor(canvas) {
      this.canvas = canvas;
      this.context = canvas.getContext("2d");
      this.context.imageSmoothingEnabled = false;
      this.renderer = new GameRenderer(this.context);
      this.difficultyManager = new DifficultyManager();
      this.platformManager = new PlatformManager(this.difficultyManager);
      this.input = new InputManager(canvas, (action) => this.handleAction(action));
      this.state = GameState.MENU;
      this.bestScore = this.loadBestScore();
      this.score = 0;
      this.maxHeight = 0;
      this.cameraOffset = 0;
      this.startPlayerY = 0;
      this.lastTime = null;
      this.animationFrameId = null;
      this.loop = this.loop.bind(this);

      this.resetWorld();
      this.animationFrameId = requestAnimationFrame(this.loop);
    }

    resetWorld() {
      this.input.clear();
      this.score = 0;
      this.maxHeight = 0;
      this.cameraOffset = 0;
      this.playTime = 0;
      const startPlatform = this.platformManager.reset(0);
      const playerX = startPlatform.x + (startPlatform.width - GameConfig.playerWidth) * 0.5;
      const playerY = startPlatform.y - GameConfig.playerHeight;
      if (this.player) {
        this.player.reset(playerX, playerY);
      } else {
        this.player = new Player(playerX, playerY);
      }
      this.startPlayerY = playerY;
    }

    startGame() {
      this.resetWorld();
      this.state = GameState.PLAYING;
      this.player.launch();
      this.lastTime = performance.now();
    }

    handleAction(action) {
      if (this.state === GameState.MENU && ["Enter", "Space", "Pointer"].includes(action)) {
        this.startGame();
      } else if (
        this.state === GameState.GAME_OVER &&
        ["KeyR", "Enter", "Space", "Pointer"].includes(action)
      ) {
        this.startGame();
      }
    }

    loop(timestamp) {
      if (this.lastTime === null) {
        this.lastTime = timestamp;
      }
      const deltaTime = clamp((timestamp - this.lastTime) / 1000, 0, GameConfig.maxDeltaTime);
      this.lastTime = timestamp;

      if (this.state === GameState.PLAYING) {
        this.update(deltaTime);
      }
      this.render();
      this.animationFrameId = requestAnimationFrame(this.loop);
    }

    update(deltaTime) {
      this.playTime += deltaTime;
      this.platformManager.update(deltaTime);
      this.player.update(deltaTime, this.input.direction);

      if (this.player.y > GameConfig.height) {
        this.finishGame();
        return;
      }

      this.resolveLandings();
      this.updateCamera();
      this.updateScore();
      this.platformManager.ensurePlatforms(this.score);
    }

    resolveLandings() {
      if (this.player.vy <= 0) {
        return;
      }

      const previousBottom = this.player.previousY + this.player.height;
      const currentBottom = this.player.y + this.player.height;
      let selected = null;

      for (const platform of this.platformManager.platforms) {
        if (platform.breaking || platform.removed) {
          continue;
        }

        const spring = platform.item;
        if (spring && this.crossesTop(previousBottom, currentBottom, spring.y) && this.overlapsWrappedX(spring.x, spring.width)) {
          if (!selected || spring.y < selected.top) {
            selected = { platform, top: spring.y, spring: true };
          }
          continue;
        }

        if (
          this.crossesTop(previousBottom, currentBottom, platform.y) &&
          this.overlapsWrappedX(platform.x, platform.width)
        ) {
          if (!selected || platform.y < selected.top) {
            selected = { platform, top: platform.y, spring: false };
          }
        }
      }

      if (selected) {
        this.player.y = selected.top - this.player.height;
        this.player.previousY = this.player.y;
        this.player.launch(selected.spring ? GameConfig.springJumpMultiplier : 1);
        selected.platform.beginBreaking();
      }
    }

    crossesTop(previousBottom, currentBottom, top) {
      const tolerance = 2;
      return previousBottom <= top + tolerance && currentBottom >= top;
    }

    overlapsWrappedX(targetX, targetWidth) {
      const playerLeft = this.player.x;
      const playerRight = playerLeft + this.player.width;
      for (const offset of [-GameConfig.width, 0, GameConfig.width]) {
        const left = targetX + offset;
        const right = left + targetWidth;
        if (playerRight >= left && playerLeft <= right) {
          return true;
        }
      }
      return false;
    }

    updateCamera() {
      const thresholdY = GameConfig.height * GameConfig.cameraThreshold;
      if (this.player.y < thresholdY) {
        const scrollDistance = thresholdY - this.player.y;
        this.player.y = thresholdY;
        this.player.previousY += scrollDistance;
        this.platformManager.scroll(scrollDistance);
        this.cameraOffset += scrollDistance;
      }
    }

    updateScore() {
      const currentHeight = this.cameraOffset + Math.max(0, this.startPlayerY - this.player.y);
      this.maxHeight = Math.max(this.maxHeight, currentHeight);
      this.score = Math.floor(this.maxHeight);
    }

    finishGame() {
      this.state = GameState.GAME_OVER;
      this.input.clear();
      if (this.score > this.bestScore) {
        this.bestScore = this.score;
        this.saveBestScore(this.bestScore);
      }
    }

    loadBestScore() {
      try {
        const value = Number.parseInt(localStorage.getItem(GameConfig.bestScoreKey), 10);
        return Number.isFinite(value) && value >= 0 ? value : 0;
      } catch (error) {
        return 0;
      }
    }

    saveBestScore(score) {
      try {
        localStorage.setItem(GameConfig.bestScoreKey, String(score));
      } catch (error) {
        // Storage can be unavailable in private or restricted browsing contexts.
      }
    }

    render() {
      this.renderer.clear();
      this.renderer.drawWorld(
        this.player,
        this.platformManager.platforms,
        this.platformManager.debugEnabled
      );

      if (this.state === GameState.PLAYING) {
        this.renderer.drawHud(this.score, this.bestScore);
      } else if (this.state === GameState.MENU) {
        this.renderer.drawMenu();
      } else if (this.state === GameState.GAME_OVER) {
        this.renderer.drawGameOver(this.score, this.bestScore);
      }
    }

    getDebugSnapshot() {
      return {
        state: this.state,
        score: this.score,
        bestScore: this.bestScore,
        playTime: Math.round(this.playTime * 100) / 100,
        cameraOffset: Math.round(this.cameraOffset * 100) / 100,
        generation: {
          layerCount: this.platformManager.layerIndex,
          highestGeneratedY: round(this.platformManager.highestGeneratedY),
          debugEnabled: this.platformManager.debugEnabled,
          seed: this.platformManager.seed,
          fallbackCount: this.platformManager.stats.fallbackCount,
          rejectedCandidates: {
            ...this.platformManager.stats.rejectedCandidates
          }
        },
        player: {
          x: Math.round(this.player.x * 100) / 100,
          y: Math.round(this.player.y * 100) / 100,
          vx: Math.round(this.player.vx * 100) / 100,
          vy: Math.round(this.player.vy * 100) / 100
        },
        platforms: this.platformManager.platforms.map((platform) => ({
          x: Math.round(platform.x * 100) / 100,
          y: Math.round(platform.y * 100) / 100,
          width: Math.round(platform.width * 100) / 100,
          type: platform.type,
          hasSpring: Boolean(platform.item),
          breaking: platform.breaking,
          layerIndex: platform.layerIndex,
          isGuaranteed: platform.isGuaranteed,
          generationFallback: platform.generationFallback,
          allowWrappingFromPrevious: platform.allowWrappingFromPrevious
        }))
      };
    }
  }

  const canvas = document.getElementById("gameCanvas");
  if (!canvas) {
    throw new Error("Game canvas was not found.");
  }

  const game = new Game(canvas);
  window.speakiJump = Object.freeze({
    start: () => game.startGame(),
    getSnapshot: () => game.getDebugSnapshot(),
    validatePlatformGeneration: (count = 1000, seed = 1337) =>
      PlatformManager.validateGeneratedPlatforms(count, seed),
    config: GameConfig
  });
})();
