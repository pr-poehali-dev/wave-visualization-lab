import { useEffect, useRef, useState, useCallback } from 'react';
import { GameEngine3D, GameState, Mutation } from '@/lib/game/engine3d';
import { ExperimentEvent, Achievement } from '@/lib/game/types';
import { ACHIEVEMENTS } from '@/lib/game/data';
import HUD from '@/components/game/HUD';
import {
  ExperimentToast,
  FreedomBanner,
  DeathScreen,
  AchievementsPanel,
  ToastPop,
  MutationToast,
  KillToast,
} from '@/components/game/Overlays';
import Icon from '@/components/ui/icon';

const SAVE_KEY = 'slime-lab-v3';

interface Save {
  bestSize: number; escapes: number; elementsEaten: number; achievements: string[];
  kills: { bacteria: number; fungus: number; nematode: number };
}

const loadSave = (): Save => {
  try { const r = localStorage.getItem(SAVE_KEY); if (r) return JSON.parse(r); } catch { /* */ }
  return { bestSize: 0, escapes: 0, elementsEaten: 0, achievements: [], kills: { bacteria: 0, fungus: 0, nematode: 0 } };
};

const ALL_ACHIEVEMENTS: Achievement[] = [
  ...ACHIEVEMENTS,
  { id: 'mutation_eyes',    title: 'Ясновидящий',  desc: 'Мутация: получи Глаза',      icon: 'Eye',      unlocked: false },
  { id: 'mutation_flagella', title: 'Реактивный',  desc: 'Мутация: получи Жгутики',    icon: 'Zap',      unlocked: false },
  { id: 'mutation_toxin',   title: 'Ядовитый',     desc: 'Мутация: получи Токсины',    icon: 'Skull',    unlocked: false },
  { id: 'mutation_spores',  title: 'Споровик',     desc: 'Мутация: получи Споры',      icon: 'Wind',     unlocked: false },
  { id: 'killer',           title: 'Охотник',      desc: 'Убей 3 нематоды',            icon: 'Swords',   unlocked: false },
];

const Index = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine3D | null>(null);
  const saveRef = useRef<Save>(loadSave());

  const [started, setStarted] = useState(false);
  const [state, setState] = useState<GameState | null>(null);
  const [exp, setExp] = useState<ExperimentEvent | null>(null);
  const [showAch, setShowAch] = useState(false);
  const [freedomBanner, setFreedomBanner] = useState(false);
  const [pop, setPop] = useState<{ text: string; icon: string; color: string } | null>(null);
  const [mutation, setMutation] = useState<Mutation | null>(null);
  const [killKind, setKillKind] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState<string[]>(saveRef.current.achievements);

  const persist = useCallback((patch: Partial<Save>) => {
    saveRef.current = { ...saveRef.current, ...patch };
    localStorage.setItem(SAVE_KEY, JSON.stringify(saveRef.current));
  }, []);

  const unlockAch = useCallback((id: string) => {
    if (saveRef.current.achievements.includes(id)) return;
    const list = [...saveRef.current.achievements, id];
    persist({ achievements: list });
    if (id === 'escape') persist({ escapes: saveRef.current.escapes + 1 });
    setUnlocked(list);
    const meta = ALL_ACHIEVEMENTS.find(a => a.id === id);
    if (meta) { setPop({ text: meta.title, icon: 'Trophy', color: '#ffd166' }); setTimeout(() => setPop(null), 2400); }
  }, [persist]);

  const initEngine = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const engine = new GameEngine3D(canvas, {
      onState: (s) => {
        setState(s);
        if (s.bestSize > saveRef.current.bestSize) persist({ bestSize: s.bestSize });
        if (s.freedom && s.phase === 'world') {
          setFreedomBanner(prev => { if (!prev) setTimeout(() => setFreedomBanner(false), 3200); return true; });
        }
      },
      onEvent: (e) => { setExp(e); setTimeout(() => setExp(cur => cur === e ? null : cur), 4500); },
      onAchievement: unlockAch,
      onElementEaten: (rare, symbol) => {
        persist({ elementsEaten: saveRef.current.elementsEaten + 1 });
        if (rare) { setPop({ text: `Редкий ${symbol}!`, icon: 'Gem', color: '#ffd700' }); setTimeout(() => setPop(null), 1800); }
      },
      onMutation: (m) => {
        setMutation(m);
        setTimeout(() => setMutation(null), 3500);
      },
      onKill: (kind) => {
        if (kind === 'nematode') {
          setKillKind(kind);
          setTimeout(() => setKillKind(null), 1600);
        }
        const kills = { ...saveRef.current.kills, [kind]: (saveRef.current.kills[kind as keyof typeof saveRef.current.kills] ?? 0) + 1 };
        persist({ kills });
      },
    });
    engineRef.current = engine;
    engine.start();
  }, [persist, unlockAch]);

  useEffect(() => {
    if (!started) return;
    initEngine();
    const onResize = () => engineRef.current?.resize();
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); engineRef.current?.stop(); };
  }, [started, initEngine]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const eng = engineRef.current;
    if (!eng || eng.phase === 'dead') return;
    if (e.button === 2) return;
    eng.setTargetFromScreen(e.clientX, e.clientY);
  }, []);

  const restart = () => { engineRef.current?.reset(); setFreedomBanner(false); setExp(null); setMutation(null); };

  const achList = ALL_ACHIEVEMENTS.map(a => ({ ...a, unlocked: unlocked.includes(a.id) }));
  const kills = state ? saveRef.current.kills : { bacteria: 0, fungus: 0, nematode: 0 };

  if (!started) return <StartScreen onStart={() => setStarted(true)} save={saveRef.current} />;

  return (
    <div className="fixed inset-0 bg-[#04070d] overflow-hidden select-none">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full touch-none" onPointerDown={handlePointerDown} />

      {state && (
        <HUD
          energy={state.energy}
          size={state.size}
          bestSize={state.bestSize}
          elementsEaten={saveRef.current.elementsEaten}
          buffs={state.buffs}
          freedom={state.freedom}
          mutations={state.mutations}
          surface={state.surface}
          kills={kills}
          onAchievements={() => setShowAch(true)}
        />
      )}

      <ExperimentToast exp={exp} />
      <MutationToast mutation={mutation} />
      <KillToast kind={killKind} />
      <FreedomBanner show={freedomBanner} />
      {pop && <ToastPop {...pop} />}

      {state?.phase === 'dead' && <DeathScreen size={state.size} onRestart={restart} />}
      {showAch && <AchievementsPanel list={achList} onClose={() => setShowAch(false)} />}

      {/* управление */}
      <div className="absolute bottom-4 right-4 hud-panel px-3 py-2.5 text-[10px] font-mono text-white/40 max-w-[200px] leading-relaxed hidden md:block">
        <div className="text-[#5ff0e0] text-[11px] mb-1 font-semibold">Управление</div>
        <div>• Клик — аттрактант (куда расти)</div>
        <div>• ПКМ + тяни — вращение камеры</div>
        <div>• Скролл / щипок — зум</div>
        <div>• Волны открывают мир вокруг</div>
        <div className="mt-1 text-white/25">Ползай по стенам и потолку!</div>
      </div>
    </div>
  );
};

const StartScreen = ({ onStart, save }: { onStart: () => void; save: Save }) => (
  <div className="fixed inset-0 bg-[#04070d] flex items-center justify-center overflow-hidden">
    <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at 50% 38%, #0c1e12, #02050a)' }} />
    <div className="absolute inset-0 flex items-center justify-center">
      {[0,1,2].map(i => (
        <div key={i} className="absolute rounded-full border border-[#b8ff40]/12 animate-glow-pulse"
          style={{ width: 180 + i * 180, height: 180 + i * 180, animationDelay: i * 0.6 + 's' }} />
      ))}
    </div>

    <div className="relative text-center px-6 animate-fade-in max-w-lg">
      <div className="inline-flex items-center gap-2 mb-4 hud-panel px-4 py-1.5">
        <Icon name="Microscope" size={14} className="text-[#b8ff40]" />
        <span className="font-mono text-[10px] tracking-[0.3em] uppercase text-[#b8ff40]">Physarum polycephalum</span>
      </div>
      <h1 className="font-display font-black text-6xl md:text-8xl text-white mb-2 leading-none">
        SLIME<span style={{ color: '#b8ff40', textShadow: '0 0 30px #b8ff4088' }}>LAB</span>
      </h1>
      <p className="font-mono text-[11px] italic tracking-wider text-white/35 mb-5">
        3D лаборатория · стены · потолок · мутации · организмы
      </p>
      <p className="text-white/60 max-w-md mx-auto mb-8 leading-relaxed text-sm">
        Ты — <span className="text-white/90">Physarum polycephalum</span>. Ползай по полу, взбирайся на стены и потолок. Поглощай элементы — получай мутации: <span className="text-[#6699ff]">Глаза</span>, <span className="text-[#ffdd44]">Жгутики</span>, <span className="text-[#44ff88]">Токсины</span>. Сражайся с нематодами. Выбеги из пробирки.
      </p>

      <button onClick={onStart}
        className="px-8 py-4 rounded-2xl font-display font-bold text-lg text-[#04070d] hover:scale-105 transition-all inline-flex items-center gap-3"
        style={{ background: '#b8ff40', boxShadow: '0 0 40px rgba(184,255,64,0.45)' }}>
        <Icon name="Play" size={20} />
        Запустить симуляцию
      </button>

      {save.bestSize > 0 && (
        <div className="mt-6 flex items-center justify-center gap-5 font-mono text-xs text-white/35">
          <span>Рекорд: <span className="text-[#b8ff40]">{save.bestSize}</span></span>
          <span>Побегов: <span className="text-[#5ff0e0]">{save.escapes}</span></span>
          <span>🪱 Нематод: <span className="text-[#ff4444]">{save.kills?.nematode ?? 0}</span></span>
        </div>
      )}
    </div>
  </div>
);

export default Index;
