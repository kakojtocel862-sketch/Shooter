import React from 'react';
import { Heart, Pause, Shield, Volume2, VolumeX, Zap } from 'lucide-react';
import { WEAPONS } from '../game/constants';
import { HudSnapshot, WeaponId } from '../game/types';

interface HudOverlayProps {
  hud: HudSnapshot;
  onSwitchWeapon: (id: WeaponId) => void;
  onToggleMute: () => void;
  onPause: () => void;
}

const WEAPON_ORDER: WeaponId[] = ['rifle', 'shotgun', 'railgun'];

export const HudOverlay: React.FC<HudOverlayProps> = ({
  hud,
  onSwitchWeapon,
  onToggleMute,
  onPause,
}) => {
  const hpPct = Math.max(0, Math.min(100, (hud.hp / hud.maxHp) * 100));
  const armorPct = Math.max(0, Math.min(100, (hud.armor / hud.maxArmor) * 100));
  const dashReady = hud.dashCooldownRatio >= 0.99;

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-4 md:p-6">
      {/* Top Perimeter Clusters */}
      <div className="flex items-start justify-between gap-4">
        {/* Top-Left: Vitals & Wave */}
        <div className="flex flex-col gap-2 rounded-lg border border-slate-700/70 bg-[#0F172A]/90 px-4 py-3 min-w-[230px]">
          <div className="flex items-center justify-between gap-4 text-xs font-semibold text-slate-300">
            <span className="flex items-center gap-1.5">
              <Heart className="h-3.5 w-3.5 text-emerald-400" />
              <span>Здоровье</span>
            </span>
            <span className="font-mono-tabular text-slate-100">
              {hud.hp} / {hud.maxHp}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-sm bg-slate-800">
            <div
              className={`h-full transition-transform duration-150 origin-left ${
                hpPct > 35 ? 'bg-emerald-500' : 'bg-red-500'
              }`}
              style={{ transform: `scaleX(${hpPct / 100})` }}
            />
          </div>

          <div className="mt-0.5 flex items-center justify-between gap-4 text-xs font-semibold text-slate-300">
            <span className="flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5 text-sky-400" />
              <span>Броня</span>
            </span>
            <span className="font-mono-tabular text-sky-300">
              {hud.armor} / {hud.maxArmor}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-sm bg-slate-800">
            <div
              className="h-full bg-sky-400 transition-transform duration-150 origin-left"
              style={{ transform: `scaleX(${armorPct / 100})` }}
            />
          </div>

          <div className="mt-1 flex items-center justify-between border-t border-slate-800 pt-2 text-xs text-slate-400">
            <span className="font-semibold text-slate-200">Волна {hud.wave}</span>
            <span className="font-mono-tabular">Враги: {hud.enemiesRemaining}</span>
          </div>
        </div>

        {/* Center Wave Banner */}
        {hud.waveBannerText && (
          <div className="mt-2 rounded-lg border border-amber-500/40 bg-[#0F172A]/95 px-6 py-2 text-center">
            <div className="font-display text-3xl font-extrabold tracking-wider text-amber-400">
              {hud.waveBannerText}
            </div>
          </div>
        )}

        {/* Top-Right: Score, Combo & Utility Buttons */}
        <div className="flex items-start gap-2.5">
          <div className="rounded-lg border border-slate-700/70 bg-[#0F172A]/90 px-4 py-2.5 text-right">
            <div className="text-xs text-slate-400">Счёт</div>
            <div className="font-mono-tabular text-2xl font-bold leading-tight text-slate-100">
              {hud.score.toLocaleString('ru-RU')}
            </div>
            <div className="mt-0.5 flex items-center justify-end gap-2 text-xs font-mono-tabular">
              <span className={hud.combo > 1 ? 'text-amber-400 font-bold' : 'text-slate-500'}>
                Множитель x{hud.combo.toFixed(1)}
              </span>
              {hud.overchargeTimer > 0 && (
                <>
                  <span className="text-slate-600" aria-hidden="true">·</span>
                  <span className="text-amber-300 font-bold">
                    Перегрузка {hud.overchargeTimer.toFixed(1)}с
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="pointer-events-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onToggleMute}
              aria-label={hud.muted ? 'Включить звук' : 'Выключить звук'}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700/80 bg-[#0F172A]/90 text-slate-300 transition-colors hover:border-slate-500 hover:text-white"
            >
              {hud.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={onPause}
              aria-label="Пауза"
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700/80 bg-[#0F172A]/90 text-slate-300 transition-colors hover:border-slate-500 hover:text-white"
            >
              <Pause className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Perimeter Clusters */}
      <div className="flex items-end justify-between gap-4">
        {/* Bottom-Left: Weapon Switcher + Dash Readiness */}
        <div className="flex flex-col gap-2">
          <div className="pointer-events-auto flex items-center gap-2">
            {WEAPON_ORDER.map((id) => {
              const spec = WEAPONS[id];
              const ws = hud.weapons[id];
              const active = hud.activeWeapon === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onSwitchWeapon(id)}
                  className={`flex min-w-[128px] flex-col rounded-lg border px-3 py-2 text-left transition-colors ${
                    active
                      ? 'border-amber-400 bg-[#182232]/95 text-slate-100'
                      : 'border-slate-700/70 bg-[#0F172A]/85 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold whitespace-nowrap">{spec.shortName}</span>
                    <span className="font-mono-tabular text-slate-500">[{spec.slot}]</span>
                  </div>
                  <div className="mt-1 flex items-baseline justify-between font-mono-tabular">
                    {ws.isReloading ? (
                      <span className="text-xs font-semibold text-amber-400">Перезарядка</span>
                    ) : (
                      <span className="text-base font-bold text-slate-100">
                        {ws.ammo}
                        <span className="text-xs font-normal text-slate-500">/{ws.magSize}</span>
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3 rounded-lg border border-slate-700/70 bg-[#0F172A]/90 px-3 py-1.5 text-xs">
            <span className="flex items-center gap-1.5 font-semibold text-slate-300">
              <Zap className={`h-3.5 w-3.5 ${dashReady ? 'text-sky-400' : 'text-slate-500'}`} />
              <span>Рывок</span>
            </span>
            <div className="h-1.5 w-28 overflow-hidden rounded-sm bg-slate-800">
              <div
                className={`h-full origin-left ${dashReady ? 'bg-sky-400' : 'bg-slate-500'}`}
                style={{ transform: `scaleX(${hud.dashCooldownRatio})` }}
              />
            </div>
            <span className="font-mono-tabular text-slate-400">
              {dashReady ? 'Готов' : 'Заряд'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
