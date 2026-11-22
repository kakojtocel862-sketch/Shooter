import React from 'react';
import { HudSnapshot } from '../game/types';

interface PauseModalProps {
  hud: HudSnapshot;
  onResume: () => void;
  onRestart: () => void;
  onQuitToTitle: () => void;
}

export const PauseModal: React.FC<PauseModalProps> = ({
  hud,
  onResume,
  onRestart,
  onQuitToTitle,
}) => {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#070B11]/82 p-6">
      <div className="w-full max-w-md rounded-xl border border-slate-700/80 bg-[#121923] p-6 md:p-8">
        <h2 className="font-display text-3xl font-bold tracking-wide text-slate-100">
          Пауза
        </h2>
        <div className="mt-2 flex items-center gap-2 text-xs text-slate-400 font-mono-tabular">
          <span>Волна {hud.wave}</span>
          <span aria-hidden="true">·</span>
          <span>Счёт {hud.score.toLocaleString('ru-RU')}</span>
          <span aria-hidden="true">·</span>
          <span>Убийств {hud.kills}</span>
        </div>

        <div className="mt-6 flex flex-col gap-3">
          <button
            type="button"
            onClick={onResume}
            className="h-11 rounded-lg bg-amber-500 px-5 text-sm font-bold text-slate-950 transition-colors hover:bg-amber-400 whitespace-nowrap"
          >
            Продолжить
          </button>
          <button
            type="button"
            onClick={onRestart}
            className="h-11 rounded-lg border border-slate-700 bg-[#182232] px-5 text-sm font-semibold text-slate-200 transition-colors hover:border-slate-500 hover:text-white whitespace-nowrap"
          >
            Начать заново
          </button>
          <button
            type="button"
            onClick={onQuitToTitle}
            className="h-11 rounded-lg border border-slate-800 bg-transparent px-5 text-sm font-semibold text-slate-400 transition-colors hover:border-slate-700 hover:text-slate-200 whitespace-nowrap"
          >
            Выйти в меню
          </button>
        </div>
      </div>
    </div>
  );
};

interface GameOverModalProps {
  hud: HudSnapshot;
  onPlayAgain: () => void;
  onQuitToTitle: () => void;
}

export const GameOverModal: React.FC<GameOverModalProps> = ({
  hud,
  onPlayAgain,
  onQuitToTitle,
}) => {
  const accuracy =
    hud.shotsFired > 0 ? Math.round((hud.shotsHit / hud.shotsFired) * 100) : 0;
  const isNewRecord = hud.score > 0 && hud.score >= hud.bestScore;

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#070B11]/88 p-6">
      <div className="w-full max-w-lg rounded-xl border border-slate-700/80 bg-[#121923] p-6 md:p-8">
        <div className="flex items-baseline justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <p className="text-xs font-semibold text-red-400">Боец выведен из строя</p>
            <h2 className="font-display mt-1 text-4xl font-extrabold tracking-wide text-slate-100">
              Конец боя
            </h2>
          </div>
          {isNewRecord && (
            <span className="text-xs font-bold text-amber-400 font-mono-tabular">
              Новый рекорд
            </span>
          )}
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4">
          <div className="rounded-lg border border-slate-800 bg-[#17202E] p-4">
            <div className="text-xs text-slate-400">Итоговый счёт</div>
            <div className="font-mono-tabular mt-1 text-2xl font-bold text-amber-400">
              {hud.score.toLocaleString('ru-RU')}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-[#17202E] p-4">
            <div className="text-xs text-slate-400">Лучший результат</div>
            <div className="font-mono-tabular mt-1 text-2xl font-bold text-slate-100">
              {hud.bestScore.toLocaleString('ru-RU')}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-[#17202E] p-4">
            <div className="text-xs text-slate-400">Пройдено волн · Убийства</div>
            <div className="font-mono-tabular mt-1 text-lg font-bold text-slate-100">
              {hud.wave} · {hud.kills}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-[#17202E] p-4">
            <div className="text-xs text-slate-400">Точность · Макс. комбо</div>
            <div className="font-mono-tabular mt-1 text-lg font-bold text-slate-100">
              {accuracy}% · x{hud.maxCombo.toFixed(1)}
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onPlayAgain}
            className="h-11 flex-1 rounded-lg bg-amber-500 px-6 text-sm font-bold text-slate-950 transition-colors hover:bg-amber-400 whitespace-nowrap"
          >
            Играть снова
          </button>
          <button
            type="button"
            onClick={onQuitToTitle}
            className="h-11 rounded-lg border border-slate-700 bg-[#182232] px-5 text-sm font-semibold text-slate-300 transition-colors hover:border-slate-500 hover:text-white whitespace-nowrap"
          >
            В главное меню
          </button>
        </div>
      </div>
    </div>
  );
};
