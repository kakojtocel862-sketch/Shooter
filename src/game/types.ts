export type GamePhase = 'TITLE_MENU' | 'PLAYING' | 'PAUSED' | 'UPGRADE' | 'GAME_OVER';

export type DifficultyMode = 'standard' | 'veteran';

export type WeaponId = 'rifle' | 'shotgun' | 'railgun';

export interface WeaponSpec {
  id: WeaponId;
  slot: 1 | 2 | 3;
  name: string;
  shortName: string;
  damage: number;
  fireInterval: number; // seconds
  pellets: number;
  spreadRad: number;
  projectileSpeed: number;
  magSize: number;
  reloadTime: number; // seconds
  recoilKick: number;
  shake: number;
  pierce: number; // 0 = stops on first hit, >0 = pierces N targets
  knockback: number;
  color: string;
  tracerLength: number;
  tracerWidth: number;
}

export interface WeaponState {
  id: WeaponId;
  ammo: number;
  magSize: number;
  reloadTimer: number;
  isReloading: boolean;
}

export type EnemyType = 'trooper' | 'rusher' | 'heavy' | 'sniper' | 'bomber';

export interface Enemy {
  id: number;
  type: EnemyType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  hp: number;
  maxHp: number;
  speed: number;
  angle: number;
  hitFlash: number;
  squashX: number;
  squashY: number;
  state: 'chase' | 'windup' | 'attack' | 'recover';
  stateTimer: number;
  windupDuration: number;
  aimAngle: number;
  burstRemaining: number;
  burstTimer: number;
  scoreValue: number;
  strafeDir: number;
}

export interface Projectile {
  active: boolean;
  fromPlayer: boolean;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  life: number;
  maxLife: number;
  pierceLeft: number;
  bouncesLeft: number;
  knockback: number;
  color: string;
  tracerLength: number;
  tracerWidth: number;
  hitEnemyIds: number[];
}

export interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
  color: string;
  drag: number;
  kind: 'spark' | 'smoke' | 'ring' | 'debris';
}

export interface ShellCasing {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  vAngle: number;
  life: number;
  color: string;
  length: number;
  width: number;
}

export interface ScorchMark {
  x: number;
  y: number;
  radius: number;
  alpha: number;
  kind: 'blast' | 'rail';
  angle?: number;
  length?: number;
}

export type PickupKind = 'medkit' | 'armor' | 'overcharge';

export interface Pickup {
  id: number;
  kind: PickupKind;
  x: number;
  y: number;
  life: number;
  bobPhase: number;
}

export interface Obstacle {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'pillar' | 'crate';
}

export interface FloatingText {
  active: boolean;
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  scale: number;
}

export interface UpgradeOption {
  id: string;
  title: string;
  description: string;
  statLabel: string;
  accent: 'amber' | 'emerald' | 'sky';
}

export interface PlayerModifiers {
  damageMult: number;
  fireRateMult: number;
  moveSpeedMult: number;
  dashCooldownMult: number;
  reloadSpeedMult: number;
  maxHpBonus: number;
  vampirismOnKill: number;
  ricochetCount: number;
  extraRailPierce: number;
}

export interface HudSnapshot {
  phase: GamePhase;
  difficulty: DifficultyMode;
  hp: number;
  maxHp: number;
  armor: number;
  maxArmor: number;
  score: number;
  bestScore: number;
  wave: number;
  enemiesRemaining: number;
  combo: number;
  comboTimerRatio: number;
  dashCooldownRatio: number; // 1 = ready, 0..1 = recharging
  overchargeTimer: number;
  activeWeapon: WeaponId;
  weapons: Record<WeaponId, WeaponState>;
  kills: number;
  shotsFired: number;
  shotsHit: number;
  maxCombo: number;
  upgradeChoices: UpgradeOption[];
  acquiredUpgradeIds: string[];
  waveBannerText: string | null;
  muted: boolean;
}
