/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { HudOverlay } from './components/HudOverlay';
import { GameOverModal, PauseModal } from './components/PauseAndEndModal';
import { TitleScreen } from './components/TitleScreen';
import { UpgradeModal } from './components/UpgradeModal';
import { WEAPONS } from './game/constants';
import { ShooterEngine } from './game/engine';
import { DifficultyMode, HudSnapshot, WeaponId } from './game/types';

const INITIAL_HUD: HudSnapshot = {
  phase: 'TITLE_MENU',
  difficulty: 'standard',
  hp: 100,
  maxHp: 100,
  armor: 30,
  maxArmor: 75,
  score: 0,
  bestScore: 0,
  wave: 1,
  enemiesRemaining: 0,
  combo: 1,
  comboTimerRatio: 0,
  dashCooldownRatio: 1,
  overchargeTimer: 0,
  activeWeapon: 'rifle',
  weapons: {
    rifle: { id: 'rifle', ammo: WEAPONS.rifle.magSize, magSize: WEAPONS.rifle.magSize, reloadTimer: 0, isReloading: false },
    shotgun: { id: 'shotgun', ammo: WEAPONS.shotgun.magSize, magSize: WEAPONS.shotgun.magSize, reloadTimer: 0, isReloading: false },
    railgun: { id: 'railgun', ammo: WEAPONS.railgun.magSize, magSize: WEAPONS.railgun.magSize, reloadTimer: 0, isReloading: false },
  },
  kills: 0,
  shotsFired: 0,
  shotsHit: 0,
  maxCombo: 1,
  upgradeChoices: [],
  acquiredUpgradeIds: [],
  waveBannerText: null,
  muted: false,
};

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<ShooterEngine | null>(null);
  const [hud, setHud] = useState<HudSnapshot>(INITIAL_HUD);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new ShooterEngine(canvas, (snapshot) => {
      setHud(snapshot);
    });
    engineRef.current = engine;
    engine.startLoop();

    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  const handleSelectDifficulty = (diff: DifficultyMode) => {
    engineRef.current?.setDifficulty(diff);
  };

  const handleStart = () => {
    engineRef.current?.startNewGame(hud.difficulty);
  };

  const handleToggleMute = () => {
    engineRef.current?.toggleMute();
  };

  const handlePause = () => {
    engineRef.current?.pauseGame();
  };

  const handleResume = () => {
    engineRef.current?.resumeGame();
  };

  const handleQuitToTitle = () => {
    engineRef.current?.returnToTitle();
  };

  const handleSwitchWeapon = (id: WeaponId) => {
    engineRef.current?.switchWeapon(id);
  };

  const handleSelectUpgrade = (upgradeId: string) => {
    engineRef.current?.selectUpgrade(upgradeId);
  };

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#0B0F15]">
      {/* Isolated Canvas Mount */}
      <div
        className={`absolute inset-0 ${
          hud.phase === 'PLAYING' ? 'cursor-none' : 'cursor-default'
        }`}
      >
        <canvas ref={canvasRef} className="block h-full w-full" />
      </div>

      {hud.phase === 'TITLE_MENU' && (
        <TitleScreen
          difficulty={hud.difficulty}
          bestScore={hud.bestScore}
          muted={hud.muted}
          onSelectDifficulty={handleSelectDifficulty}
          onStart={handleStart}
          onToggleMute={handleToggleMute}
        />
      )}

      {hud.phase !== 'TITLE_MENU' && (
        <HudOverlay
          hud={hud}
          onSwitchWeapon={handleSwitchWeapon}
          onToggleMute={handleToggleMute}
          onPause={handlePause}
        />
      )}

      {hud.phase === 'UPGRADE' && (
        <UpgradeModal
          waveCleared={hud.wave}
          choices={hud.upgradeChoices}
          onSelect={handleSelectUpgrade}
        />
      )}

      {hud.phase === 'PAUSED' && (
        <PauseModal
          hud={hud}
          onResume={handleResume}
          onRestart={handleStart}
          onQuitToTitle={handleQuitToTitle}
        />
      )}

      {hud.phase === 'GAME_OVER' && (
        <GameOverModal
          hud={hud}
          onPlayAgain={handleStart}
          onQuitToTitle={handleQuitToTitle}
        />
      )}
    </main>
  );
}
