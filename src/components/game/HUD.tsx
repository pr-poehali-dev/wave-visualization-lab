import Icon from '@/components/ui/icon';
import { Buff } from '@/lib/game/types';
import { Mutation, MutationType, Surface } from '@/lib/game/engine3d';

const ESCAPE_ENERGY = 88;
const ESCAPE_SIZE = 200;

const MUTATION_META: Record<MutationType, { icon: string; label: string; color: string; desc: string[] }> = {
  eyes:     { icon: 'Eye',      label: 'Глаза',    color: '#6699ff', desc: ['Радиус волн +40%', 'Радиус волн +80%', 'Тепловое зрение'] },
  flagella: { icon: 'Zap',      label: 'Жгутики',  color: '#ffdd44', desc: ['Скорость +50%', 'Скорость +100%', 'Буст при поглощении'] },
  toxin:    { icon: 'Skull',    label: 'Токсины',  color: '#44ff88', desc: ['Отравляет врагов', 'Убивает нематод', 'Растворяет грибки'] },
  spores:   { icon: 'Wind',     label: 'Споры',    color: '#cc88ff', desc: ['Споры при ударе', 'Область поражения', 'Автоспоры'] },
};

const SURFACE_LABEL: Record<Surface, string> = {
  floor: 'Пол', ceiling: 'Потолок',
  wall_px: 'Стена →', wall_nx: '← Стена',
  wall_pz: 'Стена ↓', wall_nz: '↑ Стена',
};

interface Props {
  energy: number;
  size: number;
  bestSize: number;
  elementsEaten: number;
  buffs: Buff[];
  freedom: boolean;
  mutations: Mutation[];
  surface: Surface;
  kills: { bacteria: number; fungus: number; nematode: number };
  onAchievements: () => void;
}

const HUD = ({ energy, size, bestSize, elementsEaten, buffs, freedom, mutations, surface, kills, onAchievements }: Props) => {
  const energyPct = Math.round(energy);
  const canEscape = energy >= ESCAPE_ENERGY && size >= ESCAPE_SIZE;

  return (
    <>
      {/* top-left: статус организма */}
      <div className="absolute top-3 left-3 hud-panel px-4 py-3 w-[236px] animate-fade-in">
        <div className="flex items-center gap-2 mb-0.5">
          <Icon name="Dna" size={15} className="text-[#5ff0e0]" />
          <span className="font-mono text-[11px] tracking-[0.2em] text-[#5ff0e0] uppercase">
            {freedom ? 'Лаборатория' : 'Пробирка А-7'}
          </span>
        </div>
        <div className="font-mono text-[9px] italic text-white/35 mb-2.5 pl-[22px]">
          P. polycephalum · {SURFACE_LABEL[surface]}
        </div>

        <Bar label="Энергия" value={energyPct} max={100} color="#ffb347" warn={energy < 20} suffix="%" />
        <Bar label="Сеть" value={size} max={freedom ? Math.max(600, size) : ESCAPE_SIZE} color="#b8ff40" suffix=" уз." />

        {!freedom && (
          <div className="mt-2 pt-2 border-t border-[#5ff0e0]/12">
            <div className="flex items-center gap-1.5 text-[10px] font-mono text-white/45">
              <Icon name={canEscape ? 'Unlock' : 'Lock'} size={11} className={canEscape ? 'text-[#a8ffb0]' : ''} />
              <span className={canEscape ? 'text-[#a8ffb0] animate-glow-pulse' : ''}>
                Побег: {ESCAPE_ENERGY}% энергии + {ESCAPE_SIZE} узлов
              </span>
            </div>
          </div>
        )}

        {/* мутации */}
        {mutations.length > 0 && (
          <div className="mt-2 pt-2 border-t border-[#5ff0e0]/12">
            <div className="text-[9px] font-mono text-white/40 uppercase tracking-wider mb-1.5">Мутации</div>
            <div className="flex flex-wrap gap-1.5">
              {mutations.map(m => {
                const meta = MUTATION_META[m.type];
                return (
                  <div key={m.type} className="flex items-center gap-1 px-1.5 py-0.5 rounded-md" style={{ background: meta.color + '22', border: `1px solid ${meta.color}44` }}>
                    <Icon name={meta.icon} size={11} style={{ color: meta.color }} />
                    <span className="font-mono text-[9px]" style={{ color: meta.color }}>{meta.label}</span>
                    <span className="font-mono text-[9px] text-white/40">{'★'.repeat(m.level)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* top-right: кнопки */}
      <div className="absolute top-3 right-3 flex flex-col gap-2 items-end animate-fade-in">
        <button onClick={onAchievements}
          className="hud-panel px-3 py-2 flex items-center gap-2 text-white/80 hover:text-white transition-colors text-xs font-mono">
          <Icon name="Trophy" size={14} className="text-[#ffd166]" /> Достижения
        </button>
        <div className="hud-panel px-3 py-2 text-[10px] font-mono text-white/50 text-right leading-relaxed">
          <div>Рекорд: <span className="text-[#b8ff40]">{bestSize}</span></div>
          <div>Элементов: <span className="text-[#ffd166]">{elementsEaten}</span></div>
          {freedom && <>
            <div>🦠 Бактерий: <span className="text-[#44ff88]">{kills.bacteria}</span></div>
            <div>🍄 Грибков: <span className="text-[#ff8833]">{kills.fungus}</span></div>
            <div>🪱 Нематод: <span className="text-[#ff4444]">{kills.nematode}</span></div>
          </>}
        </div>
      </div>

      {/* баффы снизу */}
      {buffs.length > 0 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 animate-fade-in">
          {buffs.map(b => (
            <div key={b.type} className="hud-panel px-3 py-2 flex items-center gap-2 animate-scale-in" style={{ borderColor: b.color + '55' }}>
              <Icon name={b.icon} size={15} style={{ color: b.color }} className="animate-glow-pulse" />
              <span className="font-mono text-[11px]" style={{ color: b.color }}>{b.label}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
};

const Bar = ({ label, value, max, color, suffix, warn }: {
  label: string; value: number; max: number; color: string; suffix: string; warn?: boolean;
}) => {
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
        <div className="h-full rounded-full transition-all duration-300"
          style={{ width: pct + '%', background: warn ? '#ff6b6b' : color, boxShadow: `0 0 8px ${warn ? '#ff6b6b' : color}` }} />
      </div>
    </div>
  );
};

export default HUD;
