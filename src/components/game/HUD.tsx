import Icon from '@/components/ui/icon';
import { Buff } from '@/lib/game/types';
import { ESCAPE_ENERGY, ESCAPE_SIZE } from '@/lib/game/data';

interface Props {
  energy: number;
  size: number;
  bestSize: number;
  elementsEaten: number;
  buffs: Buff[];
  freedom: boolean;
  mode: 'follow' | 'target';
  onMode: () => void;
  onAchievements: () => void;
}

const HUD = ({ energy, size, bestSize, elementsEaten, buffs, freedom, mode, onMode, onAchievements }: Props) => {
  const energyPct = Math.round(energy);
  const sizePct = Math.min(100, Math.round((size / ESCAPE_SIZE) * 100));
  const canEscape = energy >= ESCAPE_ENERGY && size >= ESCAPE_SIZE;

  return (
    <>
      {/* top-left status */}
      <div className="absolute top-3 left-3 hud-panel px-4 py-3 w-[230px] animate-fade-in">
        <div className="flex items-center gap-2 mb-0.5">
          <Icon name="Dna" size={16} className="text-[#5ff0e0]" />
          <span className="font-mono text-[11px] tracking-[0.2em] text-[#5ff0e0] uppercase">
            {freedom ? 'Лаборатория' : 'Пробирка А-7'}
          </span>
        </div>
        <div className="font-mono text-[9px] italic text-white/35 mb-2 pl-[22px] -mt-0.5">
          P. polycephalum
        </div>

        <Bar
          label="Энергия"
          value={energyPct}
          max={100}
          color="#ffb347"
          warn={energy < 25}
          suffix="%"
        />
        <Bar
          label="Сеть"
          value={size}
          max={freedom ? Math.max(1000, size) : ESCAPE_SIZE}
          color="#5ff0e0"
          suffix=" уз."
        />

        {!freedom && (
          <div className="mt-2 pt-2 border-t border-[#5ff0e0]/15">
            <div className="flex items-center gap-1.5 text-[10px] font-mono text-white/50">
              <Icon name={canEscape ? 'Unlock' : 'Lock'} size={12} className={canEscape ? 'text-[#a8ffb0]' : ''} />
              <span className={canEscape ? 'text-[#a8ffb0]' : ''}>
                Побег: ≥{ESCAPE_ENERGY}% и ≥{ESCAPE_SIZE} узлов
              </span>
            </div>
          </div>
        )}
      </div>

      {/* top-right controls */}
      <div className="absolute top-3 right-3 flex flex-col gap-2 items-end animate-fade-in">
        <button
          onClick={onMode}
          className="hud-panel px-3 py-2 flex items-center gap-2 text-white/80 hover:text-white transition-colors text-xs font-mono"
        >
          <Icon name={mode === 'follow' ? 'MousePointer2' : 'Crosshair'} size={14} className="text-[#5ff0e0]" />
          {mode === 'follow' ? 'Следование' : 'Цель'}
        </button>
        <button
          onClick={onAchievements}
          className="hud-panel px-3 py-2 flex items-center gap-2 text-white/80 hover:text-white transition-colors text-xs font-mono"
        >
          <Icon name="Trophy" size={14} className="text-[#ffd166]" />
          Достижения
        </button>
        <div className="hud-panel px-3 py-2 text-[10px] font-mono text-white/50 text-right leading-relaxed">
          <div>Рекорд: <span className="text-[#5ff0e0]">{bestSize}</span></div>
          <div>Съедено: <span className="text-[#a8ffb0]">{elementsEaten}</span></div>
        </div>
      </div>

      {/* buffs */}
      {buffs.length > 0 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 animate-fade-in">
          {buffs.map((b) => (
            <div
              key={b.type}
              className="hud-panel px-3 py-2 flex items-center gap-2 animate-scale-in"
              style={{ borderColor: b.color + '55' }}
            >
              <Icon name={b.icon} size={16} style={{ color: b.color }} className="animate-glow-pulse" />
              <span className="font-mono text-[11px]" style={{ color: b.color }}>
                {b.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
};

const Bar = ({ label, value, max, color, suffix, warn }: { label: string; value: number; max: number; color: string; suffix: string; warn?: boolean }) => {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="mb-2">
      <div className="flex justify-between text-[10px] font-mono mb-1">
        <span className="text-white/50 uppercase tracking-wider">{label}</span>
        <span style={{ color: warn ? '#ff6b6b' : color }} className={warn ? 'animate-glow-pulse' : ''}>
          {value}{suffix}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: pct + '%', background: warn ? '#ff6b6b' : color, boxShadow: `0 0 8px ${warn ? '#ff6b6b' : color}` }}
        />
      </div>
    </div>
  );
};

export default HUD;