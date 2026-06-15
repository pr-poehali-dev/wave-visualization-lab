import Icon from '@/components/ui/icon';
import { Achievement, ExperimentEvent } from '@/lib/game/types';

export const ExperimentToast = ({ exp }: { exp: ExperimentEvent | null }) => {
  if (!exp) return null;
  return (
    <div className="absolute top-24 left-1/2 -translate-x-1/2 animate-slide-down z-20">
      <div className="hud-panel px-5 py-3 text-center" style={{ borderColor: exp.color + '66' }}>
        <div className="flex items-center gap-2 justify-center mb-1">
          <Icon name="FlaskConical" size={16} style={{ color: exp.color }} />
          <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-white/50">Эксперимент</span>
        </div>
        <div className="font-display font-bold text-lg" style={{ color: exp.color }}>{exp.label}</div>
        <div className="text-white/60 text-xs mt-0.5">{exp.desc}</div>
      </div>
    </div>
  );
};

export const FreedomBanner = ({ show }: { show: boolean }) => {
  if (!show) return null;
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30 animate-fade-in">
      <div className="text-center">
        <div className="font-display font-black text-5xl md:text-7xl text-glow text-[#5ff0e0] mb-3">
          СВОБОДА
        </div>
        <div className="font-mono text-white/70 tracking-[0.3em] uppercase text-sm">
          Пробирка разбита · мир открыт
        </div>
      </div>
    </div>
  );
};

export const DeathScreen = ({ size, onRestart }: { size: number; onRestart: () => void }) => (
  <div className="absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-sm z-40 animate-fade-in">
    <div className="hud-panel px-10 py-8 text-center max-w-sm">
      <Icon name="Skull" size={48} className="text-[#ff6b6b] mx-auto mb-4" />
      <h2 className="font-display font-black text-3xl text-white mb-2">Энергия иссякла</h2>
      <p className="text-white/60 text-sm mb-1">Слизевик распался на молекулы.</p>
      <p className="font-mono text-[#5ff0e0] text-sm mb-6">Достигнутая сеть: {size} узлов</p>
      <button
        onClick={onRestart}
        className="w-full py-3 rounded-xl font-display font-bold text-[#04070d] bg-[#5ff0e0] hover:bg-[#7ff5e8] transition-colors flex items-center justify-center gap-2"
        style={{ boxShadow: '0 0 24px rgba(95,240,224,0.5)' }}
      >
        <Icon name="RotateCcw" size={18} />
        Начать заново
      </button>
    </div>
  </div>
);

export const AbilityMenu = ({ onClose, energy, size }: { onClose: () => void; energy: number; size: number }) => (
  <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm z-40 animate-fade-in" onClick={onClose}>
    <div className="hud-panel px-6 py-6 w-[300px] animate-scale-in" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display font-bold text-white text-lg flex items-center gap-2">
          <Icon name="Atom" size={20} className="text-[#5ff0e0]" /> Способности
        </h3>
        <button onClick={onClose} className="text-white/40 hover:text-white">
          <Icon name="X" size={18} />
        </button>
      </div>
      <div className="space-y-2">
        {[
          { icon: 'Sparkles', name: 'Мутация', desc: 'Импульс роста сети', color: '#ffd700' },
          { icon: 'Crosshair', name: 'Фокус', desc: 'Сжать сеть к голове', color: '#5ff0e0' },
          { icon: 'Activity', name: 'Статус', desc: `Энергия ${Math.round(energy)}% · ${size} узлов`, color: '#a8ffb0' },
        ].map((a) => (
          <div key={a.name} className="flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors cursor-default">
            <Icon name={a.icon} size={20} style={{ color: a.color }} />
            <div>
              <div className="font-display font-semibold text-white text-sm">{a.name}</div>
              <div className="text-white/50 text-xs">{a.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

export const AchievementsPanel = ({ list, onClose }: { list: Achievement[]; onClose: () => void }) => (
  <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-40 animate-fade-in" onClick={onClose}>
    <div className="hud-panel px-6 py-6 w-[340px] animate-scale-in" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display font-bold text-white text-lg flex items-center gap-2">
          <Icon name="Trophy" size={20} className="text-[#ffd166]" /> Достижения
        </h3>
        <button onClick={onClose} className="text-white/40 hover:text-white">
          <Icon name="X" size={18} />
        </button>
      </div>
      <div className="space-y-2">
        {list.map((a) => (
          <div key={a.id} className={`flex items-center gap-3 p-3 rounded-xl ${a.unlocked ? 'bg-[#ffd166]/10' : 'bg-white/5'}`}>
            <Icon name={a.icon} size={22} className={a.unlocked ? 'text-[#ffd166]' : 'text-white/25'} />
            <div className="flex-1">
              <div className={`font-display font-semibold text-sm ${a.unlocked ? 'text-white' : 'text-white/40'}`}>{a.title}</div>
              <div className="text-white/40 text-xs">{a.desc}</div>
            </div>
            {a.unlocked && <Icon name="Check" size={16} className="text-[#a8ffb0]" />}
          </div>
        ))}
      </div>
    </div>
  </div>
);

export const ToastPop = ({ text, icon, color }: { text: string; icon: string; color: string }) => (
  <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-30 animate-slide-down">
    <div className="hud-panel px-4 py-2.5 flex items-center gap-2" style={{ borderColor: color + '66' }}>
      <Icon name={icon} size={16} style={{ color }} />
      <span className="font-display font-semibold text-sm text-white">{text}</span>
    </div>
  </div>
);
