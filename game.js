(function () {
  "use strict";

  const CanvasConfig = Object.freeze({
    width: 720,
    height: 1280,
    renderScale: 1.5
  });

  const GameConfig = Object.freeze({
    canvasWidth: CanvasConfig.width,
    canvasHeight: CanvasConfig.height,
    renderScale: CanvasConfig.renderScale,
    // Physics run in design-space units so the existing feel and score curve
    // remain stable. The renderer maps this 480-wide world to the 720px canvas.
    width: CanvasConfig.width / CanvasConfig.renderScale,
    height: CanvasConfig.height / CanvasConfig.renderScale,
    gravity: 1850,
    jumpHeightMultiplier: 1.5,
    // Jump height is proportional to launch velocity squared.
    jumpPower: 720 * Math.sqrt(1.5),
    jumpSpinChance: 0.3,
    jumpSpinDuration: 0.72,
    springJumpMultiplier: 1.7,
    springSpawnChance: 0.4,
    propellerMinScore: 6000,
    propellerChanceDecayStartScore: 8000,
    propellerPeakSpawnChance: 0.15,
    propellerMinimumSpawnChance: 0.05,
    propellerDuration: 3.5,
    propellerFlightSpeed: 350,
    propellerMinSpawnGap: 18,
    jetpackMinScore: 6000,
    jetpackPeakSpawnChance: 0.15,
    jetpackMinimumSpawnChance: 0.05,
    flightChanceDecayEndScore: 12000,
    jetpackDuration: 3,
    jetpackFlightSpeed: 650,
    jetpackMinSpawnGap: 22,
    guaranteedBreakableScoreThreshold: 8000,
    guaranteedBreakableChance: 0.25,
    movingBreakableChance: 0.2,
    fallThroughFillerScoreThreshold: 10000,
    fallThroughFillerChance: 0.3,
    guaranteedFallThroughScoreThreshold: 10000,
    guaranteedFallThroughChance: 0.1,
    guaranteedMovingScoreThreshold: 15000,
    guaranteedMovingChance: 0.2,
    guaranteedMovingMinRange: 24,
    guaranteedMovingMaxRange: 40,
    guaranteedMovingMinSpeed: 48,
    guaranteedMovingMaxSpeed: 68,
    earlyFillerScoreThreshold: 3000,
    earlyOneFillerChance: 0.6,
    earlyTwoFillerChance: 0.25,
    monsterMinSpawnScore: 4000,
    monsterInitialSpawnChance: 0.06,
    monsterMaximumSpawnChance: 0.14,
    monsterDifficultyCapScore: 12000,
    maxVisibleMonsters: 3,
    maxMonsterSpawnAttempts: 24,
    monsterWidth: 36,
    monsterHeight: 28,
    monsterMoveSpeed: 64,
    monsterMoveRange: 44,
    monsterHoverMinOffset: 48,
    monsterHoverMaxOffset: 82,
    monsterMinimumSpawnLead: 120,
    monsterSeparationPadding: 16,
    monsterRouteBlockVerticalRange: 100,
    monsterLandingEscapeWidth: 28,
    monsterAvoidancePadding: 6,
    monsterStompBounceMultiplier: 0.9,
    moveAcceleration: 2200,
    horizontalFriction: 8,
    maxMoveSpeed: 330,
    maxFallSpeed: 980,
    playerWidth: 34,
    playerHeight: 42,
    platformHeight: 14,
    startPlatformWidth: 132,
    startPlatformY: CanvasConfig.height / CanvasConfig.renderScale - 70,
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
    deathFallInitialVelocity: 420,
    fallDeathCheckRatio: 0.62,
    deathCameraDuration: 1.05,
    deathCameraMaxOffset: 180,
    deathCameraFollowSpeed: 5.5,
    deathCameraFollowRatio: 0.55,
    deathSequenceMinimumDuration: 1.25,
    gameOverTransitionDuration: 0.85,
    gameOverPanelStartOffset:
      (CanvasConfig.height / CanvasConfig.renderScale) * 0.72,
    bestScoreKey: "speaki-e-jump-best-score",
    debugPlatformGeneration: false,
    debugSeed: null
  });

  const GameState = Object.freeze({
    MENU: "MENU",
    PLAYING: "PLAYING",
    DYING: "DYING",
    GAME_OVER: "GAME_OVER"
  });

  const PlatformType = Object.freeze({
    NORMAL: "NORMAL",
    MOVING: "MOVING",
    BREAKABLE: "BREAKABLE",
    FALL_THROUGH: "FALL_THROUGH"
  });

  const ItemType = Object.freeze({
    SPRING: "SPRING",
    PROPELLER_HAT: "PROPELLER_HAT",
    JETPACK: "JETPACK"
  });

  const MonsterType = Object.freeze({
    BASIC_HOVER_MONSTER: "BASIC_HOVER_MONSTER"
  });

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const lerp = (start, end, amount) => start + (end - start) * amount;
  const easeOutCubic = (value) => 1 - (1 - clamp(value, 0, 1)) ** 3;
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
    constructor(x, y, spinRandom = null) {
      this.width = GameConfig.playerWidth;
      this.height = GameConfig.playerHeight;
      this.spinRandom = spinRandom;
      this.reset(x, y);
    }

    reset(x, y) {
      this.x = x;
      this.y = y;
      this.previousX = x;
      this.previousY = y;
      this.vx = 0;
      this.vy = 0;
      this.activePowerUp = null;
      this.powerUpTimer = 0;
      this.powerUpFlightSpeed = 0;
      this.powerUpEndedThisFrame = false;
      this.cancelJumpSpin();
    }

    launch(multiplier = 1) {
      if (this.isFlying) {
        return false;
      }
      this.vy = -GameConfig.jumpPower * multiplier;
      this.jumpSpinActive = Boolean(
        this.spinRandom && this.spinRandom.chance(GameConfig.jumpSpinChance)
      );
      this.jumpSpinElapsed = 0;
      this.rotation = 0;
      return true;
    }

    cancelJumpSpin() {
      this.jumpSpinActive = false;
      this.jumpSpinElapsed = 0;
      this.rotation = 0;
    }

    updateJumpSpin(deltaTime) {
      if (!this.jumpSpinActive) {
        return;
      }
      this.jumpSpinElapsed = Math.min(
        GameConfig.jumpSpinDuration,
        this.jumpSpinElapsed + deltaTime
      );
      const progress = this.jumpSpinElapsed / GameConfig.jumpSpinDuration;
      this.rotation = progress * Math.PI * 2;
      if (progress >= 1) {
        this.cancelJumpSpin();
      }
    }

    get isFlying() {
      return this.activePowerUp === ItemType.PROPELLER_HAT ||
        this.activePowerUp === ItemType.JETPACK;
    }

    get remainingFlightDistance() {
      return this.isFlying ? this.powerUpFlightSpeed * this.powerUpTimer : 0;
    }

    activatePowerUp(type) {
      const settings = type === ItemType.PROPELLER_HAT
        ? {
            duration: GameConfig.propellerDuration,
            speed: GameConfig.propellerFlightSpeed
          }
        : type === ItemType.JETPACK
          ? {
              duration: GameConfig.jetpackDuration,
              speed: GameConfig.jetpackFlightSpeed
            }
          : null;

      if (!settings) {
        return false;
      }

      this.activePowerUp = type;
      this.powerUpTimer = settings.duration;
      this.powerUpFlightSpeed = settings.speed;
      this.powerUpEndedThisFrame = false;
      this.cancelJumpSpin();
      this.vy = -settings.speed;
      return true;
    }

    clearPowerUp(markEnded = false) {
      const wasFlying = this.isFlying;
      this.activePowerUp = null;
      this.powerUpTimer = 0;
      this.powerUpFlightSpeed = 0;
      if (wasFlying) {
        this.vy = 0;
      }
      this.powerUpEndedThisFrame = markEnded && wasFlying;
    }

    update(deltaTime, direction) {
      this.previousX = this.x;
      this.previousY = this.y;
      this.powerUpEndedThisFrame = false;
      this.updateJumpSpin(deltaTime);

      if (direction !== 0) {
        this.vx += direction * GameConfig.moveAcceleration * deltaTime;
      } else {
        this.vx *= Math.exp(-GameConfig.horizontalFriction * deltaTime);
        if (Math.abs(this.vx) < 0.5) {
          this.vx = 0;
        }
      }

      this.vx = clamp(this.vx, -GameConfig.maxMoveSpeed, GameConfig.maxMoveSpeed);
      this.x += this.vx * deltaTime;

      let normalPhysicsTime = deltaTime;
      if (this.isFlying) {
        const flyingTime = Math.min(deltaTime, this.powerUpTimer);
        this.vy = -this.powerUpFlightSpeed;
        this.y += this.vy * flyingTime;
        this.powerUpTimer = Math.max(0, this.powerUpTimer - flyingTime);
        normalPhysicsTime -= flyingTime;

        if (this.powerUpTimer <= 1e-9) {
          this.clearPowerUp(true);
        }
      }

      if (!this.isFlying && normalPhysicsTime > 0) {
        this.vy = Math.min(
          this.vy + GameConfig.gravity * normalPhysicsTime,
          GameConfig.maxFallSpeed
        );
        this.y += this.vy * normalPhysicsTime;
      } else if (!this.isFlying && deltaTime === 0) {
        this.vy = Math.min(this.vy, GameConfig.maxFallSpeed);
      }

      if (this.x + this.width < 0) {
        this.x = GameConfig.width;
        this.previousX = this.x;
      } else if (this.x > GameConfig.width) {
        this.x = -this.width;
        this.previousX = this.x;
      }
    }
  }

  class Item {
    constructor(platform, type, offsetX, width, height) {
      this.platform = platform;
      this.type = type;
      this.offsetX = offsetX;
      this.width = width;
      this.height = height;
      this.collected = false;
    }

    get x() {
      return this.platform.x + this.offsetX;
    }

    get y() {
      return this.platform.y - this.height;
    }

    collect() {
      if (this.collected) {
        return false;
      }
      this.collected = true;
      if (this.platform.item === this) {
        this.platform.item = null;
      }
      return true;
    }
  }

  class PowerUp extends Item {
    constructor(platform, type, width, height, random) {
      const centerOffset = (platform.width - width) * 0.5;
      const offsetX = clamp(
        centerOffset + (random ? random.range(-6, 6) : 0),
        6,
        platform.width - width - 6
      );
      super(platform, type, offsetX, width, height);
    }
  }

  class Spring extends Item {
    constructor(platform, offsetX) {
      super(platform, ItemType.SPRING, offsetX, 20, 12);
    }
  }

  class PropellerHat extends PowerUp {
    constructor(platform, random) {
      super(platform, ItemType.PROPELLER_HAT, 28, 18, random);
    }
  }

  class Jetpack extends PowerUp {
    constructor(platform, random) {
      super(platform, ItemType.JETPACK, 24, 26, random);
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
      this.isFallThrough = type === PlatformType.FALL_THROUGH;
      this.isBreakable = type === PlatformType.BREAKABLE || this.isFallThrough;
      this.breaking = false;
      this.breakTimer = 0;
      this.removed = false;
      this.layerIndex = 0;
      this.isGuaranteed = false;
      this.isRouteContinuation = false;
      this.allowWrappingFromPrevious = false;
      this.generationFallback = false;
      this.generationSettings = null;
      this.generationScore = 0;
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
      if (this.type !== PlatformType.NORMAL || this.item) {
        return false;
      }
      const inset = 8;
      const maxOffset = Math.max(inset, this.width - 20 - inset);
      this.item = new Spring(this, random.range(inset, maxOffset));
      return true;
    }

    addPowerUp(type, random) {
      if (this.type !== PlatformType.NORMAL || this.item) {
        return false;
      }
      if (type === ItemType.PROPELLER_HAT) {
        this.item = new PropellerHat(this, random);
      } else if (type === ItemType.JETPACK) {
        this.item = new Jetpack(this, random);
      } else {
        return false;
      }
      return true;
    }

    beginBreaking() {
      if (this.isBreakable && !this.breaking) {
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

  class Monster {
    constructor(
      x,
      y,
      type = MonsterType.BASIC_HOVER_MONSTER,
      moveRange = GameConfig.monsterMoveRange,
      moveSpeed = GameConfig.monsterMoveSpeed,
      moveDirection = 1
    ) {
      this.x = x;
      this.y = y;
      this.previousX = x;
      this.width = GameConfig.monsterWidth;
      this.height = GameConfig.monsterHeight;
      this.type = type;
      this.originX = x;
      this.moveRange = moveRange;
      this.moveMin = x - moveRange;
      this.moveMax = x + moveRange;
      this.vx = Math.abs(moveSpeed) * (moveDirection < 0 ? -1 : 1);
      this.alive = true;
      this.spawnLayer = -1;
      this.spawnScore = 0;
      this.anchorIsGuaranteed = false;
    }

    update(deltaTime) {
      if (!this.alive) {
        return;
      }

      this.previousX = this.x;
      let nextX = this.x + this.vx * deltaTime;
      while (nextX < this.moveMin || nextX > this.moveMax) {
        if (nextX > this.moveMax) {
          nextX = this.moveMax - (nextX - this.moveMax);
          this.vx = -Math.abs(this.vx);
        } else if (nextX < this.moveMin) {
          nextX = this.moveMin + (this.moveMin - nextX);
          this.vx = Math.abs(this.vx);
        }
      }
      this.x = nextX;
    }

    scroll(distance) {
      this.y += distance;
    }

    kill() {
      if (!this.alive) {
        return false;
      }
      this.alive = false;
      return true;
    }
  }

  class DifficultyManager {
    getSpringChance() {
      return GameConfig.springSpawnChance;
    }

    getFlightPowerUpChances(score) {
      const propellerDecayProgress = clamp(
        (score - GameConfig.propellerChanceDecayStartScore) /
          (GameConfig.flightChanceDecayEndScore -
            GameConfig.propellerChanceDecayStartScore),
        0,
        1
      );
      const jetpackDecayProgress = clamp(
        (score - GameConfig.jetpackMinScore) /
          (GameConfig.flightChanceDecayEndScore - GameConfig.jetpackMinScore),
        0,
        1
      );
      return {
        propeller: score < GameConfig.propellerMinScore
          ? 0
          : lerp(
            GameConfig.propellerPeakSpawnChance,
            GameConfig.propellerMinimumSpawnChance,
            propellerDecayProgress
          ),
        jetpack: score < GameConfig.jetpackMinScore
          ? 0
          : lerp(
            GameConfig.jetpackPeakSpawnChance,
            GameConfig.jetpackMinimumSpawnChance,
            jetpackDecayProgress
          )
      };
    }

    getMonsterSettings(score) {
      if (score < GameConfig.monsterMinSpawnScore) {
        return { spawnChance: 0 };
      }
      const progress = clamp(
        (score - GameConfig.monsterMinSpawnScore) /
          (GameConfig.monsterDifficultyCapScore - GameConfig.monsterMinSpawnScore),
        0,
        1
      );
      return {
        spawnChance: lerp(
          GameConfig.monsterInitialSpawnChance,
          GameConfig.monsterMaximumSpawnChance,
          progress
        )
      };
    }

    getSettings(score, layerIndex) {
      const level = clamp(score / 12000, 0, 1);
      const maximumJumpHeight = PlatformPhysics.getMaximumJumpHeight();
      const safeVerticalReach = maximumJumpHeight * GameConfig.safeVerticalGapRatio;
      const opening = layerIndex <= GameConfig.safeOpeningLayers;
      const earlyAssistance = score <= GameConfig.earlyFillerScoreThreshold;

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
        score,
        level,
        opening,
        earlyAssistance,
        minGap,
        maxGap,
        minWidth: opening ? 102 : lerp(94, 72, level),
        maxWidth: opening ? 116 : lerp(116, 96, level),
        movingChance: lerp(0.06, 0.23, level),
        breakableChance: lerp(0.04, 0.18, level),
        fallThroughChance: !opening &&
          score < GameConfig.fallThroughFillerScoreThreshold
          ? GameConfig.fallThroughFillerChance
          : 0,
        springChance: this.getSpringChance(),
        oneFillerChance: earlyAssistance
          ? GameConfig.earlyOneFillerChance
          : lerp(0.22, 0.18, level),
        twoFillerChance: earlyAssistance
          ? GameConfig.earlyTwoFillerChance
          : lerp(0.04, 0.025, level),
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
      this.itemSeed = this.seed === null || this.seed === undefined
        ? null
        : `${this.seed}:items`;
      this.itemRandom = new RandomSource(this.itemSeed);
      this.routeTypeSeed = this.seed === null || this.seed === undefined
        ? null
        : `${this.seed}:route-types`;
      this.routeTypeRandom = new RandomSource(this.routeTypeSeed);
      this.movingBreakableSeed = this.seed === null || this.seed === undefined
        ? null
        : `${this.seed}:moving-breakables`;
      this.movingBreakableRandom = new RandomSource(this.movingBreakableSeed);
      this.fallThroughFillerSeed = this.seed === null || this.seed === undefined
        ? null
        : `${this.seed}:fall-through-fillers`;
      this.fallThroughFillerRandom = new RandomSource(this.fallThroughFillerSeed);
      this.guaranteedFallThroughSeed = this.seed === null || this.seed === undefined
        ? null
        : `${this.seed}:guaranteed-fall-through`;
      this.guaranteedFallThroughRandom = new RandomSource(
        this.guaranteedFallThroughSeed
      );
      this.guaranteedMovingSeed = this.seed === null || this.seed === undefined
        ? null
        : `${this.seed}:guaranteed-moving`;
      this.guaranteedMovingRandom = new RandomSource(this.guaranteedMovingSeed);
      this.platforms = [];
      this.generatedCount = 0;
      this.layerIndex = 0;
      this.lastGuaranteedPlatform = null;
      this.lastRoutePlatform = null;
      this.highestGeneratedY = GameConfig.startPlatformY;
      this.recentGuaranteed = [];
      this.recentVerticalGaps = [];
      this.layersSinceFiller = 0;
      this.lastFlightPowerUpLayer = -Infinity;
      this.stats = this.createEmptyStats();
    }

    createEmptyStats() {
      return {
        layersGenerated: 0,
        platformsGenerated: 0,
        fallbackCount: 0,
        skippedFillers: 0,
        guaranteedBreakablesGenerated: 0,
        movingBreakablesGenerated: 0,
        fallThroughFillersGenerated: 0,
        guaranteedFallThroughGenerated: 0,
        guaranteedMovingGenerated: 0,
        itemsGenerated: {
          [ItemType.SPRING]: 0,
          [ItemType.PROPELLER_HAT]: 0,
          [ItemType.JETPACK]: 0
        },
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
      this.itemRandom.reset(this.itemSeed);
      this.routeTypeRandom.reset(this.routeTypeSeed);
      this.movingBreakableRandom.reset(this.movingBreakableSeed);
      this.fallThroughFillerRandom.reset(this.fallThroughFillerSeed);
      this.guaranteedFallThroughRandom.reset(this.guaranteedFallThroughSeed);
      this.guaranteedMovingRandom.reset(this.guaranteedMovingSeed);
      this.generatedCount = 1;
      this.layerIndex = 0;
      this.recentGuaranteed.length = 0;
      this.recentVerticalGaps.length = 0;
      this.layersSinceFiller = 0;
      this.lastFlightPowerUpLayer = -Infinity;
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
      start.isRouteContinuation = true;
      start.layerIndex = 0;
      this.platforms.push(start);
      this.lastGuaranteedPlatform = start;
      this.lastRoutePlatform = start;
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

    ensurePlatforms(score, additionalAheadDistance = 0) {
      const spawnTargetY =
        -GameConfig.height * GameConfig.spawnAheadScreens -
        Math.max(0, additionalAheadDistance);
      let generatedThisUpdate = 0;
      const generatedLayers = [];

      while (this.highestGeneratedY > spawnTargetY && generatedThisUpdate < 64) {
        generatedLayers.push(this.generateNextLayer(score));
        generatedThisUpdate += 1;
      }

      if (this.highestGeneratedY > spawnTargetY) {
        throw new Error("Platform generation did not advance above the spawn target.");
      }
      return generatedLayers;
    }

    generateInitialPlatforms(score = 0) {
      return this.reset(score);
    }

    generateNextLayer(score) {
      const nextLayerIndex = this.layerIndex + 1;
      const settings = this.getDifficultySettings(score, nextLayerIndex);
      const previousRoute = this.lastRoutePlatform;
      const routeSources = this.getRequiredRouteSources(previousRoute);
      const guaranteed = this.generateGuaranteedPlatform(
        previousRoute,
        settings,
        nextLayerIndex,
        routeSources
      );
      this.applyGuaranteedPlatformDifficulty(guaranteed, score);

      this.platforms.push(guaranteed);
      const fillers = this.generateFillerPlatforms(
        previousRoute,
        guaranteed,
        settings,
        nextLayerIndex
      );
      this.platforms.push(...fillers);
      this.tryAddFlightPowerUp(guaranteed, nextLayerIndex, score);

      let routePlatform = guaranteed;
      if (guaranteed.isFallThrough) {
        routePlatform = fillers.find((platform) => !platform.isFallThrough) || null;
        if (!routePlatform) {
          guaranteed.type = PlatformType.NORMAL;
          guaranteed.isBreakable = false;
          guaranteed.isFallThrough = false;
          this.stats.guaranteedFallThroughGenerated -= 1;
          routePlatform = guaranteed;
        }
      }
      guaranteed.isRouteContinuation = routePlatform === guaranteed;
      routePlatform.isRouteContinuation = true;

      this.layerIndex = nextLayerIndex;
      this.lastGuaranteedPlatform = guaranteed;
      this.lastRoutePlatform = routePlatform;
      this.highestGeneratedY = routePlatform.y;
      this.recentGuaranteed.push(routePlatform);
      if (this.recentGuaranteed.length > 10) {
        this.recentGuaranteed.shift();
      }
      const verticalGap = previousRoute.y - routePlatform.y;
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
          previousRoute,
          routePlatform,
          routePlatform.allowWrappingFromPrevious
        );
        console.debug("[Platform layer]", {
          layer: nextLayerIndex,
          x: round(routePlatform.x),
          y: round(routePlatform.y),
          verticalGap: round(reach.verticalGap),
          horizontalDistance: round(reach.horizontalDistance),
          safeHorizontalReach: round(reach.safeCenterReach),
          reachable: reach.reachable,
          fillers: fillers.length,
          fallback: guaranteed.generationFallback,
          guaranteedType: guaranteed.type,
          routeUsesAlternative: routePlatform !== guaranteed
        });
      }

      return { guaranteed, fillers, routePlatform, settings };
    }

    applyGuaranteedPlatformDifficulty(platform, score) {
      platform.generationScore = score;
      if (
        score >= GameConfig.guaranteedFallThroughScoreThreshold &&
        this.guaranteedFallThroughRandom.chance(
          GameConfig.guaranteedFallThroughChance
        )
      ) {
        platform.type = PlatformType.FALL_THROUGH;
        platform.isFallThrough = true;
        platform.isBreakable = true;
        this.stats.guaranteedFallThroughGenerated += 1;
        return true;
      }

      let changed = false;
      // FALL_THROUGH is evaluated first, so normalize the remaining roll to
      // keep the configured moving chance at 20% of all Guaranteed slots.
      const movingChanceAfterFallThroughCheck =
        GameConfig.guaranteedMovingChance /
        (1 - GameConfig.guaranteedFallThroughChance);
      if (
        score >= GameConfig.guaranteedMovingScoreThreshold &&
        this.guaranteedMovingRandom.chance(movingChanceAfterFallThroughCheck)
      ) {
        this.configureGuaranteedMovingPlatform(platform);
        this.stats.guaranteedMovingGenerated += 1;
        changed = true;
      }

      if (
        score >= GameConfig.guaranteedBreakableScoreThreshold &&
        this.routeTypeRandom.chance(GameConfig.guaranteedBreakableChance)
      ) {
        if (platform.type === PlatformType.NORMAL) {
          platform.type = PlatformType.BREAKABLE;
        }
        platform.isBreakable = true;
        this.stats.guaranteedBreakablesGenerated += 1;
        changed = true;
      }
      return changed;
    }

    configureGuaranteedMovingPlatform(platform) {
      const moveRange = this.guaranteedMovingRandom.range(
        GameConfig.guaranteedMovingMinRange,
        GameConfig.guaranteedMovingMaxRange
      );
      platform.type = PlatformType.MOVING;
      platform.moveMin = Math.max(GameConfig.sidePadding, platform.x - moveRange);
      platform.moveMax = Math.min(
        GameConfig.width - platform.width - GameConfig.sidePadding,
        platform.x + moveRange
      );
      platform.moveSpeed = this.guaranteedMovingRandom.range(
        GameConfig.guaranteedMovingMinSpeed,
        GameConfig.guaranteedMovingMaxSpeed
      );
      platform.moveDirection = this.guaranteedMovingRandom.chance(0.5) ? -1 : 1;
      return platform;
    }

    applyMovingPlatformDifficulty(platform) {
      if (
        platform.type !== PlatformType.MOVING ||
        !this.movingBreakableRandom.chance(GameConfig.movingBreakableChance)
      ) {
        return false;
      }

      platform.isBreakable = true;
      this.stats.movingBreakablesGenerated += 1;
      return true;
    }

    tryAddFlightPowerUp(platform, layerIndex, score) {
      if (
        layerIndex <= GameConfig.safeOpeningLayers ||
        platform.type !== PlatformType.NORMAL ||
        platform.item
      ) {
        return null;
      }

      const layerGap = layerIndex - this.lastFlightPowerUpLayer;
      const chances = this.difficultyManager.getFlightPowerUpChances(score);
      const roll = this.itemRandom.next();
      let type = null;
      if (
        layerGap >= GameConfig.propellerMinSpawnGap &&
        roll < chances.propeller
      ) {
        type = ItemType.PROPELLER_HAT;
      } else if (
        layerGap >= GameConfig.jetpackMinSpawnGap &&
        roll < chances.propeller + chances.jetpack
      ) {
        type = ItemType.JETPACK;
      }

      if (!type || !platform.addPowerUp(type, this.itemRandom)) {
        return null;
      }

      this.lastFlightPowerUpLayer = layerIndex;
      this.stats.itemsGenerated[type] += 1;
      return platform.item;
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
          !platform.removed &&
          !platform.isFallThrough
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
      const needsRouteAlternative = guaranteed.isFallThrough;
      const desiredCount = Math.max(
        needsRouteAlternative ? 1 : 0,
        this.chooseFillerCount(settings)
      );
      const fillers = [];

      for (let fillerIndex = 0; fillerIndex < desiredCount; fillerIndex += 1) {
        const forceRouteContinuation = needsRouteAlternative && fillerIndex === 0;
        let created = null;
        for (let attempt = 0; attempt < GameConfig.maxGenerationAttempts; attempt += 1) {
          const width = this.random.range(settings.minWidth * 0.88, settings.maxWidth);
          const y = forceRouteContinuation
            ? guaranteed.y
            : guaranteed.y + this.random.range(
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
          if (
            !forceRouteContinuation &&
            this.fallThroughFillerRandom.chance(settings.fallThroughChance)
          ) {
            type = PlatformType.FALL_THROUGH;
          } else if (!settings.opening && !settings.earlyAssistance) {
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
          candidate.generationScore = settings.score;
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
          if (type === PlatformType.FALL_THROUGH) {
            this.stats.fallThroughFillersGenerated += 1;
          }
          if (
            type === PlatformType.NORMAL &&
            this.random.chance(settings.springChance) &&
            candidate.addSpring(this.random)
          ) {
            this.stats.itemsGenerated[ItemType.SPRING] += 1;
          }
          this.applyMovingPlatformDifficulty(candidate);
          created = candidate;
          break;
        }

        if (
          !created &&
          fillerIndex === 0 &&
          (
            forceRouteContinuation ||
            (settings.opening && this.layersSinceFiller >= 2)
          )
        ) {
          created = this.createFillerFallback(
            previous,
            guaranteed,
            settings,
            layerIndex,
            fillers,
            forceRouteContinuation
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

    createFillerFallback(
      anchor,
      guaranteed,
      settings,
      layerIndex,
      additionalPlatforms,
      sameHeightOnly = false
    ) {
      // A required alternate route may need a narrower landing surface to fit
      // safely between a screen edge and the Guaranteed Platform.
      const width = Math.max(72, settings.minWidth * 0.7);
      const halfWidth = width * 0.5;
      const anchorCenter = anchor.x + anchor.width * 0.5;
      const guaranteedCenter = guaranteed.x + guaranteed.width * 0.5;
      const verticalVariations = sameHeightOnly
        ? [0]
        : [
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
          candidate.generationScore = settings.score;
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

        const routePlatform = layer.routePlatform || layer.guaranteed;
        const reach = PlatformPhysics.getReachability(
          previous,
          routePlatform,
          routePlatform.allowWrappingFromPrevious
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
        previous = routePlatform;
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
        guaranteedBreakablesGenerated: manager.stats.guaranteedBreakablesGenerated,
        movingBreakablesGenerated: manager.stats.movingBreakablesGenerated,
        fallThroughFillersGenerated: manager.stats.fallThroughFillersGenerated,
        guaranteedFallThroughGenerated: manager.stats.guaranteedFallThroughGenerated,
        guaranteedMovingGenerated: manager.stats.guaranteedMovingGenerated,
        itemsGenerated: { ...manager.stats.itemsGenerated },
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

  class MonsterManager {
    constructor(difficultyManager, platformManager, options = {}) {
      this.difficultyManager = difficultyManager;
      this.platformManager = platformManager;
      const hasSeedOverride = Object.prototype.hasOwnProperty.call(options, "seed");
      const baseSeed = hasSeedOverride ? options.seed : platformManager.seed;
      this.seed = baseSeed === null || baseSeed === undefined
        ? null
        : `${baseSeed}:monsters`;
      this.random = new RandomSource(this.seed);
      this.monsters = [];
      this.stats = this.createEmptyStats();
    }

    createEmptyStats() {
      return {
        spawnRolls: 0,
        spawned: 0,
        skippedChance: 0,
        skippedCapacity: 0,
        skippedUnsafe: 0,
        blockedRoutesPrevented: 0,
        cleanedUp: 0,
        removedByStomp: 0,
        removedByPowerUp: 0,
        rejectedCandidates: {
          outside: 0,
          reaction: 0,
          platformOverlap: 0,
          itemOverlap: 0,
          monsterOverlap: 0,
          noReachableRoute: 0,
          blocksAllRoutes: 0
        }
      };
    }

    reset() {
      this.monsters.length = 0;
      this.random.reset(this.seed);
      this.stats = this.createEmptyStats();
    }

    update(deltaTime) {
      for (const monster of this.monsters) {
        monster.update(deltaTime);
      }
      this.cleanupMonsters();
    }

    scroll(distance) {
      for (const monster of this.monsters) {
        monster.scroll(distance);
      }
    }

    cleanupMonsters() {
      const cleanupY = GameConfig.height + GameConfig.cleanupMargin;
      this.monsters = this.monsters.filter((monster) => {
        if (!monster.alive) {
          return false;
        }
        if (monster.y > cleanupY) {
          monster.kill();
          this.stats.cleanedUp += 1;
          return false;
        }
        return true;
      });
    }

    removeMonster(monster, reason) {
      if (!monster || !monster.kill()) {
        return false;
      }
      if (reason === "STOMP") {
        this.stats.removedByStomp += 1;
      } else if (reason === "POWER_UP") {
        this.stats.removedByPowerUp += 1;
      }
      return true;
    }

    spawnForLayers(layers) {
      const spawned = [];
      if (!Array.isArray(layers)) {
        return spawned;
      }
      for (const layer of layers) {
        const monster = this.trySpawnForLayer(layer);
        if (monster) {
          spawned.push(monster);
        }
      }
      return spawned;
    }

    trySpawnForLayer(layer) {
      const score = layer.guaranteed.generationScore;
      const settings = this.difficultyManager.getMonsterSettings(score);
      if (settings.spawnChance <= 0) {
        return null;
      }
      if (this.monsters.filter((monster) => monster.alive).length >=
        GameConfig.maxVisibleMonsters) {
        this.stats.skippedCapacity += 1;
        return null;
      }

      this.stats.spawnRolls += 1;
      if (!this.random.chance(settings.spawnChance)) {
        this.stats.skippedChance += 1;
        return null;
      }

      const layerIndex = layer.guaranteed.layerIndex;
      const routeSources = this.getRouteSources(layerIndex);
      const reachablePlatforms = this.getReachablePlatforms(layerIndex, routeSources);
      if (reachablePlatforms.length === 0) {
        this.rejectCandidate("noReachableRoute");
        this.stats.skippedUnsafe += 1;
        return null;
      }

      for (let attempt = 0; attempt < GameConfig.maxMonsterSpawnAttempts; attempt += 1) {
        const anchor = reachablePlatforms[this.random.integer(
          0,
          reachablePlatforms.length - 1
        )];
        const candidate = this.createCandidate(anchor, score, layerIndex);
        if (!this.canSpawnMonster(
          candidate,
          layerIndex,
          reachablePlatforms,
          routeSources
        )) {
          continue;
        }

        this.monsters.push(candidate);
        this.stats.spawned += 1;
        return candidate;
      }

      this.stats.skippedUnsafe += 1;
      return null;
    }

    createCandidate(anchor, score, layerIndex) {
      const moveRange = GameConfig.monsterMoveRange;
      const minimumOrigin = GameConfig.sidePadding + moveRange;
      const maximumOrigin =
        GameConfig.width - GameConfig.sidePadding - GameConfig.monsterWidth - moveRange;
      const platformRange = this.getPlatformMovementRange(anchor);
      const desiredCenter = this.random.range(platformRange.left, platformRange.right);
      const originX = clamp(
        desiredCenter - GameConfig.monsterWidth * 0.5,
        minimumOrigin,
        maximumOrigin
      );
      const monster = new Monster(
        originX,
        anchor.y - this.random.range(
          GameConfig.monsterHoverMinOffset,
          GameConfig.monsterHoverMaxOffset
        ),
        MonsterType.BASIC_HOVER_MONSTER,
        moveRange,
        GameConfig.monsterMoveSpeed,
        this.random.chance(0.5) ? -1 : 1
      );
      monster.spawnLayer = layerIndex;
      monster.spawnScore = score;
      monster.anchorIsGuaranteed = anchor.isGuaranteed;
      return monster;
    }

    canSpawnMonster(
      candidate,
      layerIndex = candidate.spawnLayer,
      reachablePlatforms = this.getReachablePlatforms(layerIndex),
      routeSources = this.getRouteSources(layerIndex)
    ) {
      const movementRange = this.getMonsterMovementRange(candidate);
      if (
        movementRange.left < GameConfig.sidePadding - 1e-6 ||
        movementRange.right > GameConfig.width - GameConfig.sidePadding + 1e-6
      ) {
        return this.rejectCandidate("outside");
      }
      if (candidate.y + candidate.height > -GameConfig.monsterMinimumSpawnLead) {
        return this.rejectCandidate("reaction");
      }
      if (this.overlapsPlatform(candidate)) {
        return this.rejectCandidate("platformOverlap");
      }
      if (this.overlapsItem(candidate)) {
        return this.rejectCandidate("itemOverlap");
      }
      if (this.overlapsOtherMonster(candidate)) {
        return this.rejectCandidate("monsterOverlap");
      }
      if (reachablePlatforms.length === 0 || routeSources.length === 0) {
        return this.rejectCandidate("noReachableRoute");
      }
      if (this.wouldBlockAllReachableRoutes(
        candidate,
        layerIndex,
        reachablePlatforms,
        routeSources
      )) {
        this.stats.blockedRoutesPrevented += 1;
        return this.rejectCandidate("blocksAllRoutes");
      }
      return true;
    }

    rejectCandidate(reason) {
      if (Object.prototype.hasOwnProperty.call(this.stats.rejectedCandidates, reason)) {
        this.stats.rejectedCandidates[reason] += 1;
      }
      return false;
    }

    getRouteSources(layerIndex) {
      return this.platformManager.platforms.filter((platform) =>
        platform.layerIndex === layerIndex - 1 &&
        !platform.removed &&
        !platform.breaking &&
        !platform.isFallThrough
      );
    }

    getReachablePlatforms(layerIndex, routeSources = this.getRouteSources(layerIndex)) {
      return this.platformManager.platforms.filter((platform) =>
        platform.layerIndex === layerIndex &&
        !platform.removed &&
        !platform.breaking &&
        !platform.isFallThrough &&
        routeSources.some((source) =>
          PlatformPhysics.getReachability(
            source,
            platform,
            platform.allowWrappingFromPrevious
          ).reachable
        )
      );
    }

    getPlatformMovementRange(platform) {
      if (platform.type === PlatformType.MOVING) {
        return { left: platform.moveMin, right: platform.moveMax + platform.width };
      }
      return { left: platform.x, right: platform.x + platform.width };
    }

    getPlatformLandingRange(platform) {
      const movementRange = this.getPlatformMovementRange(platform);
      return {
        left: Math.max(
          -GameConfig.playerWidth,
          movementRange.left + GameConfig.minimumLandingOverlap - GameConfig.playerWidth
        ),
        right: Math.min(
          GameConfig.width,
          movementRange.right - GameConfig.minimumLandingOverlap
        )
      };
    }

    getMonsterMovementRange(monster) {
      return {
        left: monster.moveMin,
        right: monster.moveMax + monster.width
      };
    }

    monsterAffectsPlatform(monster, platform) {
      return (
        monster.y < platform.y + platform.height &&
        monster.y + monster.height >=
          platform.y - GameConfig.monsterRouteBlockVerticalRange
      );
    }

    getUnblockedLandingSegments(platform, monsters) {
      let segments = [this.getPlatformLandingRange(platform)];
      for (const monster of monsters) {
        if (!monster.alive || !this.monsterAffectsPlatform(monster, platform)) {
          continue;
        }
        const range = this.getMonsterMovementRange(monster);
        const blocked = {
          left: range.left - GameConfig.playerWidth - GameConfig.monsterAvoidancePadding,
          right: range.right + GameConfig.monsterAvoidancePadding
        };
        const remaining = [];
        for (const segment of segments) {
          if (blocked.right <= segment.left || blocked.left >= segment.right) {
            remaining.push(segment);
            continue;
          }
          if (blocked.left > segment.left) {
            remaining.push({ left: segment.left, right: blocked.left });
          }
          if (blocked.right < segment.right) {
            remaining.push({ left: blocked.right, right: segment.right });
          }
        }
        segments = remaining;
      }
      return segments;
    }

    hasStompOption(monster, routeSources) {
      const positions = [monster.moveMin, monster.originX, monster.moveMax];
      return routeSources.some((source) => positions.some((x) =>
        PlatformPhysics.getReachability(
          source,
          { x, y: monster.y, width: monster.width },
          true
        ).reachable
      ));
    }

    hasPlayerEscapeOption(
      candidate,
      layerIndex = candidate.spawnLayer,
      reachablePlatforms = this.getReachablePlatforms(layerIndex),
      routeSources = this.getRouteSources(layerIndex)
    ) {
      return !this.wouldBlockAllReachableRoutes(
        candidate,
        layerIndex,
        reachablePlatforms,
        routeSources
      );
    }

    wouldBlockAllReachableRoutes(
      candidate,
      layerIndex = candidate.spawnLayer,
      reachablePlatforms = this.getReachablePlatforms(layerIndex),
      routeSources = this.getRouteSources(layerIndex)
    ) {
      if (reachablePlatforms.length === 0 || routeSources.length === 0) {
        return true;
      }
      const blockers = [
        ...this.monsters.filter((monster) => monster.alive && monster !== candidate),
        candidate
      ];

      return reachablePlatforms.every((platform) => {
        const relevantBlockers = blockers.filter((monster) =>
          this.monsterAffectsPlatform(monster, platform)
        );
        if (relevantBlockers.length === 0) {
          return false;
        }
        const dangerousOnlyChoice =
          reachablePlatforms.length === 1 &&
          (platform.isBreakable || platform.type === PlatformType.MOVING);
        const requiredEscapeWidth = GameConfig.monsterLandingEscapeWidth *
          (dangerousOnlyChoice ? 1.35 : 1);
        const hasLandingSpace = this.getUnblockedLandingSegments(
          platform,
          relevantBlockers
        ).some((segment) => segment.right - segment.left >= requiredEscapeWidth);
        if (hasLandingSpace) {
          return false;
        }

        const sourcesForPlatform = routeSources.filter((source) =>
          PlatformPhysics.getReachability(
            source,
            platform,
            platform.allowWrappingFromPrevious
          ).reachable
        );
        return !relevantBlockers.some((monster) =>
          this.hasStompOption(monster, sourcesForPlatform)
        );
      });
    }

    overlapsPlatform(monster) {
      const monsterRange = this.getMonsterMovementRange(monster);
      return this.platformManager.platforms.some((platform) => {
        const platformRange = this.getPlatformMovementRange(platform);
        return (
          monsterRange.left < platformRange.right + 2 &&
          monsterRange.right + 2 > platformRange.left &&
          monster.y < platform.y + platform.height + 2 &&
          monster.y + monster.height + 2 > platform.y
        );
      });
    }

    overlapsItem(monster) {
      const monsterRange = this.getMonsterMovementRange(monster);
      return this.platformManager.platforms.some((platform) => {
        const item = platform.item;
        return item && !item.collected &&
          monsterRange.left < item.x + item.width + 4 &&
          monsterRange.right + 4 > item.x &&
          monster.y < item.y + item.height + 4 &&
          monster.y + monster.height + 4 > item.y;
      });
    }

    overlapsOtherMonster(candidate) {
      const candidateRange = this.getMonsterMovementRange(candidate);
      return this.monsters.some((monster) => {
        if (!monster.alive || monster === candidate) {
          return false;
        }
        const range = this.getMonsterMovementRange(monster);
        return (
          candidateRange.left < range.right + GameConfig.monsterSeparationPadding &&
          candidateRange.right + GameConfig.monsterSeparationPadding > range.left &&
          candidate.y < monster.y + monster.height + GameConfig.monsterSeparationPadding &&
          candidate.y + candidate.height + GameConfig.monsterSeparationPadding > monster.y
        );
      });
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
        fallThrough: "#b45555",
        spring: "#e7df55",
        propeller: "#b86cff",
        jetpack: "#ef4e4e",
        monster: "#e45d75",
        monsterEye: "#18242f",
        text: "#ffffff",
        overlay: "rgba(8, 13, 18, 0.78)",
        button: "#33495c"
      });
    }

    clear() {
      this.context.fillStyle = this.colors.background;
      this.context.fillRect(0, 0, GameConfig.width, GameConfig.height);
    }

    drawWorld(
      player,
      platforms,
      monsters,
      debugPlatformGeneration = false,
      showPlayer = true
    ) {
      for (const platform of platforms) {
        this.drawPlatform(platform, debugPlatformGeneration);
      }
      for (const monster of monsters) {
        this.drawMonster(monster);
      }
      if (showPlayer) {
        this.drawPlayer(player);
      }
    }

    drawMonster(monster) {
      if (!monster.alive) {
        return;
      }
      const context = this.context;
      context.save();
      context.fillStyle = this.colors.monster;
      context.fillRect(monster.x, monster.y + 4, monster.width, monster.height - 4);
      context.fillRect(monster.x + 5, monster.y, monster.width - 10, 6);
      context.fillStyle = this.colors.monsterEye;
      context.fillRect(monster.x + 8, monster.y + 9, 5, 5);
      context.fillRect(monster.x + monster.width - 13, monster.y + 9, 5, 5);
      context.fillStyle = this.colors.text;
      context.font = "bold 11px Arial, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "bottom";
      context.fillText("M", monster.x + monster.width * 0.5, monster.y - 2);
      context.restore();
    }

    drawPlayer(player) {
      const context = this.context;
      const drawPositions = [player.x];
      if (player.x < 0) {
        drawPositions.push(player.x + GameConfig.width);
      } else if (player.x + player.width > GameConfig.width) {
        drawPositions.push(player.x - GameConfig.width);
      }

      for (const drawX of drawPositions) {
        context.save();
        context.translate(
          drawX + player.width * 0.5,
          player.y + player.height * 0.5
        );
        context.rotate(player.rotation);
        context.fillStyle = this.colors.player;
        context.fillRect(
          -player.width * 0.5,
          -player.height * 0.5,
          player.width,
          player.height
        );
        context.restore();
      }

      if (player.isFlying) {
        const isPropeller = player.activePowerUp === ItemType.PROPELLER_HAT;
        context.fillStyle = isPropeller ? this.colors.propeller : this.colors.jetpack;
        context.font = "bold 13px Arial, sans-serif";
        context.textAlign = "center";
        context.textBaseline = "middle";
        const label = isPropeller ? "P" : "J";
        const labelX = player.x + player.width * 0.5;
        const labelY = player.y + player.height * 0.5;
        context.fillText(label, labelX, labelY);
        if (player.x < 0) {
          context.fillText(label, labelX + GameConfig.width, labelY);
        } else if (player.x + player.width > GameConfig.width) {
          context.fillText(label, labelX - GameConfig.width, labelY);
        }
      }
    }

    drawPlatform(platform, debugPlatformGeneration = false) {
      const colorByType = {
        [PlatformType.NORMAL]: this.colors.normal,
        [PlatformType.MOVING]: this.colors.moving,
        [PlatformType.BREAKABLE]: this.colors.breakable,
        [PlatformType.FALL_THROUGH]: this.colors.fallThrough
      };
      const context = this.context;
      context.save();
      context.globalAlpha = platform.breaking
        ? clamp(platform.breakTimer / GameConfig.breakDelay, 0.25, 1)
        : 1;
      context.fillStyle = colorByType[platform.type];
      context.fillRect(platform.x, platform.y, platform.width, platform.height);

      if (platform.isBreakable) {
        context.fillStyle = this.colors.background;
        context.fillRect(platform.x + platform.width * 0.48, platform.y, 3, platform.height);
      }
      context.restore();

      if (platform.item && !platform.breaking) {
        this.drawItem(platform.item);
      }

      if (debugPlatformGeneration) {
        context.fillStyle = this.colors.text;
        context.font = "bold 12px Arial, sans-serif";
        context.textAlign = "center";
        context.textBaseline = "bottom";
        context.fillText(
          platform.isRouteContinuation && !platform.isGuaranteed
            ? "R"
            : platform.isGuaranteed ? "G" : "F",
          platform.x + platform.width * 0.5,
          platform.y - 3
        );
      }
    }

    drawItem(item) {
      if (item.type === ItemType.SPRING) {
        this.drawSpring(item);
      } else if (item.type === ItemType.PROPELLER_HAT) {
        this.drawPropellerHat(item);
      } else if (item.type === ItemType.JETPACK) {
        this.drawJetpack(item);
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

    drawPropellerHat(propeller) {
      const context = this.context;
      context.fillStyle = this.colors.propeller;
      context.fillRect(propeller.x, propeller.y + 3, propeller.width, 4);
      context.fillRect(
        propeller.x + propeller.width * 0.44,
        propeller.y,
        propeller.width * 0.12,
        propeller.height
      );
      context.fillRect(
        propeller.x + propeller.width * 0.22,
        propeller.y + propeller.height - 7,
        propeller.width * 0.56,
        7
      );
      context.fillStyle = this.colors.text;
      context.font = "bold 9px Arial, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "bottom";
      context.fillText("P", propeller.x + propeller.width * 0.5, propeller.y + propeller.height);
    }

    drawJetpack(jetpack) {
      const context = this.context;
      context.fillStyle = this.colors.jetpack;
      context.fillRect(jetpack.x, jetpack.y + 3, jetpack.width * 0.36, jetpack.height - 3);
      context.fillRect(
        jetpack.x + jetpack.width * 0.64,
        jetpack.y + 3,
        jetpack.width * 0.36,
        jetpack.height - 3
      );
      context.fillRect(
        jetpack.x + jetpack.width * 0.28,
        jetpack.y,
        jetpack.width * 0.44,
        jetpack.height * 0.7
      );
      context.fillStyle = this.colors.text;
      context.font = "bold 10px Arial, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText("J", jetpack.x + jetpack.width * 0.5, jetpack.y + jetpack.height * 0.38);
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
      const centerY = GameConfig.height * 0.5;
      this.drawOverlay();
      this.drawCenteredText(
        "Speaki-e Jump",
        centerY - 124,
        "bold 42px Arial, sans-serif"
      );
      this.drawCenteredText(
        "A / D or Arrow Keys to Move",
        centerY - 56,
        "20px Arial, sans-serif"
      );
      this.drawButton("PLAY", centerY);
      this.drawCenteredText(
        "Enter / Space / Click",
        centerY + 72,
        "17px Arial, sans-serif"
      );
    }

    drawGameOver(score, best, transitionProgress = 1) {
      const centerY = GameConfig.height * 0.5;
      const easedProgress = easeOutCubic(transitionProgress);
      const panelOffset = (1 - easedProgress) * GameConfig.gameOverPanelStartOffset;
      this.drawOverlay(easedProgress);
      this.drawCenteredText(
        "GAME OVER",
        centerY - 130 + panelOffset,
        "bold 42px Arial, sans-serif"
      );
      this.drawCenteredText(
        `Score: ${score}`,
        centerY - 66 + panelOffset,
        "24px Arial, sans-serif"
      );
      this.drawCenteredText(
        `Best: ${best}`,
        centerY - 32 + panelOffset,
        "24px Arial, sans-serif"
      );
      this.drawButton("PLAY AGAIN", centerY + 22 + panelOffset);
      this.drawCenteredText(
        "R / Enter / Space / Click",
        centerY + 94 + panelOffset,
        "17px Arial, sans-serif"
      );
    }

    drawOverlay(alpha = 1) {
      this.context.save();
      this.context.globalAlpha = clamp(alpha, 0, 1);
      this.context.fillStyle = this.colors.overlay;
      this.context.fillRect(0, 0, GameConfig.width, GameConfig.height);
      this.context.restore();
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
      this.canvas.width = GameConfig.canvasWidth;
      this.canvas.height = GameConfig.canvasHeight;
      this.context = canvas.getContext("2d");
      this.context.imageSmoothingEnabled = false;
      if (typeof this.context.setTransform === "function") {
        this.context.setTransform(
          GameConfig.renderScale,
          0,
          0,
          GameConfig.renderScale,
          0,
          0
        );
      }
      this.renderer = new GameRenderer(this.context);
      this.difficultyManager = new DifficultyManager();
      this.platformManager = new PlatformManager(this.difficultyManager);
      this.monsterManager = new MonsterManager(
        this.difficultyManager,
        this.platformManager
      );
      const spinSeed = this.platformManager.seed === null ||
        this.platformManager.seed === undefined
        ? null
        : `${this.platformManager.seed}:player-spin`;
      this.playerSpinRandom = new RandomSource(spinSeed);
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
      this.resetDeathSequence();
      this.playerSpinRandom.reset();
      this.monsterManager.reset();
      const startPlatform = this.platformManager.reset(0);
      const playerX = startPlatform.x + (startPlatform.width - GameConfig.playerWidth) * 0.5;
      const playerY = startPlatform.y - GameConfig.playerHeight;
      if (this.player) {
        this.player.reset(playerX, playerY);
      } else {
        this.player = new Player(playerX, playerY, this.playerSpinRandom);
      }
      this.startPlayerY = playerY;
    }

    resetDeathSequence() {
      this.deathReason = null;
      this.finalScore = 0;
      this.deathElapsed = 0;
      this.deathFallDistance = 0;
      this.deathCameraOffset = 0;
      this.deathCameraTarget = 0;
      this.gameOverTransitionProgress = 0;
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
      } else if (this.state === GameState.DYING) {
        this.updateDeathSequence(deltaTime);
      }
      this.render();
      this.animationFrameId = requestAnimationFrame(this.loop);
    }

    update(deltaTime) {
      this.playTime += deltaTime;
      this.platformManager.update(deltaTime);
      this.monsterManager.update(deltaTime);
      this.player.update(deltaTime, this.input.direction);
      this.resolvePowerUpPickups();

      this.resolveMonsterCollisions();
      if (this.state !== GameState.PLAYING) {
        return;
      }

      this.resolveLandings();
      if (this.shouldBeginFallDeath()) {
        this.beginDeathSequence("fall");
        return;
      }
      this.updateCamera();
      this.updateScore();
      const flightGenerationReserve = this.player.isFlying
        ? this.player.remainingFlightDistance +
          PlatformPhysics.getMaximumJumpHeight() * GameConfig.safeVerticalGapRatio
        : 0;
      const generatedLayers = this.platformManager.ensurePlatforms(
        this.score,
        flightGenerationReserve
      );
      this.monsterManager.spawnForLayers(generatedLayers);
    }

    resolvePowerUpPickups() {
      const sweptTop = Math.min(this.player.previousY, this.player.y);
      const sweptBottom = Math.max(
        this.player.previousY + this.player.height,
        this.player.y + this.player.height
      );
      const previousCenterY = this.player.previousY + this.player.height * 0.5;
      let selected = null;

      for (const platform of this.platformManager.platforms) {
        const item = platform.item;
        if (
          platform.breaking ||
          platform.removed ||
          !item ||
          item.collected ||
          (item.type !== ItemType.PROPELLER_HAT && item.type !== ItemType.JETPACK) ||
          sweptBottom < item.y ||
          sweptTop > item.y + item.height ||
          !this.overlapsWrappedX(item.x, item.width)
        ) {
          continue;
        }

        const distance = Math.abs(item.y + item.height * 0.5 - previousCenterY);
        if (!selected || distance < selected.distance) {
          selected = { item, distance };
        }
      }

      if (!selected || !selected.item.collect()) {
        return null;
      }
      this.player.activatePowerUp(selected.item.type);
      return selected.item;
    }

    resolveLandings() {
      if (this.player.isFlying || this.player.vy <= 0) {
        return;
      }

      const previousBottom = this.player.previousY + this.player.height;
      const currentBottom = this.player.y + this.player.height;
      let selected = null;

      for (const platform of this.platformManager.platforms) {
        if (platform.breaking || platform.removed) {
          continue;
        }

        const spring = platform.item?.type === ItemType.SPRING
          ? platform.item
          : null;
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
        if (selected.platform.isFallThrough) {
          selected.platform.beginBreaking();
          return;
        }
        this.player.y = selected.top - this.player.height;
        this.player.previousY = this.player.y;
        this.player.launch(selected.spring ? GameConfig.springJumpMultiplier : 1);
        selected.platform.beginBreaking();
      }
    }

    resolveMonsterCollisions() {
      const collisions = this.monsterManager.monsters.filter((monster) =>
        monster.alive && this.playerSweptOverlapsMonster(monster)
      );
      if (collisions.length === 0) {
        return null;
      }

      if (this.player.isFlying) {
        for (const monster of collisions) {
          this.monsterManager.removeMonster(monster, "POWER_UP");
        }
        return { type: "POWER_UP", monsters: collisions };
      }

      const previousBottom = this.player.previousY + this.player.height;
      const currentBottom = this.player.y + this.player.height;
      const stomp = collisions
        .filter((monster) =>
          this.player.vy > 0 &&
          previousBottom <= monster.y + 2 &&
          currentBottom >= monster.y &&
          this.playerSweptOverlapsMonsterX(monster)
        )
        .sort((first, second) => first.y - second.y)[0];

      if (stomp) {
        this.monsterManager.removeMonster(stomp, "STOMP");
        this.player.y = stomp.y - this.player.height;
        this.player.previousY = this.player.y;
        this.player.launch(GameConfig.monsterStompBounceMultiplier);
        return { type: "STOMP", monster: stomp };
      }

      this.beginDeathSequence("monster");
      return { type: "DYING", monster: collisions[0] };
    }

    playerSweptOverlapsMonster(monster) {
      const sweptTop = Math.min(this.player.previousY, this.player.y);
      const sweptBottom = Math.max(
        this.player.previousY + this.player.height,
        this.player.y + this.player.height
      );
      if (sweptBottom < monster.y || sweptTop > monster.y + monster.height) {
        return false;
      }
      return this.playerSweptOverlapsMonsterX(monster);
    }

    playerSweptOverlapsMonsterX(monster) {
      return this.playerOverlapsMonsterX(monster, this.player.x, monster.x) ||
        this.playerOverlapsMonsterX(monster, this.player.previousX, monster.x) ||
        this.playerOverlapsMonsterX(monster, this.player.x, monster.previousX) ||
        this.playerOverlapsMonsterX(monster, this.player.previousX, monster.previousX);
    }

    playerOverlapsMonsterX(
      monster,
      playerX = this.player.x,
      monsterX = monster.x
    ) {
      const playerRight = playerX + this.player.width;
      for (const offset of [-GameConfig.width, 0, GameConfig.width]) {
        const left = monsterX + offset;
        const right = left + monster.width;
        if (playerRight >= left && playerX <= right) {
          return true;
        }
      }
      return false;
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
        this.monsterManager.scroll(scrollDistance);
        this.cameraOffset += scrollDistance;
      }
    }

    updateScore() {
      const currentHeight = this.cameraOffset + Math.max(0, this.startPlayerY - this.player.y);
      this.maxHeight = Math.max(this.maxHeight, currentHeight);
      this.score = Math.floor(this.maxHeight);
    }

    hasLandingSurfaceBelow() {
      const currentBottom = this.player.y + this.player.height;
      return this.platformManager.platforms.some((platform) => {
        if (
          platform.removed ||
          platform.breaking ||
          platform.isFallThrough
        ) {
          return false;
        }
        return platform.y >= currentBottom - 2 && platform.y <= GameConfig.height;
      });
    }

    shouldBeginFallDeath() {
      if (this.player.isFlying || this.player.vy <= 0) {
        return false;
      }
      if (this.player.y > GameConfig.height) {
        return true;
      }
      return this.player.y >= GameConfig.height * GameConfig.fallDeathCheckRatio &&
        !this.hasLandingSurfaceBelow();
    }

    beginDeathSequence(reason) {
      if (this.state !== GameState.PLAYING) {
        return false;
      }

      this.state = GameState.DYING;
      this.deathReason = reason;
      this.finalScore = this.score;
      this.deathElapsed = 0;
      this.deathFallDistance = 0;
      this.deathCameraOffset = 0;
      this.deathCameraTarget = 0;
      this.gameOverTransitionProgress = 0;
      this.input.clear();
      this.player.clearPowerUp();
      this.player.cancelJumpSpin();
      if (reason === "monster") {
        this.player.vy = Math.max(
          this.player.vy,
          GameConfig.deathFallInitialVelocity
        );
      }
      if (this.finalScore > this.bestScore) {
        this.bestScore = this.finalScore;
        this.saveBestScore(this.bestScore);
      }
      return true;
    }

    updateDeathSequence(deltaTime) {
      if (this.state !== GameState.DYING) {
        return false;
      }

      this.deathElapsed += deltaTime;
      const previousPlayerY = this.player.y;
      this.player.update(deltaTime, 0);
      const physicalFallDistance = Math.max(0, this.player.y - previousPlayerY);
      this.deathFallDistance += physicalFallDistance;

      if (this.deathElapsed <= GameConfig.deathCameraDuration) {
        this.deathCameraTarget = Math.min(
          GameConfig.deathCameraMaxOffset,
          this.deathFallDistance * GameConfig.deathCameraFollowRatio
        );
        const followAmount = 1 - Math.exp(
          -GameConfig.deathCameraFollowSpeed * deltaTime
        );
        const desiredShift = Math.max(
          0,
          (this.deathCameraTarget - this.deathCameraOffset) * followAmount
        );
        const cameraShift = Math.min(
          desiredShift,
          physicalFallDistance * 0.9
        );
        if (cameraShift > 0) {
          this.deathCameraOffset += cameraShift;
          this.player.y -= cameraShift;
          this.player.previousY -= cameraShift;
          this.platformManager.scroll(-cameraShift);
          this.monsterManager.scroll(-cameraShift);
        }
      }

      this.gameOverTransitionProgress = clamp(
        this.deathElapsed / GameConfig.gameOverTransitionDuration,
        0,
        1
      );

      if (
        this.deathElapsed >= GameConfig.deathSequenceMinimumDuration &&
        this.gameOverTransitionProgress >= 1
      ) {
        this.completeDeathSequence();
      }
      return true;
    }

    completeDeathSequence() {
      if (this.state !== GameState.DYING) {
        return false;
      }
      this.state = GameState.GAME_OVER;
      this.gameOverTransitionProgress = 1;
      return true;
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
      const playerIsVisible = this.state !== GameState.GAME_OVER &&
        (
          this.state !== GameState.DYING ||
          this.player.y <= GameConfig.height + this.player.height
        );
      this.renderer.drawWorld(
        this.player,
        this.platformManager.platforms,
        this.monsterManager.monsters,
        this.platformManager.debugEnabled,
        playerIsVisible
      );

      if (this.state === GameState.PLAYING) {
        this.renderer.drawHud(this.score, this.bestScore);
      } else if (this.state === GameState.MENU) {
        this.renderer.drawMenu();
      } else if (this.state === GameState.DYING) {
        this.renderer.drawHud(this.finalScore, this.bestScore);
        this.renderer.drawGameOver(
          this.finalScore,
          this.bestScore,
          this.gameOverTransitionProgress
        );
      } else if (this.state === GameState.GAME_OVER) {
        this.renderer.drawGameOver(this.finalScore, this.bestScore, 1);
      }
    }

    getDebugSnapshot() {
      return {
        state: this.state,
        score: this.score,
        bestScore: this.bestScore,
        playTime: Math.round(this.playTime * 100) / 100,
        cameraOffset: Math.round(this.cameraOffset * 100) / 100,
        death: {
          reason: this.deathReason,
          finalScore: this.finalScore,
          elapsed: round(this.deathElapsed),
          cameraOffset: round(this.deathCameraOffset),
          cameraTarget: round(this.deathCameraTarget),
          transitionProgress: round(this.gameOverTransitionProgress),
          playerVisible:
            this.state === GameState.DYING &&
            this.player.y <= GameConfig.height + this.player.height
        },
        generation: {
          layerCount: this.platformManager.layerIndex,
          highestGeneratedY: round(this.platformManager.highestGeneratedY),
          debugEnabled: this.platformManager.debugEnabled,
          seed: this.platformManager.seed,
          fallbackCount: this.platformManager.stats.fallbackCount,
          guaranteedBreakablesGenerated:
            this.platformManager.stats.guaranteedBreakablesGenerated,
          movingBreakablesGenerated: this.platformManager.stats.movingBreakablesGenerated,
          fallThroughFillersGenerated:
            this.platformManager.stats.fallThroughFillersGenerated,
          guaranteedFallThroughGenerated:
            this.platformManager.stats.guaranteedFallThroughGenerated,
          guaranteedMovingGenerated:
            this.platformManager.stats.guaranteedMovingGenerated,
          itemsGenerated: {
            ...this.platformManager.stats.itemsGenerated
          },
          rejectedCandidates: {
            ...this.platformManager.stats.rejectedCandidates
          }
        },
        monsters: {
          activeCount: this.monsterManager.monsters.filter((monster) => monster.alive).length,
          stats: {
            ...this.monsterManager.stats,
            rejectedCandidates: {
              ...this.monsterManager.stats.rejectedCandidates
            }
          },
          entries: this.monsterManager.monsters.map((monster) => ({
            x: round(monster.x),
            y: round(monster.y),
            width: monster.width,
            height: monster.height,
            vx: round(monster.vx),
            originX: round(monster.originX),
            moveRange: monster.moveRange,
            type: monster.type,
            alive: monster.alive,
            spawnLayer: monster.spawnLayer,
            spawnScore: monster.spawnScore,
            anchorIsGuaranteed: monster.anchorIsGuaranteed
          }))
        },
        player: {
          x: Math.round(this.player.x * 100) / 100,
          y: Math.round(this.player.y * 100) / 100,
          vx: Math.round(this.player.vx * 100) / 100,
          vy: Math.round(this.player.vy * 100) / 100,
          activePowerUp: this.player.activePowerUp,
          powerUpTimer: round(this.player.powerUpTimer),
          isFlying: this.player.isFlying,
          remainingFlightDistance: round(this.player.remainingFlightDistance),
          jumpSpinActive: this.player.jumpSpinActive,
          rotation: round(this.player.rotation)
        },
        platforms: this.platformManager.platforms.map((platform) => ({
          x: Math.round(platform.x * 100) / 100,
          y: Math.round(platform.y * 100) / 100,
          width: Math.round(platform.width * 100) / 100,
          type: platform.type,
          isBreakable: platform.isBreakable,
          isFallThrough: platform.isFallThrough,
          itemType: platform.item?.type || null,
          hasSpring: platform.item?.type === ItemType.SPRING,
          breaking: platform.breaking,
          layerIndex: platform.layerIndex,
          isGuaranteed: platform.isGuaranteed,
          isRouteContinuation: platform.isRouteContinuation,
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
