import React from 'react';
import { UpgradeOption } from '../game/types';

interface UpgradeModalProps {
  waveCleared: number;
  choices: UpgradeOption[];
  onSelect: (upgradeId: string) => void;
}

export const UpgradeModal: React.FC<UpgradeModalProps> = ({
  waveCleared,
  choices,
  onSelect,
}) => {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#070B11]/85 p-6">
      <div className="w-full max-w-3xl rounded-xl border border-slate-700/80 bg-[#121923] p-6 md:p-8">
        <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-800 pb-4">
          <div>
            <p className="text-xs font-semibold text-emerald-400">
              Волна {waveCleared} зачищена
            </p>
            <h2 className="font-display mt-1 text-3xl font-bold tracking-wide text-slate-100">
              Выберите тактическое улучшение
            </h2>
          </div>
          <span className="text-xs text-slate-400 font-mono-tabular">
            Нажмите 1, 2 или 3
          </span>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {choices.map((item, idx) => {
            const accentClass =
              item.accent === 'amber'
                ? 'text-amber-400 border-amber-500/40 hover:border-amber-400'
                : item.accent === 'emerald'
                ? 'text-emerald-400 border-emerald-500/40 hover:border-emerald-400'
                : 'text-sky-400 border-sky-500/40 hover:border-sky-400';

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                className={`group flex flex-col justify-between rounded-lg border bg-[#17202E] p-5 text-left transition-transform duration-150 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-amber-400 ${accentClass}`}
              >
                <div>
                  <div className="flex items-center justify-between text-xs font-mono-tabular text-slate-400">
                    <span>Модуль</span>
                    <span>[{idx + 1}]</span>
                  </div>
                  <h3 className="mt-2 text-lg font-bold text-slate-100 group-hover:text-white">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">
                    {item.description}
                  </p>
                </div>

                <div className="mt-5 border-t border-slate-800 pt-3 text-sm font-bold font-mono-tabular">
                  {item.statLabel}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
