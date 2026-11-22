import React from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { DifficultyMode } from '../game/types';

interface TitleScreenProps {
  difficulty: DifficultyMode;
  bestScore: number;
  muted: boolean;
  onSelectDifficulty: (diff: DifficultyMode) => void;
  onStart: () => void;
  onToggleMute: () => void;
}

export const TitleScreen: React.FC<TitleScreenProps> = ({
  difficulty,
  bestScore,
  muted,
  onSelectDifficulty,
  onStart,
  onToggleMute,
}) => {
  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-between p-6 md:p-10">
      {/* Top quiet utility bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-sm text-slate-400">
          <span>Тактический арена-шутер</span>
          {bestScore > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-mono-tabular text-amber-400">
                Рекорд: {bestScore.toLocaleString('ru-RU')}
              </span>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={onToggleMute}
          aria-label={muted ? 'Включить звук' : 'Выключить звук'}
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700/80 bg-[#141C27]/95 text-slate-300 transition-colors hover:border-slate-500 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
        >
          {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
        </button>
      </div>

      {/* Center-left hero lockup with calm negative space */}
      <div className="my-auto max-w-xl">
        {/* Bespoke SVG Title Lockup */}
        <svg
          viewBox="0 0 540 132"
          className="mb-4 w-full max-w-[460px] overflow-visible"
          role="img"
          aria-label="БАСТИОН 7"
        >
          <defs>
            <linearGradient id="bastionTitleGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#F8FAFC" />
              <stop offset="100%" stopColor="#CBD5E1" />
            </linearGradient>
          </defs>
          {/* Tactical crosshair emblem */}
          <g transform="translate(32, 66)">
            <circle cx="0" cy="0" r="24" fill="none" stroke="#F59E0B" strokeWidth="2.5" />
            <circle cx="0" cy="0" r="10" fill="none" stroke="#334155" strokeWidth="2" />
            <line x1="-32" y1="0" x2="-16" y2="0" stroke="#F59E0B" strokeWidth="2.5" />
            <line x1="16" y1="0" x2="32" y2="0" stroke="#F59E0B" strokeWidth="2.5" />
            <line x1="0" y1="-32" x2="0" y2="-16" stroke="#F59E0B" strokeWidth="2.5" />
            <line x1="0" y1="16" x2="0" y2="32" stroke="#F59E0B" strokeWidth="2.5" />
            <circle cx="0" cy="0" r="3.5" fill="#F59E0B" />
          </g>
          {/* Main Wordmark */}
          <text
            x="84"
            y="84"
            fill="url(#bastionTitleGrad)"
            fontFamily="'Barlow Condensed', system-ui, sans-serif"
            fontWeight="800"
            fontSize="76"
            letterSpacing="3"
          >
            БАСТИОН
          </text>
          {/* Accent Sector Number */}
          <g transform="translate(388, 22)">
            <rect width="74" height="74" rx="8" fill="#F59E0B" />
            <text
              x="37"
              y="60"
              textAnchor="middle"
              fill="#0B0F15"
              fontFamily="'Barlow Condensed', system-ui, sans-serif"
              fontWeight="800"
              fontSize="64"
            >
              7
            </text>
          </g>
          <line x1="84" y1="104" x2="462" y2="104" stroke="#334155" strokeWidth="1.5" />
          <text
            x="84"
            y="124"
            fill="#94A3B8"
            fontFamily="'Plus Jakarta Sans', system-ui, sans-serif"
            fontWeight="500"
            fontSize="15"
          >
            Удерживайте периметр · Три ствола · Улучшения после каждой волны
          </text>
        </svg>

        {/* Difficulty selector + Primary Start CTA */}
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={onStart}
            className="inline-flex h-12 items-center justify-center rounded-lg bg-amber-500 px-8 text-base font-bold text-slate-950 transition-transform duration-150 hover:bg-amber-400 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 whitespace-nowrap shrink-0"
          >
            Начать игру
          </button>

          <div
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700/80 bg-[#141C27]/95 p-1"
            role="group"
            aria-label="Выбор сложности"
          >
            <button
              type="button"
              onClick={() => onSelectDifficulty('standard')}
              className={`h-10 rounded-md px-4 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 ${
                difficulty === 'standard'
                  ? 'bg-slate-200 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Стандарт
            </button>
            <button
              type="button"
              onClick={() => onSelectDifficulty('veteran')}
              className={`h-10 rounded-md px-4 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 ${
                difficulty === 'veteran'
                  ? 'bg-red-500 text-white'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Ветеран
            </button>
          </div>
        </div>
      </div>

      {/* Single flat control-hint line */}
      <div className="text-xs md:text-sm text-slate-400 font-mono-tabular">
        WASD Движение · ЛКМ Огонь · Пробел / ПКМ Рывок · 1–3 Оружие · R Перезарядка · Esc Пауза
      </div>
    </div>
  );
};
