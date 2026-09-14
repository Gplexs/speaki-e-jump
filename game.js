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
    openingRouteLayers: 11, // Eleven landings plus the merge is roughly ten seconds.
    openingRouteMinGap: 113,
    openingRouteMaxGap: 121,
    openingRouteMinWidth: 100,
    openingRouteMaxWidth: 112,
    openingRouteHorizontalJitter: 14,
    openingRouteSpreads: Object.freeze([80, 100, 115]),
    openingRouteInnerHalfGap: 80,
    openingRouteVerticalStagger: 14,
    openingRouteMergeGap: 108,
    cameraThreshold: 0.4,
    cleanupMargin: 100,
    spawnMargin: 130,
    maxDeltaTime: 1 / 30,
    breakDelay: 0.22,
    bestScoreKey: "speaki-e-jump-best-score"
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
  const randomRange = (min, max) => min + Math.random() * (max - min);

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
    constructor(x, y, width, type = PlatformType.NORMAL, moveRange = 0, moveSpeed = 0) {
      this.x = x;
      this.y = y;
      this.width = width;
      this.height = GameConfig.platformHeight;
      this.type = type;
      this.item = null;
      this.breaking = false;
      this.breakTimer = 0;
      this.removed = false;
      this.openingRoute = null;
      this.openingLayer = null;
      this.openingMerge = false;
      this.moveDirection = Math.random() < 0.5 ? -1 : 1;
      this.moveSpeed = moveSpeed;
      this.moveMin = Math.max(8, x - moveRange);
      this.moveMax = Math.min(GameConfig.width - width - 8, x + moveRange);
    }

    addSpring() {
      const inset = 8;
      const maxOffset = Math.max(inset, this.width - 20 - inset);
      this.item = new Spring(this, randomRange(inset, maxOffset));
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
    getSettings(score) {
      const level = clamp(score / 12000, 0, 1);
      return {
        level,
        minGap: lerp(70, 91, level),
        maxGap: lerp(91, 118, level),
        minWidth: lerp(90, 62, level),
        maxWidth: lerp(112, 82, level),
        movingChance: lerp(0.06, 0.23, level),
        breakableChance: lerp(0.04, 0.19, level),
        springChance: lerp(0.06, 0.11, level)
      };
    }
  }

  class PlatformManager {
    constructor(difficultyManager) {
      this.difficultyManager = difficultyManager;
      this.platforms = [];
      this.generatedCount = 0;
      this.lastGenerated = null;
      this.openingRoutes = null;
      this.openingLayer = 0;
      this.openingLayerY = 0;
    }

    reset(score = 0) {
      this.platforms.length = 0;
      this.generatedCount = 0;
      this.openingLayer = 0;

      const startX = (GameConfig.width - GameConfig.startPlatformWidth) / 2;
      const start = new Platform(
        startX,
        GameConfig.startPlatformY,
        GameConfig.startPlatformWidth,
        PlatformType.NORMAL
      );
      this.platforms.push(start);
      this.lastGenerated = start;
      this.openingRoutes = [start, start];
      this.openingLayerY = start.y;
      this.ensurePlatforms(score);
      return start;
    }

    update(deltaTime) {
      for (const platform of this.platforms) {
        platform.update(deltaTime);
      }
      this.platforms = this.platforms.filter(
        (platform) => !platform.removed && platform.y < GameConfig.height + GameConfig.cleanupMargin
      );
    }

    scroll(distance) {
      for (const platform of this.platforms) {
        platform.y += distance;
      }
    }

    ensurePlatforms(score) {
      if (this.openingRoutes) {
        while (this.openingLayer < GameConfig.openingRouteLayers) {
          this.createOpeningRouteLayer();
        }
        this.mergeOpeningRoutes();
      }

      while (this.lastGenerated.y > -GameConfig.spawnMargin) {
        this.lastGenerated = this.createNextPlatform(this.lastGenerated, score);
        this.platforms.push(this.lastGenerated);
      }
    }

    createOpeningRouteLayer() {
      const nextLayer = this.openingLayer + 1;
      const gap = randomRange(GameConfig.openingRouteMinGap, GameConfig.openingRouteMaxGap);
      this.openingLayerY -= gap;
      const nextRoutes = this.openingRoutes.map((previous, routeId) => {
        const width = randomRange(
          GameConfig.openingRouteMinWidth,
          GameConfig.openingRouteMaxWidth
        );
        const y = this.openingLayerY +
          (routeId === 0 ? -GameConfig.openingRouteVerticalStagger : GameConfig.openingRouteVerticalStagger);
        const x = this.findOpeningRouteX(previous, width, routeId, nextLayer);
        const platform = new Platform(x, y, width, PlatformType.NORMAL);
        platform.openingRoute = routeId;
        platform.openingLayer = nextLayer;
        return platform;
      });

      this.platforms.push(...nextRoutes);
      this.openingRoutes = nextRoutes;
      this.openingLayer = nextLayer;
      this.generatedCount += 1;
      this.lastGenerated = nextRoutes.reduce(
        (highest, platform) => platform.y < highest.y ? platform : highest,
        nextRoutes[0]
      );
    }

    findOpeningRouteX(previous, width, routeId, layer) {
      const edgeInset = 8;
      const halfWidth = width * 0.5;
      const previousCenter = previous.x + previous.width * 0.5;
      const openingSpreads = GameConfig.openingRouteSpreads;
      const scriptedSpread = openingSpreads[Math.min(layer, openingSpreads.length) - 1];
      const scriptedCenter = GameConfig.width * 0.5 + (routeId === 0 ? -scriptedSpread : scriptedSpread);
      const desiredCenter = layer <= openingSpreads.length
        ? scriptedCenter + randomRange(-5, 5)
        : previousCenter + randomRange(
          -GameConfig.openingRouteHorizontalJitter,
          GameConfig.openingRouteHorizontalJitter
        );
      const laneMin = routeId === 0
        ? halfWidth + edgeInset
        : GameConfig.width * 0.5 + GameConfig.openingRouteInnerHalfGap;
      const laneMax = routeId === 0
        ? GameConfig.width * 0.5 - GameConfig.openingRouteInnerHalfGap
        : GameConfig.width - halfWidth - edgeInset;
      const center = clamp(desiredCenter, laneMin, laneMax);
      return center - halfWidth;
    }

    mergeOpeningRoutes() {
      const highestY = Math.min(...this.openingRoutes.map((platform) => platform.y));
      const width = GameConfig.openingRouteMaxWidth;
      const x = (GameConfig.width - width) * 0.5;
      const merge = new Platform(
        x,
        highestY - GameConfig.openingRouteMergeGap,
        width,
        PlatformType.NORMAL
      );
      merge.openingMerge = true;
      this.platforms.push(merge);
      this.generatedCount += 1;
      this.lastGenerated = merge;
      this.openingRoutes = null;
    }

    createNextPlatform(previous, score) {
      const settings = this.difficultyManager.getSettings(score);
      const easyStart = this.generatedCount < 5;
      const width = easyStart
        ? randomRange(100, 116)
        : randomRange(settings.minWidth, settings.maxWidth);

      let type = PlatformType.NORMAL;
      if (!easyStart) {
        const roll = Math.random();
        if (roll < settings.movingChance) {
          type = PlatformType.MOVING;
        } else if (
          roll < settings.movingChance + settings.breakableChance &&
          previous.type !== PlatformType.BREAKABLE
        ) {
          type = PlatformType.BREAKABLE;
        }
      }

      // The two neighbours of a breakable platform remain mutually reachable
      // after it disappears, preventing a permanently blocked route.
      const bridgesBreakable =
        type === PlatformType.BREAKABLE || previous.type === PlatformType.BREAKABLE;
      const gap = easyStart
        ? randomRange(68, 84)
        : bridgesBreakable
          ? randomRange(50, 57)
          : randomRange(settings.minGap, settings.maxGap);
      const y = previous.y - gap;
      const horizontalScale = bridgesBreakable ? 0.34 : 0.58;
      const x = this.findReachableX(previous, width, gap, horizontalScale);
      const moveRange = type === PlatformType.MOVING ? randomRange(34, 68) : 0;
      const moveSpeed = type === PlatformType.MOVING ? randomRange(42, 78) : 0;
      const platform = new Platform(x, y, width, type, moveRange, moveSpeed);

      if (!easyStart && Math.random() < settings.springChance) {
        platform.addSpring();
      }

      this.generatedCount += 1;
      return platform;
    }

    findReachableX(previous, width, verticalGap, horizontalScale) {
      const discriminant = Math.max(
        0,
        GameConfig.jumpPower ** 2 - 2 * GameConfig.gravity * verticalGap
      );
      const landingTime = (GameConfig.jumpPower + Math.sqrt(discriminant)) / GameConfig.gravity;
      const overlapAllowance = (previous.width + width) * 0.5 - GameConfig.playerWidth * 0.35;
      const maximumCenterDistance = Math.min(
        205,
        GameConfig.maxMoveSpeed * landingTime * 0.68 + overlapAllowance
      );
      const previousCenter = previous.x + previous.width * 0.5;
      const edgeInset = 8;

      for (let attempt = 0; attempt < 12; attempt += 1) {
        const desiredDistance = randomRange(
          -maximumCenterDistance * horizontalScale,
          maximumCenterDistance * horizontalScale
        );
        let center = (previousCenter + desiredDistance + GameConfig.width) % GameConfig.width;
        let candidateX = clamp(center - width * 0.5, edgeInset, GameConfig.width - width - edgeInset);
        center = candidateX + width * 0.5;
        const rawDistance = Math.abs(center - previousCenter);
        const wrappedDistance = Math.min(rawDistance, GameConfig.width - rawDistance);
        if (wrappedDistance <= maximumCenterDistance) {
          return candidateX;
        }
      }

      return clamp(previousCenter - width * 0.5, edgeInset, GameConfig.width - width - edgeInset);
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

    drawWorld(player, platforms) {
      for (const platform of platforms) {
        this.drawPlatform(platform);
      }
      this.drawPlayer(player);
    }

    drawPlayer(player) {
      const context = this.context;
      context.fillStyle = this.colors.player;
      this.drawWrappedRectangle(player.x, player.y, player.width, player.height);
    }

    drawPlatform(platform) {
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
      this.renderer.drawWorld(this.player, this.platformManager.platforms);

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
        openingRouteLayerCount: this.platformManager.openingLayer,
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
          openingRoute: platform.openingRoute,
          openingLayer: platform.openingLayer,
          openingMerge: platform.openingMerge
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
    config: GameConfig
  });
})();
