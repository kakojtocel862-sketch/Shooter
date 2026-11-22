import { SoundEngine } from './audio';
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BEST_SCORE_STORAGE_KEY,
  COLORS,
  UPGRADE_POOL,
  WEAPONS,
} from './constants';
import {
  DifficultyMode,
  Enemy,
  EnemyType,
  FloatingText,
  GamePhase,
  HudSnapshot,
  Obstacle,
  Particle,
  Pickup,
  PickupKind,
  PlayerModifiers,
  Projectile,
  ScorchMark,
  ShellCasing,
  UpgradeOption,
  WeaponId,
  WeaponState,
} from './types';

const MAX_PROJECTILES = 360;
const MAX_PARTICLES = 480;
const MAX_CASINGS = 120;
const MAX_FLOATING_TEXTS = 40;
const MAX_SCORCH_MARKS = 48;

interface DashGhost {
  x: number;
  y: number;
  angle: number;
  alpha: number;
}

interface SpawnPending {
  x: number;
  y: number;
  type: EnemyType;
  timer: number;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function distSq(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return dx * dx + dy * dy;
}

function circleRectResolve(
  cx: number,
  cy: number,
  r: number,
  rect: Obstacle
): { x: number; y: number; hit: boolean; nx: number; ny: number } {
  const closestX = clamp(cx, rect.x, rect.x + rect.w);
  const closestY = clamp(cy, rect.y, rect.y + rect.h);
  const dx = cx - closestX;
  const dy = cy - closestY;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) {
    return { x: cx, y: cy, hit: false, nx: 0, ny: 0 };
  }
  const d = Math.sqrt(d2);
  if (d > 0.0001) {
    const overlap = r - d;
    const nx = dx / d;
    const ny = dy / d;
    return { x: cx + nx * overlap, y: cy + ny * overlap, hit: true, nx, ny };
  }
  // Center inside rect fallback
  const leftPen = cx - rect.x;
  const rightPen = rect.x + rect.w - cx;
  const topPen = cy - rect.y;
  const bottomPen = rect.y + rect.h - cy;
  const minPen = Math.min(leftPen, rightPen, topPen, bottomPen);
  if (minPen === leftPen) return { x: rect.x - r, y: cy, hit: true, nx: -1, ny: 0 };
  if (minPen === rightPen) return { x: rect.x + rect.w + r, y: cy, hit: true, nx: 1, ny: 0 };
  if (minPen === topPen) return { x: cx, y: rect.y - r, hit: true, nx: 0, ny: -1 };
  return { x: cx, y: rect.y + rect.h + r, hit: true, nx: 0, ny: 1 };
}

function segmentIntersectsRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  r: Obstacle
): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const checks = [
    [-dx, x1 - r.x],
    [dx, r.x + r.w - x1],
    [-dy, y1 - r.y],
    [dy, r.y + r.h - y1],
  ];
  for (let i = 0; i < 4; i++) {
    const p = checks[i][0];
    const q = checks[i][1];
    if (Math.abs(p) < 1e-8) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return t0 <= t1;
}

export class ShooterEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private sound = new SoundEngine();
  private onHudUpdate: (snapshot: HudSnapshot) => void;

  private rafId: number | null = null;
  private lastTime = 0;
  private hudSyncAccumulator = 0;

  private viewW = 1280;
  private viewH = 720;
  private dpr = 1;
  private camX = ARENA_WIDTH / 2;
  private camY = ARENA_HEIGHT / 2;
  private camZoom = 1;
  private shakeTrauma = 0;
  private hitstopTimer = 0;
  private damageVignette = 0;

  private phase: GamePhase = 'TITLE_MENU';
  private difficulty: DifficultyMode = 'standard';

  // Input tracking
  private heldKeys = new Set<string>();
  private mouseDown = false;
  private mouseScreenX = 0;
  private mouseScreenY = 0;
  private mouseWorldX = ARENA_WIDTH / 2 + 120;
  private mouseWorldY = ARENA_HEIGHT / 2;
  private dashBufferTimer = 0;

  // Player state
  private player = {
    x: ARENA_WIDTH / 2,
    y: ARENA_HEIGHT / 2,
    vx: 0,
    vy: 0,
    radius: 17,
    angle: 0,
    hp: 100,
    maxHp: 100,
    armor: 25,
    maxArmor: 75,
    baseSpeed: 315,
    dashTimer: 0,
    dashCooldown: 0,
    dashMaxCooldown: 1.35,
    dashDirX: 1,
    dashDirY: 0,
    invulnTimer: 0,
    hitFlash: 0,
    squashX: 1,
    squashY: 1,
    recoilOffset: 0,
    overchargeTimer: 0,
  };

  private modifiers: PlayerModifiers = {
    damageMult: 1,
    fireRateMult: 1,
    moveSpeedMult: 1,
    dashCooldownMult: 1,
    reloadSpeedMult: 1,
    maxHpBonus: 0,
    vampirismOnKill: 0,
    ricochetCount: 0,
    extraRailPierce: 0,
  };

  private activeWeapon: WeaponId = 'rifle';
  private fireCooldown = 0;
  private weaponStates: Record<WeaponId, WeaponState> = {
    rifle: { id: 'rifle', ammo: WEAPONS.rifle.magSize, magSize: WEAPONS.rifle.magSize, reloadTimer: 0, isReloading: false },
    shotgun: { id: 'shotgun', ammo: WEAPONS.shotgun.magSize, magSize: WEAPONS.shotgun.magSize, reloadTimer: 0, isReloading: false },
    railgun: { id: 'railgun', ammo: WEAPONS.railgun.magSize, magSize: WEAPONS.railgun.magSize, reloadTimer: 0, isReloading: false },
  };

  // Progression & stats
  private score = 0;
  private bestScore = 0;
  private wave = 1;
  private kills = 0;
  private shotsFired = 0;
  private shotsHit = 0;
  private combo = 1;
  private maxCombo = 1;
  private comboTimer = 0;
  private readonly comboDuration = 3.4;
  private waveClearDelay = 0;
  private waveBannerTimer = 0;
  private waveBannerText: string | null = null;
  private upgradeChoices: UpgradeOption[] = [];
  private acquiredUpgradeIds: string[] = [];

  // Entities & pools
  private obstacles: Obstacle[] = [];
  private enemies: Enemy[] = [];
  private spawnQueue: SpawnPending[] = [];
  private spawnTickTimer = 0;
  private pickups: Pickup[] = [];
  private dashGhosts: DashGhost[] = [];
  private scorchMarks: ScorchMark[] = [];
  private nextEntityId = 1;
  private hitmarkerTimer = 0;
  private hitmarkerCrit = false;
  private muzzleFlashTimer = 0;
  private muzzleFlashAngle = 0;
  private muzzleFlashColor = '#FBBF24';

  private projectiles: Projectile[] = [];
  private particles: Particle[] = [];
  private casings: ShellCasing[] = [];
  private floatingTexts: FloatingText[] = [];

  // Title background ambient timers
  private ambientTime = 0;
  private ambientDrones: { x: number; y: number; vx: number; vy: number; angle: number }[] = [];

  constructor(canvas: HTMLCanvasElement, onHudUpdate: (snapshot: HudSnapshot) => void) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Could not acquire 2D canvas context');
    }
    this.ctx = context;
    this.onHudUpdate = onHudUpdate;

    try {
      const saved = localStorage.getItem(BEST_SCORE_STORAGE_KEY);
      if (saved) this.bestScore = parseInt(saved, 10) || 0;
    } catch {
      this.bestScore = 0;
    }

    this.initPools();
    this.buildArenaLayout();
    this.initAmbientDrones();
    this.handleResize();
    this.bindEvents();
    this.emitHudSnapshot();
  }

  private initPools(): void {
    for (let i = 0; i < MAX_PROJECTILES; i++) {
      this.projectiles.push({
        active: false,
        fromPlayer: true,
        x: 0,
        y: 0,
        prevX: 0,
        prevY: 0,
        vx: 0,
        vy: 0,
        radius: 3,
        damage: 10,
        life: 0,
        maxLife: 1,
        pierceLeft: 0,
        bouncesLeft: 0,
        knockback: 0,
        color: '#FBBF24',
        tracerLength: 20,
        tracerWidth: 2,
        hitEnemyIds: [],
      });
    }
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({
        active: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        size: 3,
        life: 0,
        maxLife: 0.5,
        color: '#F59E0B',
        drag: 0.92,
        kind: 'spark',
      });
    }
    for (let i = 0; i < MAX_CASINGS; i++) {
      this.casings.push({
        active: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        angle: 0,
        vAngle: 0,
        life: 0,
        color: '#D97706',
        length: 6,
        width: 3,
      });
    }
    for (let i = 0; i < MAX_FLOATING_TEXTS; i++) {
      this.floatingTexts.push({
        active: false,
        x: 0,
        y: 0,
        vy: -38,
        text: '',
        color: '#FFFFFF',
        life: 0,
        maxLife: 0.8,
        scale: 1,
      });
    }
  }

  private buildArenaLayout(): void {
    // Symmetric tactical cover layout with wide lanes around center spawn
    this.obstacles = [
      // Four primary armored pillars framing center courtyard
      { x: 420, y: 270, w: 110, h: 70, kind: 'pillar' },
      { x: ARENA_WIDTH - 530, y: 270, w: 110, h: 70, kind: 'pillar' },
      { x: 420, y: ARENA_HEIGHT - 340, w: 110, h: 70, kind: 'pillar' },
      { x: ARENA_WIDTH - 530, y: ARENA_HEIGHT - 340, w: 110, h: 70, kind: 'pillar' },

      // Side cover crates
      { x: 220, y: ARENA_HEIGHT / 2 - 55, w: 64, h: 110, kind: 'crate' },
      { x: ARENA_WIDTH - 284, y: ARENA_HEIGHT / 2 - 55, w: 64, h: 110, kind: 'crate' },

      // North / South tactical barriers
      { x: ARENA_WIDTH / 2 - 75, y: 165, w: 150, h: 48, kind: 'crate' },
      { x: ARENA_WIDTH / 2 - 75, y: ARENA_HEIGHT - 213, w: 150, h: 48, kind: 'crate' },
    ];
  }

  private initAmbientDrones(): void {
    this.ambientDrones = [
      { x: 320, y: 240, vx: 65, vy: 42, angle: 0.5 },
      { x: 1220, y: 310, vx: -58, vy: 50, angle: 2.3 },
      { x: 460, y: 780, vx: 72, vy: -38, angle: -0.6 },
      { x: 1160, y: 740, vx: -62, vy: -48, angle: -2.4 },
    ];
  }

  public startLoop(): void {
    if (this.rafId !== null) return;
    this.lastTime = performance.now();
    const tick = (now: number) => {
      const rawDt = (now - this.lastTime) / 1000;
      this.lastTime = now;
      const dt = Math.min(Math.max(rawDt, 0), 0.05);
      this.update(dt);
      this.render();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  public destroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.unbindEvents();
  }

  // Event handlers stored as arrow properties for clean removal
  private onResize = () => this.handleResize();

  private onKeyDown = (e: KeyboardEvent) => {
    const code = e.code;
    if (
      code === 'Space' ||
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight'
    ) {
      e.preventDefault();
    }

    if (this.phase === 'TITLE_MENU') {
      if (code === 'Enter' || code === 'Space') {
        this.startNewGame(this.difficulty);
      }
      return;
    }

    if (this.phase === 'UPGRADE') {
      if (code === 'Digit1' && this.upgradeChoices[0]) this.selectUpgrade(this.upgradeChoices[0].id);
      if (code === 'Digit2' && this.upgradeChoices[1]) this.selectUpgrade(this.upgradeChoices[1].id);
      if (code === 'Digit3' && this.upgradeChoices[2]) this.selectUpgrade(this.upgradeChoices[2].id);
      return;
    }

    if (code === 'Escape' || code === 'KeyP') {
      if (this.phase === 'PLAYING') {
        this.pauseGame();
      } else if (this.phase === 'PAUSED') {
        this.resumeGame();
      }
      return;
    }

    if (this.phase !== 'PLAYING') return;

    const wasHeld = this.heldKeys.has(code);
    this.heldKeys.add(code);

    if (!wasHeld) {
      if (code === 'Space' || code === 'ShiftLeft' || code === 'ShiftRight') {
        this.dashBufferTimer = 0.14;
      } else if (code === 'Digit1') {
        this.switchWeapon('rifle');
      } else if (code === 'Digit2') {
        this.switchWeapon('shotgun');
      } else if (code === 'Digit3') {
        this.switchWeapon('railgun');
      } else if (code === 'KeyR') {
        this.startReload();
      } else if (code === 'KeyQ') {
        this.cycleWeapon(1);
      }
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.heldKeys.delete(e.code);
  };

  private onMouseMove = (e: MouseEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    this.mouseScreenX = e.clientX - rect.left;
    this.mouseScreenY = e.clientY - rect.top;
  };

  private onMouseDown = (e: MouseEvent) => {
    if (this.phase !== 'PLAYING') return;
    this.sound.unlock();
    if (e.button === 0) {
      this.mouseDown = true;
    } else if (e.button === 2) {
      this.dashBufferTimer = 0.14;
    }
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) {
      this.mouseDown = false;
    }
  };

  private onWheel = (e: WheelEvent) => {
    if (this.phase !== 'PLAYING') return;
    if (Math.abs(e.deltaY) > 4) {
      this.cycleWeapon(e.deltaY > 0 ? 1 : -1);
    }
  };

  private onContextMenu = (e: MouseEvent) => {
    if (this.phase === 'PLAYING') {
      e.preventDefault();
    }
  };

  private onBlur = () => {
    this.heldKeys.clear();
    this.mouseDown = false;
    if (this.phase === 'PLAYING') {
      this.pauseGame();
    }
  };

  private bindEvents(): void {
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    this.canvas.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: true });
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  private unbindEvents(): void {
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.canvas.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
  }

  private handleResize(): void {
    const parent = this.canvas.parentElement;
    const w = parent ? parent.clientWidth : window.innerWidth;
    const h = parent ? parent.clientHeight : window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.viewW = Math.max(320, w);
    this.viewH = Math.max(240, h);
    this.canvas.width = Math.floor(this.viewW * this.dpr);
    this.canvas.height = Math.floor(this.viewH * this.dpr);
    this.canvas.style.width = `${this.viewW}px`;
    this.canvas.style.height = `${this.viewH}px`;

    // Scale zoom so desktop (~1440px) shows crisp tactical sightlines
    const targetSpanX = 1280;
    const targetSpanY = 780;
    this.camZoom = clamp(Math.max(this.viewW / targetSpanX, this.viewH / targetSpanY), 0.7, 1.35);
  }

  // Public API for React UI controls
  public setDifficulty(diff: DifficultyMode): void {
    this.difficulty = diff;
    this.emitHudSnapshot();
  }

  public toggleMute(): void {
    this.sound.toggleMute();
    this.emitHudSnapshot();
  }

  public startNewGame(difficulty?: DifficultyMode): void {
    if (difficulty) this.difficulty = difficulty;
    this.sound.unlock();
    this.heldKeys.clear();
    this.mouseDown = false;

    this.player.x = ARENA_WIDTH / 2;
    this.player.y = ARENA_HEIGHT / 2;
    this.player.vx = 0;
    this.player.vy = 0;
    this.player.maxHp = 100;
    this.player.hp = 100;
    this.player.armor = this.difficulty === 'standard' ? 30 : 15;
    this.player.dashTimer = 0;
    this.player.dashCooldown = 0;
    this.player.invulnTimer = 0.6;
    this.player.hitFlash = 0;
    this.player.squashX = 1;
    this.player.squashY = 1;
    this.player.recoilOffset = 0;
    this.player.overchargeTimer = 0;

    this.modifiers = {
      damageMult: 1,
      fireRateMult: 1,
      moveSpeedMult: 1,
      dashCooldownMult: 1,
      reloadSpeedMult: 1,
      maxHpBonus: 0,
      vampirismOnKill: 0,
      ricochetCount: 0,
      extraRailPierce: 0,
    };

    this.activeWeapon = 'rifle';
    this.fireCooldown = 0;
    this.weaponStates = {
      rifle: { id: 'rifle', ammo: WEAPONS.rifle.magSize, magSize: WEAPONS.rifle.magSize, reloadTimer: 0, isReloading: false },
      shotgun: { id: 'shotgun', ammo: WEAPONS.shotgun.magSize, magSize: WEAPONS.shotgun.magSize, reloadTimer: 0, isReloading: false },
      railgun: { id: 'railgun', ammo: WEAPONS.railgun.magSize, magSize: WEAPONS.railgun.magSize, reloadTimer: 0, isReloading: false },
    };

    this.score = 0;
    this.wave = 1;
    this.kills = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.combo = 1;
    this.maxCombo = 1;
    this.comboTimer = 0;
    this.waveClearDelay = 0;
    this.upgradeChoices = [];
    this.acquiredUpgradeIds = [];

    this.enemies = [];
    this.spawnQueue = [];
    this.pickups = [];
    this.dashGhosts = [];
    this.scorchMarks = [];
    for (const p of this.projectiles) p.active = false;
    for (const pt of this.particles) pt.active = false;
    for (const c of this.casings) c.active = false;
    for (const ft of this.floatingTexts) ft.active = false;

    this.camX = this.player.x;
    this.camY = this.player.y;
    this.shakeTrauma = 0;
    this.damageVignette = 0;
    this.hitstopTimer = 0;

    this.phase = 'PLAYING';
    this.beginWave(1);
    this.emitHudSnapshot();
  }

  public pauseGame(): void {
    if (this.phase !== 'PLAYING') return;
    this.phase = 'PAUSED';
    this.heldKeys.clear();
    this.mouseDown = false;
    this.emitHudSnapshot();
  }

  public resumeGame(): void {
    if (this.phase !== 'PAUSED') return;
    this.phase = 'PLAYING';
    this.lastTime = performance.now();
    this.emitHudSnapshot();
  }

  public returnToTitle(): void {
    this.phase = 'TITLE_MENU';
    this.heldKeys.clear();
    this.mouseDown = false;
    this.emitHudSnapshot();
  }

  public switchWeapon(id: WeaponId): void {
    if (this.activeWeapon === id) return;
    this.activeWeapon = id;
    this.fireCooldown = Math.min(this.fireCooldown, 0.12);
    this.emitHudSnapshot();
  }

  private cycleWeapon(dir: 1 | -1): void {
    const order: WeaponId[] = ['rifle', 'shotgun', 'railgun'];
    const idx = order.indexOf(this.activeWeapon);
    const next = order[(idx + dir + order.length) % order.length];
    this.switchWeapon(next);
  }

  public selectUpgrade(upgradeId: string): void {
    if (this.phase !== 'UPGRADE') return;
    const chosen = this.upgradeChoices.find((u) => u.id === upgradeId);
    if (!chosen) return;

    this.acquiredUpgradeIds.push(upgradeId);
    switch (upgradeId) {
      case 'heavy_caliber':
        this.modifiers.damageMult += 0.2;
        break;
      case 'rapid_bolt':
        this.modifiers.fireRateMult += 0.18;
        break;
      case 'tactical_thrusters':
        this.modifiers.moveSpeedMult += 0.14;
        this.modifiers.dashCooldownMult *= 0.72;
        break;
      case 'composite_plating':
        this.modifiers.maxHpBonus += 30;
        this.player.maxHp = 100 + this.modifiers.maxHpBonus;
        this.player.hp = this.player.maxHp;
        this.player.armor = Math.min(this.player.maxArmor, this.player.armor + 20);
        break;
      case 'quick_mag':
        this.modifiers.reloadSpeedMult += 0.35;
        break;
      case 'ricochet_rounds':
        this.modifiers.ricochetCount += 1;
        break;
      case 'nano_siphon':
        this.modifiers.vampirismOnKill += 4;
        break;
      case 'overclocked_rails':
        this.modifiers.extraRailPierce += 3;
        this.modifiers.damageMult += 0.15;
        break;
    }

    // Refill all magazines smoothly between waves
    for (const key of ['rifle', 'shotgun', 'railgun'] as WeaponId[]) {
      const ws = this.weaponStates[key];
      ws.ammo = ws.magSize;
      ws.isReloading = false;
      ws.reloadTimer = 0;
    }

    this.sound.playPickup();
    this.wave += 1;
    this.phase = 'PLAYING';
    this.beginWave(this.wave);
    this.emitHudSnapshot();
  }

  private beginWave(waveNum: number): void {
    this.waveBannerText = `ВОЛНА ${waveNum}`;
    this.waveBannerTimer = 2.0;
    this.waveClearDelay = 0;

    const vetBonus = this.difficulty === 'veteran' ? 3 : 0;
    const totalCount = 6 + Math.floor(waveNum * 3.2) + vetBonus;

    const queue: SpawnPending[] = [];
    const gateCoords = [
      { x: 110, y: 120 },
      { x: ARENA_WIDTH - 110, y: 120 },
      { x: 110, y: ARENA_HEIGHT - 120 },
      { x: ARENA_WIDTH - 110, y: ARENA_HEIGHT - 120 },
      { x: ARENA_WIDTH / 2, y: 75 },
      { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT - 75 },
      { x: 75, y: ARENA_HEIGHT / 2 },
      { x: ARENA_WIDTH - 75, y: ARENA_HEIGHT / 2 },
    ];

    for (let i = 0; i < totalCount; i++) {
      const roll = Math.random();
      let type: EnemyType = 'trooper';
      if (waveNum >= 4 && roll < 0.15) {
        type = 'heavy';
      } else if (waveNum >= 3 && roll < 0.31) {
        type = 'bomber';
      } else if (waveNum >= 2 && roll < 0.5) {
        type = 'sniper';
      } else if (roll < 0.72) {
        type = 'rusher';
      }

      // Guarantee at least one heavy on wave 3+
      if (waveNum >= 3 && i === totalCount - 1 && !queue.some((q) => q.type === 'heavy')) {
        type = 'heavy';
      }

      // Pick a gate far enough from player
      const sortedGates = [...gateCoords].sort((a, b) => {
        return distSq(b.x, b.y, this.player.x, this.player.y) - distSq(a.x, a.y, this.player.x, this.player.y);
      });
      const gate = sortedGates[Math.floor(Math.random() * Math.min(4, sortedGates.length))];
      const jitterX = (Math.random() - 0.5) * 70;
      const jitterY = (Math.random() - 0.5) * 70;
      queue.push({
        x: clamp(gate.x + jitterX, 55, ARENA_WIDTH - 55),
        y: clamp(gate.y + jitterY, 55, ARENA_HEIGHT - 55),
        type,
        timer: 0.75,
      });
    }

    // Stagger spawning via spawnQueue + active telegraph markers
    this.spawnQueue = queue;
    this.spawnTickTimer = 0.05;
  }

  private spawnEnemy(type: EnemyType, x: number, y: number): void {
    const waveScale = 1 + (this.wave - 1) * 0.11;
    const diffMult = this.difficulty === 'veteran' ? 1.22 : 1.0;

    let radius = 16;
    let hp = 56;
    let speed = 155;
    let scoreValue = 100;

    switch (type) {
      case 'trooper':
        radius = 16;
        hp = 60 * waveScale * diffMult;
        speed = 150 + Math.min(45, this.wave * 4);
        scoreValue = 110;
        break;
      case 'rusher':
        radius = 14;
        hp = 42 * waveScale * diffMult;
        speed = 210 + Math.min(55, this.wave * 5);
        scoreValue = 130;
        break;
      case 'heavy':
        radius = 25;
        hp = 210 * waveScale * diffMult;
        speed = 92 + Math.min(24, this.wave * 2);
        scoreValue = 320;
        break;
      case 'sniper':
        radius = 15;
        hp = 48 * waveScale * diffMult;
        speed = 135;
        scoreValue = 180;
        break;
      case 'bomber':
        radius = 15;
        hp = 45 * waveScale * diffMult;
        speed = 225 + Math.min(45, this.wave * 4);
        scoreValue = 160;
        break;
    }

    this.enemies.push({
      id: this.nextEntityId++,
      type,
      x,
      y,
      vx: 0,
      vy: 0,
      radius,
      hp,
      maxHp: hp,
      speed,
      angle: Math.atan2(this.player.y - y, this.player.x - x),
      hitFlash: 0,
      squashX: 1.25,
      squashY: 0.78,
      state: 'chase',
      stateTimer: 0.6 + Math.random() * 0.8,
      windupDuration: 0.5,
      aimAngle: 0,
      burstRemaining: 0,
      burstTimer: 0,
      scoreValue,
      strafeDir: Math.random() < 0.5 ? 1 : -1,
    });

    this.spawnRingParticle(x, y, 26, '#EF4444');
  }

  private startReload(): void {
    const ws = this.weaponStates[this.activeWeapon];
    if (ws.isReloading || ws.ammo >= ws.magSize) return;
    const spec = WEAPONS[this.activeWeapon];
    ws.isReloading = true;
    ws.reloadTimer = spec.reloadTime / this.modifiers.reloadSpeedMult;
    this.sound.playReload();
    this.emitHudSnapshot();
  }

  private update(dt: number): void {
    this.ambientTime += dt;

    if (this.phase === 'TITLE_MENU') {
      this.updateAmbientTitle(dt);
      return;
    }

    if (this.phase !== 'PLAYING') {
      return;
    }

    // Decaying visual feedback always ticks smoothly even during brief hitstop
    this.shakeTrauma = Math.max(0, this.shakeTrauma - dt * 2.6);
    this.damageVignette = Math.max(0, this.damageVignette - dt * 2.2);
    this.hitmarkerTimer = Math.max(0, this.hitmarkerTimer - dt);
    this.muzzleFlashTimer = Math.max(0, this.muzzleFlashTimer - dt);
    if (this.waveBannerTimer > 0) {
      this.waveBannerTimer -= dt;
      if (this.waveBannerTimer <= 0) {
        this.waveBannerText = null;
      }
    }

    if (this.hitstopTimer > 0) {
      this.hitstopTimer -= dt;
      return;
    }

    // Update world mouse coordinate from current camera
    this.mouseWorldX = this.camX + (this.mouseScreenX - this.viewW / 2) / this.camZoom;
    this.mouseWorldY = this.camY + (this.mouseScreenY - this.viewH / 2) / this.camZoom;

    this.updatePlayer(dt);
    this.updateWeapons(dt);
    this.updateSpawner(dt);
    this.updateEnemies(dt);
    this.updateProjectiles(dt);
    this.updatePickups(dt);
    this.updateParticles(dt);
    this.updateCamera(dt);

    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.combo = 1;
      }
    }

    // Check wave completion
    if (this.spawnQueue.length === 0 && this.enemies.length === 0 && this.phase === 'PLAYING') {
      this.waveClearDelay += dt;
      if (this.waveClearDelay >= 0.85) {
        this.openUpgradeChoice();
      }
    }

    this.hudSyncAccumulator += dt;
    if (this.hudSyncAccumulator >= 0.05) {
      this.hudSyncAccumulator = 0;
      this.emitHudSnapshot();
    }
  }

  private updateAmbientTitle(dt: number): void {
    // Gentle camera orbit + drone patrol for atmospheric title backdrop
    this.camX = ARENA_WIDTH / 2 + Math.cos(this.ambientTime * 0.18) * 140;
    this.camY = ARENA_HEIGHT / 2 + Math.sin(this.ambientTime * 0.14) * 85;
    for (const d of this.ambientDrones) {
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.x < 120 || d.x > ARENA_WIDTH - 120) d.vx *= -1;
      if (d.y < 120 || d.y > ARENA_HEIGHT - 120) d.vy *= -1;
      for (const obs of this.obstacles) {
        const res = circleRectResolve(d.x, d.y, 20, obs);
        if (res.hit) {
          d.x = res.x;
          d.y = res.y;
          if (Math.abs(res.nx) > 0.5) d.vx *= -1;
          if (Math.abs(res.ny) > 0.5) d.vy *= -1;
        }
      }
      d.angle = Math.atan2(d.vy, d.vx);
    }
  }

  private updatePlayer(dt: number): void {
    const p = this.player;
    p.hitFlash = Math.max(0, p.hitFlash - dt);
    p.invulnTimer = Math.max(0, p.invulnTimer - dt);
    p.dashCooldown = Math.max(0, p.dashCooldown - dt);
    p.overchargeTimer = Math.max(0, p.overchargeTimer - dt);
    p.recoilOffset = lerp(p.recoilOffset, 0, Math.min(1, dt * 16));
    p.squashX = lerp(p.squashX, 1, Math.min(1, dt * 14));
    p.squashY = lerp(p.squashY, 1, Math.min(1, dt * 14));

    this.dashBufferTimer = Math.max(0, this.dashBufferTimer - dt);

    let ix = 0;
    let iy = 0;
    if (this.heldKeys.has('KeyW') || this.heldKeys.has('ArrowUp')) iy -= 1;
    if (this.heldKeys.has('KeyS') || this.heldKeys.has('ArrowDown')) iy += 1;
    if (this.heldKeys.has('KeyA') || this.heldKeys.has('ArrowLeft')) ix -= 1;
    if (this.heldKeys.has('KeyD') || this.heldKeys.has('ArrowRight')) ix += 1;

    const len = Math.hypot(ix, iy);
    if (len > 0) {
      ix /= len;
      iy /= len;
    }

    // Buffered dash trigger
    if (this.dashBufferTimer > 0 && p.dashCooldown <= 0 && p.dashTimer <= 0) {
      this.dashBufferTimer = 0;
      const dirX = len > 0 ? ix : Math.cos(p.angle);
      const dirY = len > 0 ? iy : Math.sin(p.angle);
      p.dashDirX = dirX;
      p.dashDirY = dirY;
      p.dashTimer = 0.16;
      p.invulnTimer = Math.max(p.invulnTimer, 0.22);
      p.dashCooldown = p.dashMaxCooldown * this.modifiers.dashCooldownMult;
      p.squashX = 1.32;
      p.squashY = 0.72;
      this.sound.playDash();
      this.spawnBurstParticles(p.x, p.y, 10, '#38BDF8', 190, 0.28);
    }

    if (p.dashTimer > 0) {
      p.dashTimer -= dt;
      const dashSpeed = 880 * this.modifiers.moveSpeedMult;
      p.vx = p.dashDirX * dashSpeed;
      p.vy = p.dashDirY * dashSpeed;
      if (Math.random() < 0.75) {
        this.dashGhosts.push({ x: p.x, y: p.y, angle: p.angle, alpha: 0.55 });
      }
    } else {
      const overchargeSpeed = p.overchargeTimer > 0 ? 1.16 : 1;
      const maxSpeed = p.baseSpeed * this.modifiers.moveSpeedMult * overchargeSpeed;
      const targetVx = ix * maxSpeed;
      const targetVy = iy * maxSpeed;
      const accel = len > 0 ? 18 : 15;
      p.vx = lerp(p.vx, targetVx, Math.min(1, dt * accel));
      p.vy = lerp(p.vy, targetVy, Math.min(1, dt * accel));
    }

    p.x += p.vx * dt;
    p.y += p.vy * dt;

    // Arena boundary clamp
    p.x = clamp(p.x, p.radius + 18, ARENA_WIDTH - p.radius - 18);
    p.y = clamp(p.y, p.radius + 18, ARENA_HEIGHT - p.radius - 18);

    // Resolve cover collisions
    for (const obs of this.obstacles) {
      const res = circleRectResolve(p.x, p.y, p.radius, obs);
      if (res.hit) {
        p.x = res.x;
        p.y = res.y;
      }
    }

    // Aim toward mouse world position
    p.angle = Math.atan2(this.mouseWorldY - p.y, this.mouseWorldX - p.x);

    // Fade dash ghosts
    for (let i = this.dashGhosts.length - 1; i >= 0; i--) {
      this.dashGhosts[i].alpha -= dt * 2.8;
      if (this.dashGhosts[i].alpha <= 0) {
        this.dashGhosts.splice(i, 1);
      }
    }
  }

  private updateWeapons(dt: number): void {
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    const ws = this.weaponStates[this.activeWeapon];
    const spec = WEAPONS[this.activeWeapon];

    if (ws.isReloading) {
      ws.reloadTimer -= dt * (this.player.overchargeTimer > 0 ? 1.4 : 1);
      if (ws.reloadTimer <= 0) {
        ws.isReloading = false;
        ws.reloadTimer = 0;
        ws.ammo = ws.magSize;
        this.sound.playReload();
      }
      return;
    }

    if (this.mouseDown && this.fireCooldown <= 0) {
      if (ws.ammo <= 0) {
        this.startReload();
        return;
      }
      this.fireActiveWeapon(spec, ws);
    }
  }

  private fireActiveWeapon(spec: typeof WEAPONS[WeaponId], ws: WeaponState): void {
    const p = this.player;
    const overchargeRate = p.overchargeTimer > 0 ? 1.35 : 1;
    this.fireCooldown = spec.fireInterval / (this.modifiers.fireRateMult * overchargeRate);
    ws.ammo -= 1;

    const muzzleDist = 26;
    const mx = p.x + Math.cos(p.angle) * muzzleDist;
    const my = p.y + Math.sin(p.angle) * muzzleDist;

    this.muzzleFlashTimer = 0.055;
    this.muzzleFlashAngle = p.angle;
    this.muzzleFlashColor = spec.color;
    p.recoilOffset = spec.recoilKick;
    this.shakeTrauma = Math.min(1, this.shakeTrauma + spec.shake * 0.032);

    const dmg = spec.damage * this.modifiers.damageMult * (p.overchargeTimer > 0 ? 1.25 : 1);
    const pierce = spec.id === 'railgun' ? spec.pierce + this.modifiers.extraRailPierce : spec.pierce;
    const bounces = spec.id === 'railgun' ? 0 : this.modifiers.ricochetCount;

    for (let i = 0; i < spec.pellets; i++) {
      const spread = (Math.random() - 0.5) * spec.spreadRad;
      const angle = p.angle + spread;
      this.spawnProjectile({
        fromPlayer: true,
        x: mx,
        y: my,
        vx: Math.cos(angle) * spec.projectileSpeed,
        vy: Math.sin(angle) * spec.projectileSpeed,
        radius: spec.id === 'railgun' ? 5 : 3.4,
        damage: dmg,
        maxLife: spec.id === 'shotgun' ? 0.56 : 1.15,
        pierceLeft: pierce,
        bouncesLeft: bounces,
        knockback: spec.knockback,
        color: spec.color,
        tracerLength: spec.tracerLength,
        tracerWidth: spec.tracerWidth,
      });
      this.shotsFired += 1;
    }

    if (spec.id === 'railgun') {
      // Ionized rail beam scorch trail
      this.scorchMarks.push({
        x: mx,
        y: my,
        radius: 0,
        alpha: 0.7,
        kind: 'rail',
        angle: p.angle,
        length: 440,
      });
      if (this.scorchMarks.length > MAX_SCORCH_MARKS) this.scorchMarks.shift();
      this.spawnBurstParticles(mx, my, 12, '#38BDF8', 260, 0.32);
    } else {
      this.ejectShellCasing(p.x, p.y, p.angle, spec.id === 'shotgun');
      this.spawnBurstParticles(mx, my, spec.id === 'shotgun' ? 9 : 4, spec.color, 210, 0.18);
    }

    this.sound.playShoot(spec.id);

    if (ws.ammo <= 0) {
      this.startReload();
    }
  }

  private updateSpawner(dt: number): void {
    if (this.spawnQueue.length === 0) return;

    // Tick active spawn warning markers on floor
    for (let i = this.spawnQueue.length - 1; i >= 0; i--) {
      const item = this.spawnQueue[i];
      // Spawn up to 5 enemies concurrently at a steady cadence
      if (i >= this.spawnQueue.length - 5) {
        item.timer -= dt;
        if (item.timer <= 0) {
          this.spawnEnemy(item.type, item.x, item.y);
          this.spawnQueue.splice(i, 1);
        }
      }
    }
    this.spawnTickTimer += dt;
  }

  private updateEnemies(dt: number): void {
    const p = this.player;

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      e.hitFlash = Math.max(0, e.hitFlash - dt);
      e.squashX = lerp(e.squashX, 1, Math.min(1, dt * 12));
      e.squashY = lerp(e.squashY, 1, Math.min(1, dt * 12));

      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const dist = Math.hypot(dx, dy) || 1;
      const toPlayerAngle = Math.atan2(dy, dx);
      const hasLOS = this.hasLineOfSight(e.x, e.y, p.x, p.y);

      if (e.state === 'chase') {
        e.angle = toPlayerAngle;
        let desiredDist = 230;
        if (e.type === 'rusher' || e.type === 'bomber') desiredDist = 20;
        else if (e.type === 'sniper') desiredDist = 470;
        else if (e.type === 'heavy') desiredDist = 290;

        let moveX = 0;
        let moveY = 0;

        if (e.type === 'sniper' && dist < 310) {
          // Backpedal away from player
          moveX = -dx / dist;
          moveY = -dy / dist;
        } else if (dist > desiredDist || !hasLOS) {
          moveX = dx / dist;
          moveY = dy / dist;
        } else {
          // Strafe smoothly while keeping pressure
          const perpX = (-dy / dist) * e.strafeDir;
          const perpY = (dx / dist) * e.strafeDir;
          moveX = perpX * 0.75;
          moveY = perpY * 0.75;
        }

        // Gentle obstacle avoidance steering
        const lookAhead = e.radius + 36;
        const probeX = e.x + moveX * lookAhead;
        const probeY = e.y + moveY * lookAhead;
        for (const obs of this.obstacles) {
          if (
            probeX > obs.x - e.radius &&
            probeX < obs.x + obs.w + e.radius &&
            probeY > obs.y - e.radius &&
            probeY < obs.y + obs.h + e.radius
          ) {
            const ox = obs.x + obs.w / 2;
            const oy = obs.y + obs.h / 2;
            const awayX = e.x - ox;
            const awayY = e.y - oy;
            const awayLen = Math.hypot(awayX, awayY) || 1;
            moveX += (awayX / awayLen) * 1.1;
            moveY += (awayY / awayLen) * 1.1;
          }
        }

        // Separation from other enemies
        for (let j = 0; j < this.enemies.length; j++) {
          if (i === j) continue;
          const other = this.enemies[j];
          const sdx = e.x - other.x;
          const sdy = e.y - other.y;
          const minSep = e.radius + other.radius + 6;
          const d2 = sdx * sdx + sdy * sdy;
          if (d2 < minSep * minSep && d2 > 0.01) {
            const d = Math.sqrt(d2);
            const push = (minSep - d) / minSep;
            moveX += (sdx / d) * push * 1.4;
            moveY += (sdy / d) * push * 1.4;
          }
        }

        const mLen = Math.hypot(moveX, moveY);
        if (mLen > 0.01) {
          moveX /= mLen;
          moveY /= mLen;
        }
        e.vx = lerp(e.vx, moveX * e.speed, Math.min(1, dt * 8));
        e.vy = lerp(e.vy, moveY * e.speed, Math.min(1, dt * 8));

        e.stateTimer -= dt;
        const canTriggerAttack =
          e.type === 'bomber'
            ? dist < 84
            : e.type === 'rusher'
            ? dist < 240 && hasLOS
            : e.type === 'heavy'
            ? dist < 560 && e.stateTimer <= 0
            : dist < 640 && hasLOS && e.stateTimer <= 0;

        if (canTriggerAttack && e.stateTimer <= 0) {
          e.state = 'windup';
          e.aimAngle = toPlayerAngle;
          if (e.type === 'trooper') {
            e.windupDuration = 0.42;
            e.burstRemaining = 3;
          } else if (e.type === 'rusher') {
            e.windupDuration = 0.36;
          } else if (e.type === 'heavy') {
            e.windupDuration = 0.68;
          } else if (e.type === 'sniper') {
            e.windupDuration = 0.85;
          } else if (e.type === 'bomber') {
            e.windupDuration = 0.55;
          }
          e.stateTimer = e.windupDuration;
          e.squashX = 0.84;
          e.squashY = 1.18;
        }
      } else if (e.state === 'windup') {
        // Slow down and telegraph clearly
        e.vx = lerp(e.vx, 0, Math.min(1, dt * 12));
        e.vy = lerp(e.vy, 0, Math.min(1, dt * 12));
        if (e.type === 'sniper' && e.stateTimer > 0.22) {
          // Track player early, lock laser in final 0.22s so player can dodge!
          e.aimAngle = lerp(e.aimAngle, toPlayerAngle, Math.min(1, dt * 5));
        } else if (e.type !== 'sniper') {
          e.aimAngle = toPlayerAngle;
        }
        e.angle = e.aimAngle;
        e.stateTimer -= dt;

        if (e.stateTimer <= 0) {
          e.state = 'attack';
          if (e.type === 'rusher') {
            e.vx = Math.cos(e.aimAngle) * 640;
            e.vy = Math.sin(e.aimAngle) * 640;
            e.stateTimer = 0.28;
            e.squashX = 1.35;
            e.squashY = 0.72;
          } else if (e.type === 'trooper') {
            e.burstTimer = 0;
          } else if (e.type === 'heavy') {
            const bolts = this.difficulty === 'veteran' ? 10 : 8;
            for (let b = 0; b < bolts; b++) {
              const ba = e.aimAngle + (b / bolts) * Math.PI * 2;
              this.spawnProjectile({
                fromPlayer: false,
                x: e.x + Math.cos(ba) * (e.radius + 6),
                y: e.y + Math.sin(ba) * (e.radius + 6),
                vx: Math.cos(ba) * 350,
                vy: Math.sin(ba) * 350,
                radius: 5.5,
                damage: 16,
                maxLife: 2.2,
                pierceLeft: 0,
                bouncesLeft: 0,
                knockback: 120,
                color: '#F87171',
                tracerLength: 16,
                tracerWidth: 4,
              });
            }
            this.sound.playEnemyShoot(true);
            e.state = 'recover';
            e.stateTimer = 0.7;
          } else if (e.type === 'sniper') {
            this.spawnProjectile({
              fromPlayer: false,
              x: e.x + Math.cos(e.aimAngle) * (e.radius + 8),
              y: e.y + Math.sin(e.aimAngle) * (e.radius + 8),
              vx: Math.cos(e.aimAngle) * 1120,
              vy: Math.sin(e.aimAngle) * 1120,
              radius: 4.5,
              damage: 28,
              maxLife: 1.5,
              pierceLeft: 0,
              bouncesLeft: 0,
              knockback: 180,
              color: '#FB7185',
              tracerLength: 48,
              tracerWidth: 3.5,
            });
            this.sound.playEnemyShoot(true);
            e.state = 'recover';
            e.stateTimer = 0.85;
          } else if (e.type === 'bomber') {
            this.triggerExplosion(e.x, e.y, 138, 34, true);
            this.enemies.splice(i, 1);
            continue;
          }
        }
      } else if (e.state === 'attack') {
        if (e.type === 'rusher') {
          e.stateTimer -= dt;
          if (dist < e.radius + p.radius + 4) {
            this.damagePlayer(18, Math.cos(e.aimAngle) * 260, Math.sin(e.aimAngle) * 260);
            e.state = 'recover';
            e.stateTimer = 0.6;
            e.vx *= 0.2;
            e.vy *= 0.2;
          } else if (e.stateTimer <= 0) {
            e.state = 'recover';
            e.stateTimer = 0.55;
          }
        } else if (e.type === 'trooper') {
          e.vx = lerp(e.vx, 0, Math.min(1, dt * 10));
          e.vy = lerp(e.vy, 0, Math.min(1, dt * 10));
          e.burstTimer -= dt;
          if (e.burstTimer <= 0 && e.burstRemaining > 0) {
            const spread = (Math.random() - 0.5) * 0.1;
            const fa = toPlayerAngle + spread;
            this.spawnProjectile({
              fromPlayer: false,
              x: e.x + Math.cos(fa) * (e.radius + 6),
              y: e.y + Math.sin(fa) * (e.radius + 6),
              vx: Math.cos(fa) * 430,
              vy: Math.sin(fa) * 430,
              radius: 4.2,
              damage: 12,
              maxLife: 2.0,
              pierceLeft: 0,
              bouncesLeft: 0,
              knockback: 80,
              color: '#EF4444',
              tracerLength: 16,
              tracerWidth: 3,
            });
            this.sound.playEnemyShoot(false);
            e.burstRemaining -= 1;
            e.burstTimer = 0.14;
            if (e.burstRemaining <= 0) {
              e.state = 'recover';
              e.stateTimer = 0.65;
            }
          }
        }
      } else if (e.state === 'recover') {
        e.vx = lerp(e.vx, 0, Math.min(1, dt * 9));
        e.vy = lerp(e.vy, 0, Math.min(1, dt * 9));
        e.stateTimer -= dt;
        if (e.stateTimer <= 0) {
          e.state = 'chase';
          e.stateTimer = 0.9 + Math.random() * 0.9;
        }
      }

      e.x += e.vx * dt;
      e.y += e.vy * dt;
      e.x = clamp(e.x, e.radius + 18, ARENA_WIDTH - e.radius - 18);
      e.y = clamp(e.y, e.radius + 18, ARENA_HEIGHT - e.radius - 18);

      for (const obs of this.obstacles) {
        const res = circleRectResolve(e.x, e.y, e.radius, obs);
        if (res.hit) {
          e.x = res.x;
          e.y = res.y;
        }
      }

      // Contact damage for non-bomber melee bumps
      if (e.type !== 'bomber' && dist < e.radius + p.radius - 2) {
        const nx = (p.x - e.x) / dist;
        const ny = (p.y - e.y) / dist;
        this.damagePlayer(12, nx * 210, ny * 210);
      }
    }
  }

  private hasLineOfSight(x1: number, y1: number, x2: number, y2: number): boolean {
    for (const obs of this.obstacles) {
      if (segmentIntersectsRect(x1, y1, x2, y2, obs)) {
        return false;
      }
    }
    return true;
  }

  private updateProjectiles(dt: number): void {
    const p = this.player;

    for (let i = 0; i < MAX_PROJECTILES; i++) {
      const pr = this.projectiles[i];
      if (!pr.active) continue;

      pr.prevX = pr.x;
      pr.prevY = pr.y;
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      pr.life -= dt;

      if (pr.life <= 0) {
        pr.active = false;
        continue;
      }

      // Arena wall collision / ricochet
      let bounced = false;
      if (pr.x < 18 || pr.x > ARENA_WIDTH - 18) {
        if (pr.bouncesLeft > 0) {
          pr.vx *= -1;
          pr.x = clamp(pr.x, 19, ARENA_WIDTH - 19);
          pr.bouncesLeft -= 1;
          bounced = true;
        } else {
          this.spawnBurstParticles(pr.x, pr.y, 4, pr.color, 130, 0.16);
          pr.active = false;
          continue;
        }
      }
      if (pr.y < 18 || pr.y > ARENA_HEIGHT - 18) {
        if (pr.bouncesLeft > 0) {
          pr.vy *= -1;
          pr.y = clamp(pr.y, 19, ARENA_HEIGHT - 19);
          pr.bouncesLeft -= 1;
          bounced = true;
        } else {
          this.spawnBurstParticles(pr.x, pr.y, 4, pr.color, 130, 0.16);
          pr.active = false;
          continue;
        }
      }

      // Obstacle collision / ricochet
      let hitWall = false;
      for (const obs of this.obstacles) {
        const res = circleRectResolve(pr.x, pr.y, pr.radius, obs);
        if (res.hit) {
          if (pr.bouncesLeft > 0) {
            pr.x = res.x;
            pr.y = res.y;
            if (Math.abs(res.nx) > 0.5) pr.vx *= -1;
            if (Math.abs(res.ny) > 0.5) pr.vy *= -1;
            pr.bouncesLeft -= 1;
            bounced = true;
            this.spawnBurstParticles(pr.x, pr.y, 4, '#CBD5E1', 110, 0.14);
          } else {
            this.spawnBurstParticles(pr.x, pr.y, 5, pr.color, 150, 0.18);
            pr.active = false;
            hitWall = true;
          }
          break;
        }
      }
      if (hitWall) continue;
      if (bounced) {
        pr.hitEnemyIds.length = 0;
      }

      if (pr.fromPlayer) {
        // Check enemy hits using sub-stepped point distance to segment for fast railgun slugs
        for (let ei = this.enemies.length - 1; ei >= 0; ei--) {
          const e = this.enemies[ei];
          if (pr.hitEnemyIds.includes(e.id)) continue;

          if (this.segmentCircleHit(pr.prevX, pr.prevY, pr.x, pr.y, e.x, e.y, e.radius + pr.radius)) {
            pr.hitEnemyIds.push(e.id);
            this.shotsHit += 1;
            const len = Math.hypot(pr.vx, pr.vy) || 1;
            const kx = (pr.vx / len) * pr.knockback;
            const ky = (pr.vy / len) * pr.knockback;
            this.damageEnemy(ei, pr.damage, kx, ky, pr.color);

            if (pr.pierceLeft > 0) {
              pr.pierceLeft -= 1;
            } else {
              pr.active = false;
              break;
            }
          }
        }
      } else {
        // Enemy projectile vs player
        if (this.segmentCircleHit(pr.prevX, pr.prevY, pr.x, pr.y, p.x, p.y, p.radius + pr.radius - 2)) {
          const len = Math.hypot(pr.vx, pr.vy) || 1;
          this.damagePlayer(pr.damage, (pr.vx / len) * pr.knockback, (pr.vy / len) * pr.knockback);
          this.spawnBurstParticles(pr.x, pr.y, 6, pr.color, 160, 0.22);
          pr.active = false;
        }
      }
    }
  }

  private segmentCircleHit(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    cx: number,
    cy: number,
    r: number
  ): boolean {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) return distSq(x1, y1, cx, cy) <= r * r;
    const t = clamp(((cx - x1) * dx + (cy - y1) * dy) / l2, 0, 1);
    const px = x1 + t * dx;
    const py = y1 + t * dy;
    return distSq(px, py, cx, cy) <= r * r;
  }

  private damageEnemy(
    index: number,
    damage: number,
    kx: number,
    ky: number,
    color: string
  ): void {
    const e = this.enemies[index];
    if (!e) return;

    e.hp -= damage;
    e.hitFlash = 0.085;
    e.squashX = 1.18;
    e.squashY = 0.84;
    const massFactor = e.type === 'heavy' ? 0.35 : 1;
    e.vx += kx * massFactor;
    e.vy += ky * massFactor;

    this.hitmarkerTimer = 0.11;
    this.hitmarkerCrit = damage >= 70;
    this.sound.playHitmarker(this.hitmarkerCrit);
    this.spawnBurstParticles(e.x, e.y, 6, color, 180, 0.22);

    if (e.hp <= 0) {
      const dead = this.enemies[index];
      this.enemies.splice(index, 1);
      this.onEnemyKilled(dead);
    }
  }

  private onEnemyKilled(e: Enemy): void {
    this.kills += 1;
    this.combo = Math.min(12, +(this.combo + 0.25).toFixed(2));
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.comboTimer = this.comboDuration;

    const gained = Math.round(e.scoreValue * this.combo);
    this.score += gained;
    if (this.score > this.bestScore) {
      this.bestScore = this.score;
      try {
        localStorage.setItem(BEST_SCORE_STORAGE_KEY, String(this.bestScore));
      } catch {
        // Ignore storage restrictions
      }
    }

    if (this.modifiers.vampirismOnKill > 0) {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.modifiers.vampirismOnKill);
    }

    const isHeavy = e.type === 'heavy' || e.type === 'bomber';
    this.sound.playKill(isHeavy);
    this.hitstopTimer = Math.max(this.hitstopTimer, isHeavy ? 0.048 : 0.025);
    this.shakeTrauma = Math.min(1, this.shakeTrauma + (isHeavy ? 0.36 : 0.16));

    this.spawnBurstParticles(e.x, e.y, isHeavy ? 24 : 14, isHeavy ? '#F97316' : '#EF4444', 280, 0.42);
    this.spawnRingParticle(e.x, e.y, e.radius * 2.2, '#F59E0B');
    this.spawnFloatingText(e.x, e.y - 12, `+${gained}`, '#FBBF24', isHeavy ? 1.18 : 1);

    this.scorchMarks.push({
      x: e.x,
      y: e.y,
      radius: e.radius * 1.15,
      alpha: 0.42,
      kind: 'blast',
    });
    if (this.scorchMarks.length > MAX_SCORCH_MARKS) this.scorchMarks.shift();

    // Bomber detonates on death, damaging nearby enemies
    if (e.type === 'bomber') {
      this.triggerExplosion(e.x, e.y, 115, 75, false);
    }

    // Pickup drop roll
    const dropRoll = Math.random();
    if (e.type === 'heavy' || dropRoll < 0.18) {
      let kind: PickupKind = 'medkit';
      if (this.player.hp > this.player.maxHp * 0.75 && Math.random() < 0.65) {
        kind = Math.random() < 0.55 ? 'armor' : 'overcharge';
      } else if (Math.random() < 0.35) {
        kind = 'armor';
      }
      this.pickups.push({
        id: this.nextEntityId++,
        kind,
        x: e.x,
        y: e.y,
        life: 14,
        bobPhase: Math.random() * Math.PI * 2,
      });
    }
  }

  private triggerExplosion(
    x: number,
    y: number,
    radius: number,
    damage: number,
    hitsPlayer: boolean
  ): void {
    this.sound.playKill(true);
    this.shakeTrauma = Math.min(1, this.shakeTrauma + 0.5);
    this.hitstopTimer = Math.max(this.hitstopTimer, 0.045);
    this.spawnBurstParticles(x, y, 30, '#FB923C', 360, 0.48);
    this.spawnRingParticle(x, y, radius, '#EF4444');
    this.scorchMarks.push({ x, y, radius: radius * 0.62, alpha: 0.55, kind: 'blast' });
    if (this.scorchMarks.length > MAX_SCORCH_MARKS) this.scorchMarks.shift();

    if (hitsPlayer) {
      const d = Math.hypot(this.player.x - x, this.player.y - y);
      if (d < radius + this.player.radius) {
        const nx = (this.player.x - x) / (d || 1);
        const ny = (this.player.y - y) / (d || 1);
        this.damagePlayer(damage, nx * 320, ny * 320);
      }
    }

    // Also blast enemies within radius
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const other = this.enemies[i];
      const d = Math.hypot(other.x - x, other.y - y);
      if (d < radius + other.radius) {
        const nx = (other.x - x) / (d || 1);
        const ny = (other.y - y) / (d || 1);
        this.damageEnemy(i, damage * 0.85, nx * 240, ny * 240, '#FB923C');
      }
    }
  }

  private damagePlayer(rawDamage: number, kx: number, ky: number): void {
    const p = this.player;
    if (p.invulnTimer > 0 || this.phase !== 'PLAYING') return;

    const scaled = this.difficulty === 'veteran' ? Math.round(rawDamage * 1.2) : rawDamage;
    let remaining = scaled;
    if (p.armor > 0) {
      const absorbed = Math.min(p.armor, Math.ceil(remaining * 0.7));
      p.armor -= absorbed;
      remaining -= absorbed;
    }
    p.hp = Math.max(0, p.hp - remaining);
    p.invulnTimer = 0.48;
    p.hitFlash = 0.16;
    p.vx += kx;
    p.vy += ky;
    this.damageVignette = 0.85;
    this.shakeTrauma = Math.min(1, this.shakeTrauma + 0.45);
    this.hitstopTimer = Math.max(this.hitstopTimer, 0.04);
    this.combo = 1;
    this.comboTimer = 0;

    this.sound.playPlayerHit();
    this.spawnBurstParticles(p.x, p.y, 12, '#EF4444', 220, 0.28);

    if (p.hp <= 0) {
      this.phase = 'GAME_OVER';
      this.heldKeys.clear();
      this.mouseDown = false;
      this.emitHudSnapshot();
    }
  }

  private updatePickups(dt: number): void {
    const p = this.player;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const item = this.pickups[i];
      item.life -= dt;
      item.bobPhase += dt * 4.2;
      if (item.life <= 0) {
        this.pickups.splice(i, 1);
        continue;
      }

      const d = Math.hypot(p.x - item.x, p.y - item.y);
      // Slight magnetic pull when nearby
      if (d < 110 && d > 1) {
        item.x += ((p.x - item.x) / d) * 240 * dt;
        item.y += ((p.y - item.y) / d) * 240 * dt;
      }

      if (d < p.radius + 16) {
        if (item.kind === 'medkit') {
          const heal = 28;
          p.hp = Math.min(p.maxHp, p.hp + heal);
          this.spawnFloatingText(p.x, p.y - 20, `+${heal} HP`, '#10B981', 1.05);
        } else if (item.kind === 'armor') {
          const gain = 25;
          p.armor = Math.min(p.maxArmor, p.armor + gain);
          this.spawnFloatingText(p.x, p.y - 20, `+${gain} Броня`, '#38BDF8', 1.05);
        } else {
          p.overchargeTimer = 8.0;
          this.spawnFloatingText(p.x, p.y - 20, 'ПЕРЕГРУЗКА 8с', '#F59E0B', 1.1);
        }
        this.sound.playPickup();
        this.pickups.splice(i, 1);
      }
    }
  }

  private updateParticles(dt: number): void {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const pt = this.particles[i];
      if (!pt.active) continue;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      const damp = Math.pow(pt.drag, dt * 60);
      pt.vx *= damp;
      pt.vy *= damp;
      pt.life -= dt;
      if (pt.life <= 0) pt.active = false;
    }

    for (let i = 0; i < MAX_CASINGS; i++) {
      const c = this.casings[i];
      if (!c.active) continue;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      const damp = Math.pow(0.86, dt * 60);
      c.vx *= damp;
      c.vy *= damp;
      c.angle += c.vAngle * dt;
      c.vAngle *= damp;
      c.life -= dt;
      if (c.life <= 0) c.active = false;
    }

    for (let i = 0; i < MAX_FLOATING_TEXTS; i++) {
      const ft = this.floatingTexts[i];
      if (!ft.active) continue;
      ft.y += ft.vy * dt;
      ft.life -= dt;
      if (ft.life <= 0) ft.active = false;
    }
  }

  private updateCamera(dt: number): void {
    const p = this.player;
    const lookAheadX = clamp((this.mouseWorldX - p.x) * 0.18, -140, 140);
    const lookAheadY = clamp((this.mouseWorldY - p.y) * 0.18, -100, 100);
    const targetX = p.x + lookAheadX;
    const targetY = p.y + lookAheadY;

    this.camX = lerp(this.camX, targetX, Math.min(1, dt * 8.5));
    this.camY = lerp(this.camY, targetY, Math.min(1, dt * 8.5));

    // Keep camera smoothly bounded inside arena padding
    const halfViewW = this.viewW / (2 * this.camZoom);
    const halfViewH = this.viewH / (2 * this.camZoom);
    if (halfViewW * 2 < ARENA_WIDTH + 120) {
      this.camX = clamp(this.camX, halfViewW - 60, ARENA_WIDTH - halfViewW + 60);
    } else {
      this.camX = ARENA_WIDTH / 2;
    }
    if (halfViewH * 2 < ARENA_HEIGHT + 120) {
      this.camY = clamp(this.camY, halfViewH - 60, ARENA_HEIGHT - halfViewH + 60);
    } else {
      this.camY = ARENA_HEIGHT / 2;
    }
  }

  private openUpgradeChoice(): void {
    this.sound.playWaveClear();
    const shuffled = [...UPGRADE_POOL].sort(() => Math.random() - 0.5);
    this.upgradeChoices = shuffled.slice(0, 3);
    this.phase = 'UPGRADE';
    this.heldKeys.clear();
    this.mouseDown = false;
    this.emitHudSnapshot();
  }

  // Pooling helpers
  private spawnProjectile(cfg: {
    fromPlayer: boolean;
    x: number;
    y: number;
    vx: number;
    vy: number;
    radius: number;
    damage: number;
    maxLife: number;
    pierceLeft: number;
    bouncesLeft: number;
    knockback: number;
    color: string;
    tracerLength: number;
    tracerWidth: number;
  }): void {
    for (let i = 0; i < MAX_PROJECTILES; i++) {
      const pr = this.projectiles[i];
      if (!pr.active) {
        pr.active = true;
        pr.fromPlayer = cfg.fromPlayer;
        pr.x = cfg.x;
        pr.y = cfg.y;
        pr.prevX = cfg.x;
        pr.prevY = cfg.y;
        pr.vx = cfg.vx;
        pr.vy = cfg.vy;
        pr.radius = cfg.radius;
        pr.damage = cfg.damage;
        pr.life = cfg.maxLife;
        pr.maxLife = cfg.maxLife;
        pr.pierceLeft = cfg.pierceLeft;
        pr.bouncesLeft = cfg.bouncesLeft;
        pr.knockback = cfg.knockback;
        pr.color = cfg.color;
        pr.tracerLength = cfg.tracerLength;
        pr.tracerWidth = cfg.tracerWidth;
        pr.hitEnemyIds.length = 0;
        return;
      }
    }
  }

  private spawnBurstParticles(
    x: number,
    y: number,
    count: number,
    color: string,
    speed: number,
    life: number
  ): void {
    let spawned = 0;
    for (let i = 0; i < MAX_PARTICLES && spawned < count; i++) {
      const pt = this.particles[i];
      if (!pt.active) {
        const a = Math.random() * Math.PI * 2;
        const s = speed * (0.35 + Math.random() * 0.75);
        pt.active = true;
        pt.x = x;
        pt.y = y;
        pt.vx = Math.cos(a) * s;
        pt.vy = Math.sin(a) * s;
        pt.size = 2 + Math.random() * 3.2;
        pt.life = life * (0.65 + Math.random() * 0.5);
        pt.maxLife = pt.life;
        pt.color = color;
        pt.drag = 0.89;
        pt.kind = 'spark';
        spawned++;
      }
    }
  }

  private spawnRingParticle(x: number, y: number, radius: number, color: string): void {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const pt = this.particles[i];
      if (!pt.active) {
        pt.active = true;
        pt.x = x;
        pt.y = y;
        pt.vx = 0;
        pt.vy = 0;
        pt.size = radius;
        pt.life = 0.28;
        pt.maxLife = 0.28;
        pt.color = color;
        pt.drag = 1;
        pt.kind = 'ring';
        return;
      }
    }
  }

  private ejectShellCasing(x: number, y: number, aimAngle: number, isShotgun: boolean): void {
    for (let i = 0; i < MAX_CASINGS; i++) {
      const c = this.casings[i];
      if (!c.active) {
        const ejectAngle = aimAngle + Math.PI / 2 + (Math.random() - 0.5) * 0.5;
        const spd = 110 + Math.random() * 90;
        c.active = true;
        c.x = x + Math.cos(aimAngle) * 10;
        c.y = y + Math.sin(aimAngle) * 10;
        c.vx = Math.cos(ejectAngle) * spd;
        c.vy = Math.sin(ejectAngle) * spd;
        c.angle = Math.random() * Math.PI;
        c.vAngle = (Math.random() - 0.5) * 22;
        c.life = 3.2;
        c.color = isShotgun ? '#DC2626' : '#D97706';
        c.length = isShotgun ? 8 : 6;
        c.width = isShotgun ? 3.5 : 2.2;
        return;
      }
    }
  }

  private spawnFloatingText(x: number, y: number, text: string, color: string, scale = 1): void {
    for (let i = 0; i < MAX_FLOATING_TEXTS; i++) {
      const ft = this.floatingTexts[i];
      if (!ft.active) {
        ft.active = true;
        ft.x = x;
        ft.y = y;
        ft.vy = -42;
        ft.text = text;
        ft.color = color;
        ft.life = 0.78;
        ft.maxLife = 0.78;
        ft.scale = scale;
        return;
      }
    }
  }

  private emitHudSnapshot(): void {
    const p = this.player;
    this.onHudUpdate({
      phase: this.phase,
      difficulty: this.difficulty,
      hp: Math.ceil(p.hp),
      maxHp: p.maxHp,
      armor: Math.ceil(p.armor),
      maxArmor: p.maxArmor,
      score: this.score,
      bestScore: this.bestScore,
      wave: this.wave,
      enemiesRemaining: this.enemies.length + this.spawnQueue.length,
      combo: this.combo,
      comboTimerRatio: this.comboTimer > 0 ? this.comboTimer / this.comboDuration : 0,
      dashCooldownRatio: clamp(
        1 - p.dashCooldown / (p.dashMaxCooldown * this.modifiers.dashCooldownMult),
        0,
        1
      ),
      overchargeTimer: p.overchargeTimer,
      activeWeapon: this.activeWeapon,
      weapons: {
        rifle: { ...this.weaponStates.rifle },
        shotgun: { ...this.weaponStates.shotgun },
        railgun: { ...this.weaponStates.railgun },
      },
      kills: this.kills,
      shotsFired: this.shotsFired,
      shotsHit: this.shotsHit,
      maxCombo: this.maxCombo,
      upgradeChoices: this.upgradeChoices,
      acquiredUpgradeIds: [...this.acquiredUpgradeIds],
      waveBannerText: this.waveBannerText,
      muted: this.sound.isMuted(),
    });
  }

  // ==================== RENDERER ====================
  private render(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    // Outer void fill
    ctx.fillStyle = COLORS.bgDeep;
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    // Camera transform with decaying trauma shake
    const shakePow = this.shakeTrauma * this.shakeTrauma * 14;
    const shakeX = (Math.random() * 2 - 1) * shakePow;
    const shakeY = (Math.random() * 2 - 1) * shakePow;

    ctx.save();
    ctx.translate(this.viewW / 2 + shakeX, this.viewH / 2 + shakeY);
    ctx.scale(this.camZoom, this.camZoom);
    ctx.translate(-this.camX, -this.camY);

    this.renderArenaFloor(ctx);
    this.renderScorchMarks(ctx);
    this.renderCasings(ctx);
    this.renderSpawnTelegraphs(ctx);

    if (this.phase === 'TITLE_MENU') {
      this.renderAmbientTitleScene(ctx);
    } else {
      this.renderPickups(ctx);
      this.renderDashGhosts(ctx);
      this.renderObstacles(ctx);
      this.renderEnemyTelegraphs(ctx);
      this.renderEnemies(ctx);
      this.renderPlayer(ctx);
      this.renderProjectiles(ctx);
      this.renderParticles(ctx);
      this.renderFloatingTexts(ctx);
    }

    ctx.restore(); // End world space

    // Screen-space damage vignette
    if (this.damageVignette > 0.01 && this.phase === 'PLAYING') {
      const grad = ctx.createRadialGradient(
        this.viewW / 2,
        this.viewH / 2,
        this.viewH * 0.28,
        this.viewW / 2,
        this.viewH / 2,
        this.viewW * 0.65
      );
      grad.addColorStop(0, 'rgba(239, 68, 68, 0)');
      grad.addColorStop(1, `rgba(220, 38, 38, ${this.damageVignette * 0.45})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, this.viewW, this.viewH);
    }

    // Subtle atmospheric radial vignette on Title Screen
    if (this.phase === 'TITLE_MENU') {
      const grad = ctx.createRadialGradient(
        this.viewW * 0.55,
        this.viewH * 0.5,
        this.viewH * 0.15,
        this.viewW * 0.5,
        this.viewH * 0.5,
        this.viewW * 0.72
      );
      grad.addColorStop(0, 'rgba(11, 15, 21, 0.18)');
      grad.addColorStop(1, 'rgba(7, 10, 15, 0.86)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, this.viewW, this.viewH);
    }

    // Custom tactical reticle during active play
    if (this.phase === 'PLAYING') {
      this.renderReticle(ctx);
    }

    ctx.restore();
  }

  private renderArenaFloor(ctx: CanvasRenderingContext2D): void {
    // Base tactical concrete
    ctx.fillStyle = COLORS.arenaFloor;
    ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);

    // Subtle tile grid (80px)
    ctx.strokeStyle = COLORS.gridLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 80; x < ARENA_WIDTH; x += 80) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, ARENA_HEIGHT);
    }
    for (let y = 80; y < ARENA_HEIGHT; y += 80) {
      ctx.moveTo(0, y);
      ctx.lineTo(ARENA_WIDTH, y);
    }
    ctx.stroke();

    // Center courtyard tactical ring
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.08)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ARENA_WIDTH / 2, ARENA_HEIGHT / 2, 130, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ARENA_WIDTH / 2, ARENA_HEIGHT / 2, 230, 0, Math.PI * 2);
    ctx.stroke();

    // Arena steel perimeter frame
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 18;
    ctx.strokeRect(9, 9, ARENA_WIDTH - 18, ARENA_HEIGHT - 18);
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(18, 18, ARENA_WIDTH - 36, ARENA_HEIGHT - 36);
  }

  private renderScorchMarks(ctx: CanvasRenderingContext2D): void {
    for (const s of this.scorchMarks) {
      ctx.save();
      if (s.kind === 'rail' && s.angle !== undefined && s.length) {
        ctx.translate(s.x, s.y);
        ctx.rotate(s.angle);
        const grad = ctx.createLinearGradient(0, 0, s.length, 0);
        grad.addColorStop(0, 'rgba(56, 189, 248, 0.32)');
        grad.addColorStop(1, 'rgba(56, 189, 248, 0)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(s.length, 0);
        ctx.stroke();
      } else {
        ctx.fillStyle = `rgba(2, 6, 12, ${s.alpha})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private renderCasings(ctx: CanvasRenderingContext2D): void {
    for (let i = 0; i < MAX_CASINGS; i++) {
      const c = this.casings[i];
      if (!c.active) continue;
      ctx.save();
      ctx.globalAlpha = clamp(c.life, 0, 1) * 0.85;
      ctx.translate(c.x, c.y);
      ctx.rotate(c.angle);
      ctx.fillStyle = c.color;
      ctx.fillRect(-c.length / 2, -c.width / 2, c.length, c.width);
      ctx.restore();
    }
  }

  private renderSpawnTelegraphs(ctx: CanvasRenderingContext2D): void {
    const activeCount = Math.min(5, this.spawnQueue.length);
    for (let i = 0; i < activeCount; i++) {
      const sp = this.spawnQueue[this.spawnQueue.length - 1 - i];
      const progress = clamp(1 - sp.timer / 0.75, 0, 1);
      ctx.save();
      ctx.strokeStyle = `rgba(239, 68, 68, ${0.35 + progress * 0.55})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 26 * (1 - progress * 0.45), 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sp.x - 10, sp.y);
      ctx.lineTo(sp.x + 10, sp.y);
      ctx.moveTo(sp.x, sp.y - 10);
      ctx.lineTo(sp.x, sp.y + 10);
      ctx.stroke();
      ctx.restore();
    }
  }

  private renderAmbientTitleScene(ctx: CanvasRenderingContext2D): void {
    this.renderObstacles(ctx);
    // Sweeping tactical searchlight cones + patrol silhouettes
    for (const d of this.ambientDrones) {
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(d.angle);

      const cone = ctx.createLinearGradient(0, 0, 210, 0);
      cone.addColorStop(0, 'rgba(245, 158, 11, 0.16)');
      cone.addColorStop(1, 'rgba(245, 158, 11, 0)');
      ctx.fillStyle = cone;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(210, -68);
      ctx.lineTo(210, 68);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#334155';
      ctx.beginPath();
      ctx.arc(0, 0, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#F59E0B';
      ctx.fillRect(6, -3, 10, 6);
      ctx.restore();
    }
  }

  private renderObstacles(ctx: CanvasRenderingContext2D): void {
    for (const obs of this.obstacles) {
      // Directional shadow
      ctx.fillStyle = COLORS.obstacleShadow;
      ctx.fillRect(obs.x + 8, obs.y + 10, obs.w, obs.h);

      // Main armored block
      ctx.fillStyle = COLORS.obstacleTop;
      ctx.fillRect(obs.x, obs.y, obs.w, obs.h);

      // Crisp metallic bevel
      ctx.strokeStyle = COLORS.obstacleBevel;
      ctx.lineWidth = 2;
      ctx.strokeRect(obs.x + 1, obs.y + 1, obs.w - 2, obs.h - 2);

      // Subtle corner rivets / hazard trim for pillars
      if (obs.kind === 'pillar') {
        ctx.fillStyle = 'rgba(245, 158, 11, 0.45)';
        ctx.fillRect(obs.x + 6, obs.y + 6, 12, 3);
        ctx.fillRect(obs.x + obs.w - 18, obs.y + obs.h - 9, 12, 3);
      } else {
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(obs.x + 8, obs.y + 8, obs.w - 16, obs.h - 16);
      }
    }
  }

  private renderPickups(ctx: CanvasRenderingContext2D): void {
    for (const item of this.pickups) {
      const bob = Math.sin(item.bobPhase) * 3;
      const blink = item.life < 3.5 && Math.floor(item.life * 8) % 2 === 0 ? 0.35 : 1;
      ctx.save();
      ctx.globalAlpha = blink;
      ctx.translate(item.x, item.y + bob);

      const color =
        item.kind === 'medkit'
          ? '#10B981'
          : item.kind === 'armor'
          ? '#38BDF8'
          : '#F59E0B';

      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-12, -12, 24, 24, 5);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = color;
      if (item.kind === 'medkit') {
        ctx.fillRect(-2.5, -7, 5, 14);
        ctx.fillRect(-7, -2.5, 14, 5);
      } else if (item.kind === 'armor') {
        ctx.beginPath();
        ctx.moveTo(0, -8);
        ctx.lineTo(7, -4);
        ctx.lineTo(5, 5);
        ctx.lineTo(0, 8);
        ctx.lineTo(-5, 5);
        ctx.lineTo(-7, -4);
        ctx.closePath();
        ctx.fill();
      } else {
        // Bolt icon
        ctx.beginPath();
        ctx.moveTo(2, -8);
        ctx.lineTo(-5, 1);
        ctx.lineTo(0, 1);
        ctx.lineTo(-2, 8);
        ctx.lineTo(5, -1);
        ctx.lineTo(0, -1);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private renderDashGhosts(ctx: CanvasRenderingContext2D): void {
    for (const g of this.dashGhosts) {
      ctx.save();
      ctx.globalAlpha = g.alpha * 0.55;
      ctx.translate(g.x, g.y);
      ctx.rotate(g.angle);
      ctx.fillStyle = COLORS.playerDash;
      ctx.beginPath();
      ctx.arc(0, 0, this.player.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private renderEnemyTelegraphs(ctx: CanvasRenderingContext2D): void {
    for (const e of this.enemies) {
      if (e.state !== 'windup') continue;
      const t = 1 - e.stateTimer / e.windupDuration;

      ctx.save();
      if (e.type === 'sniper' || e.type === 'trooper') {
        const len = e.type === 'sniper' ? 900 : 280;
        const flicker = e.type === 'sniper' && t > 0.72 ? 0.9 : 0.35 + t * 0.4;
        ctx.strokeStyle = `rgba(239, 68, 68, ${flicker})`;
        ctx.lineWidth = e.type === 'sniper' ? 1.5 + t * 1.5 : 1.5;
        ctx.setLineDash(e.type === 'sniper' ? [] : [6, 6]);
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.lineTo(e.x + Math.cos(e.aimAngle) * len, e.y + Math.sin(e.aimAngle) * len);
        ctx.stroke();
      } else if (e.type === 'rusher') {
        ctx.strokeStyle = `rgba(245, 158, 11, ${0.4 + t * 0.5})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.radius + 12 * (1 - t) + 4, 0, Math.PI * 2);
        ctx.stroke();
      } else if (e.type === 'heavy') {
        ctx.strokeStyle = `rgba(248, 113, 113, ${0.3 + t * 0.55})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.radius + 14 * t, 0, Math.PI * 2);
        ctx.stroke();
      } else if (e.type === 'bomber') {
        ctx.fillStyle = `rgba(239, 68, 68, ${0.12 + t * 0.16})`;
        ctx.strokeStyle = `rgba(251, 146, 60, ${0.5 + t * 0.45})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(e.x, e.y, 138, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private renderEnemies(ctx: CanvasRenderingContext2D): void {
    for (const e of this.enemies) {
      ctx.save();
      ctx.translate(e.x, e.y);

      // Ground shadow
      ctx.fillStyle = 'rgba(2, 6, 12, 0.45)';
      ctx.beginPath();
      ctx.ellipse(2, 6, e.radius * 0.95, e.radius * 0.72, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.rotate(e.angle);
      ctx.scale(e.squashX, e.squashY);

      const isFlashing = e.hitFlash > 0;
      if (e.type === 'trooper') {
        ctx.fillStyle = isFlashing ? '#FFFFFF' : '#334155';
        ctx.strokeStyle = '#EF4444';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, e.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // Barrel & crimson visor
        ctx.fillStyle = '#94A3B8';
        ctx.fillRect(8, -3, 14, 6);
        ctx.fillStyle = isFlashing ? '#FFFFFF' : '#EF4444';
        ctx.fillRect(4, -7, 5, 14);
      } else if (e.type === 'rusher') {
        // Sleek triangular interceptor
        ctx.fillStyle = isFlashing ? '#FFFFFF' : '#991B1B';
        ctx.strokeStyle = '#FCA5A5';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(e.radius + 5, 0);
        ctx.lineTo(-e.radius, -e.radius * 0.9);
        ctx.lineTo(-e.radius * 0.5, 0);
        ctx.lineTo(-e.radius, e.radius * 0.9);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (e.type === 'heavy') {
        // Armored octagon juggernaut
        ctx.fillStyle = isFlashing ? '#FFFFFF' : '#1E293B';
        ctx.strokeStyle = '#F97316';
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const px = Math.cos(a) * e.radius;
          const py = Math.sin(a) * e.radius;
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = isFlashing ? '#FFFFFF' : '#F97316';
        ctx.beginPath();
        ctx.arc(0, 0, 8, 0, Math.PI * 2);
        ctx.fill();
      } else if (e.type === 'sniper') {
        ctx.fillStyle = isFlashing ? '#FFFFFF' : '#1E1B4B';
        ctx.strokeStyle = '#FB7185';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(-13, -13, 26, 26, 5);
        ctx.fill();
        ctx.stroke();
        // Long sniper barrel
        ctx.fillStyle = '#E2E8F0';
        ctx.fillRect(8, -2, 22, 4);
      } else if (e.type === 'bomber') {
        const pulse = e.state === 'windup' && Math.floor(e.stateTimer * 18) % 2 === 0;
        ctx.fillStyle = isFlashing || pulse ? '#FFFFFF' : '#7C2D12';
        ctx.strokeStyle = '#FB923C';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(0, 0, e.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = pulse ? '#EF4444' : '#FBBF24';
        ctx.beginPath();
        ctx.arc(0, 0, 6, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();

      // Compact health bar if damaged
      if (e.hp < e.maxHp) {
        const barW = e.radius * 2;
        const ratio = clamp(e.hp / e.maxHp, 0, 1);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.fillRect(-barW / 2, -e.radius - 11, barW, 4);
        ctx.fillStyle = '#EF4444';
        ctx.fillRect(-barW / 2, -e.radius - 11, barW * ratio, 4);
      }

      ctx.restore();
    }
  }

  private renderPlayer(ctx: CanvasRenderingContext2D): void {
    const p = this.player;
    const spec = WEAPONS[this.activeWeapon];

    ctx.save();
    ctx.translate(p.x, p.y);

    // Shadow
    ctx.fillStyle = 'rgba(2, 6, 12, 0.5)';
    ctx.beginPath();
    ctx.ellipse(2, 7, p.radius, p.radius * 0.78, 0, 0, Math.PI * 2);
    ctx.fill();

    // Overcharge aura
    if (p.overchargeTimer > 0) {
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.45)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, p.radius + 7 + Math.sin(this.ambientTime * 14) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.rotate(p.angle);
    ctx.scale(p.squashX, p.squashY);

    const flash = p.hitFlash > 0;
    const invulnBlink = p.invulnTimer > 0 && p.dashTimer <= 0 && Math.floor(p.invulnTimer * 20) % 2 === 0;
    if (invulnBlink) ctx.globalAlpha = 0.55;

    // Weapon barrel silhouette shifted by recoil
    const rx = -p.recoilOffset;
    ctx.fillStyle = '#475569';
    if (this.activeWeapon === 'rifle') {
      ctx.fillRect(8 + rx, -3.5, 21, 7);
      ctx.fillStyle = '#F59E0B';
      ctx.fillRect(14 + rx, -2, 6, 4);
    } else if (this.activeWeapon === 'shotgun') {
      ctx.fillRect(6 + rx, -5, 19, 10);
      ctx.fillStyle = '#FB923C';
      ctx.fillRect(10 + rx, -3.5, 11, 7);
    } else {
      ctx.fillStyle = '#1E293B';
      ctx.fillRect(6 + rx, -5, 26, 10);
      ctx.fillStyle = '#38BDF8';
      ctx.fillRect(11 + rx, -2, 19, 4);
    }

    // Operator shoulders / torso
    ctx.fillStyle = flash ? '#EF4444' : COLORS.playerBody;
    ctx.strokeStyle = spec.color;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Tactical helmet visor
    ctx.fillStyle = '#0F172A';
    ctx.beginPath();
    ctx.arc(4, 0, 8, -0.95, 0.95);
    ctx.fill();
    ctx.fillStyle = spec.color;
    ctx.fillRect(7, -5, 4, 10);

    // Muzzle flash
    if (this.muzzleFlashTimer > 0) {
      ctx.fillStyle = this.muzzleFlashColor;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(28, 0);
      ctx.lineTo(42, -7);
      ctx.lineTo(36, 0);
      ctx.lineTo(42, 7);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  private renderProjectiles(ctx: CanvasRenderingContext2D): void {
    for (let i = 0; i < MAX_PROJECTILES; i++) {
      const pr = this.projectiles[i];
      if (!pr.active) continue;

      const speed = Math.hypot(pr.vx, pr.vy) || 1;
      const nx = pr.vx / speed;
      const ny = pr.vy / speed;

      ctx.save();
      ctx.strokeStyle = pr.color;
      ctx.lineWidth = pr.tracerWidth;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(pr.x, pr.y);
      ctx.lineTo(pr.x - nx * pr.tracerLength, pr.y - ny * pr.tracerLength);
      ctx.stroke();

      // Bright core tip
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(pr.x, pr.y, pr.radius * 0.72, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private renderParticles(ctx: CanvasRenderingContext2D): void {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const pt = this.particles[i];
      if (!pt.active) continue;
      const t = clamp(pt.life / pt.maxLife, 0, 1);

      ctx.save();
      ctx.globalAlpha = t;
      if (pt.kind === 'ring') {
        const radius = pt.size * (1 - t * 0.65);
        ctx.strokeStyle = pt.color;
        ctx.lineWidth = 2.5 * t;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.size * (0.4 + t * 0.6), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private renderFloatingTexts(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '700 14px "JetBrains Mono", monospace';
    for (let i = 0; i < MAX_FLOATING_TEXTS; i++) {
      const ft = this.floatingTexts[i];
      if (!ft.active) continue;
      const alpha = clamp(ft.life / ft.maxLife, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
    }
    ctx.restore();
  }

  private renderReticle(ctx: CanvasRenderingContext2D): void {
    const x = this.mouseScreenX;
    const y = this.mouseScreenY;
    const ws = this.weaponStates[this.activeWeapon];
    const spec = WEAPONS[this.activeWeapon];
    const spreadGap = 8 + this.player.recoilOffset * 1.4 + (this.activeWeapon === 'shotgun' ? 6 : 0);

    ctx.save();
    ctx.translate(x, y);

    // Reload progress arc right around the crosshair
    if (ws.isReloading) {
      const total = spec.reloadTime / this.modifiers.reloadSpeedMult;
      const prog = clamp(1 - ws.reloadTimer / total, 0, 1);
      ctx.strokeStyle = 'rgba(248, 250, 252, 0.25)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, 17, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = spec.color;
      ctx.beginPath();
      ctx.arc(0, 0, 17, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
      ctx.stroke();
    }

    // Crosshair ticks
    ctx.strokeStyle = '#F8FAFC';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-spreadGap - 6, 0);
    ctx.lineTo(-spreadGap, 0);
    ctx.moveTo(spreadGap, 0);
    ctx.lineTo(spreadGap + 6, 0);
    ctx.moveTo(0, -spreadGap - 6);
    ctx.lineTo(0, -spreadGap);
    ctx.moveTo(0, spreadGap);
    ctx.lineTo(0, spreadGap + 6);
    ctx.stroke();

    // Center dot
    ctx.fillStyle = spec.color;
    ctx.beginPath();
    ctx.arc(0, 0, 2, 0, Math.PI * 2);
    ctx.fill();

    // Hitmarker flash X
    if (this.hitmarkerTimer > 0) {
      ctx.strokeStyle = this.hitmarkerCrit ? '#F59E0B' : '#F8FAFC';
      ctx.lineWidth = 2;
      const d1 = 5;
      const d2 = 12;
      ctx.beginPath();
      ctx.moveTo(-d2, -d2);
      ctx.lineTo(-d1, -d1);
      ctx.moveTo(d2, -d2);
      ctx.lineTo(d1, -d1);
      ctx.moveTo(-d2, d2);
      ctx.lineTo(-d1, d1);
      ctx.moveTo(d2, d2);
      ctx.lineTo(d1, d1);
      ctx.stroke();
    }

    ctx.restore();
  }
}
