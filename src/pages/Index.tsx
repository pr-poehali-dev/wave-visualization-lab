import { useEffect, useRef, useState, useCallback } from 'react';
import { GameEngine, GameState } from '@/lib/game/engine';
import { ExperimentEvent, Achievement } from '@/lib/game/types';
import { ACHIEVEMENTS } from '@/lib/game/data';
import HUD from '@/components/game/HUD';
import {
  ExperimentToast,
  FreedomBanner,
  DeathScreen,
  AbilityMenu,
  AchievementsPanel,
  ToastPop,
} from '@/components/game/Overlays';
import Icon from '@/components/ui/icon';

const SAVE_KEY = 'slime-lab-save';

interface Save {
  bestSize: number;
  escapes: number;
  elementsEaten: number;
  achievements: string[];
}

const loadSave = (): Save => {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* noop */ }
  return { bestSize: 0, escapes: 0, elementsEaten: 0, achievements: [] };
};

const Index = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const saveRef = useRef<Save>(loadSave());

  const [started, setStarted] = useState(false);
  const [state, setState] = useState<GameState | null>(null);
  const [exp, setExp] = useState<ExperimentEvent | null>(null);
  const [mode, setMode] = useState<'follow' | 'target'>('follow');
  const [showAbility, setShowAbility] = useState(false);
  const [showAch, setShowAch] = useState(false);
  const [freedomBanner, setFreedomBanner] = useState(false);
  const [pop, setPop] = useState<{ text: string; icon: string; color: string } | null>(null);
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
    const meta = ACHIEVEMENTS.find((a) => a.id === id);
    if (meta) setPop({ text: 'Достижение: ' + meta.title, icon: 'Trophy', color: '#ffd166' });
    setTimeout(() => setPop(null), 2600);
  }, [persist]);

  const initEngine = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new GameEngine(canvas, {
      onState: (s) => {
        setState(s);
        if (s.bestSize > saveRef.current.bestSize) persist({ bestSize: s.bestSize });
        if (s.freedom && s.phase === 'world') {
          setFreedomBanner((prev) => {
            if (!prev) setTimeout(() => setFreedomBanner(false), 3000);
            return true;
          });
        }
      },
      onEvent: (e) => {
        setExp(e);
        setTimeout(() => setExp((cur) => (cur === e ? null : cur)), 4500);
      },
      onAchievement: unlockAch,
      onElementEaten: (rare) => {
        persist({ elementsEaten: saveRef.current.elementsEaten + 1 });
        if (rare) {
          setPop({ text: 'Редкий элемент!', icon: 'Gem', color: '#ffd700' });
          setTimeout(() => setPop(null), 1800);
        }
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
    return () => {
      window.removeEventListener('resize', onResize);
      engineRef.current?.stop();
    };
  }, [started, initEngine]);

  const getPos = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const eng = engineRef.current;
    if (!eng || eng.phase === 'dead') return;
    const p = getPos(e);
    const head = eng.head();
    const hx = eng.W / 2 + (head.x - eng.cam.x) * eng.cam.scale;
    const hy = eng.H / 2 + (head.y - eng.cam.y) * eng.cam.scale;
    if (Math.hypot(p.x - hx, p.y - hy) < 26) {
      setShowAbility(true);
      return;
    }
    if (mode === 'target') eng.setTarget(p.x, p.y);
    eng.setPointer(p.x, p.y, true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const eng = engineRef.current;
    if (!eng) return;
    const p = getPos(e);
    eng.setPointer(p.x, p.y, eng.pointer.active);
  };

  const onPointerUp = () => {
    const eng = engineRef.current;
    if (eng) eng.pointer.active = false;
  };

  const toggleMode = () => {
    const next = mode === 'follow' ? 'target' : 'follow';
    setMode(next);
    if (engineRef.current) engineRef.current.mode = next;
  };

  const restart = () => {
    engineRef.current?.reset();
    setFreedomBanner(false);
    setExp(null);
  };

  const achList: Achievement[] = ACHIEVEMENTS.map((a) => ({ ...a, unlocked: unlocked.includes(a.id) }));

  if (!started) {
    return <StartScreen onStart={() => setStarted(true)} save={saveRef.current} />;
  }

  return (
    <div className="fixed inset-0 bg-[#04070d] overflow-hidden select-none">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      />

      {state && (
        <HUD
          energy={state.energy}
          size={state.size}
          bestSize={state.bestSize}
          elementsEaten={saveRef.current.elementsEaten}
          buffs={state.buffs}
          freedom={state.freedom}
          mode={mode}
          onMode={toggleMode}
          onAchievements={() => setShowAch(true)}
        />
      )}

      <ExperimentToast exp={exp} />
      <FreedomBanner show={freedomBanner} />
      {pop && <ToastPop {...pop} />}

      {state?.phase === 'dead' && <DeathScreen size={state.size} onRestart={restart} />}
      {showAbility && state && (
        <AbilityMenu onClose={() => setShowAbility(false)} energy={state.energy} size={state.size} />
      )}
      {showAch && <AchievementsPanel list={achList} onClose={() => setShowAch(false)} />}

      <div className="absolute bottom-4 right-4 hud-panel px-3 py-2 text-[10px] font-mono text-white/40 max-w-[180px] leading-relaxed hidden sm:block">
        Веди слизевика курсором. Волны осязания открывают мир. Клик по голове — способности.
      </div>
    </div>
  );
};

const StartScreen = ({ onStart, save }: { onStart: () => void; save: Save }) => (
  <div className="fixed inset-0 bg-[#04070d] flex items-center justify-center overflow-hidden">
    <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at 50% 40%, #0c1a2c, #02050a)' }} />
    <div className="absolute inset-0 flex items-center justify-center">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="absolute rounded-full border border-[#5ff0e0]/15 animate-glow-pulse"
          style={{ width: 200 + i * 200, height: 200 + i * 200, animationDelay: i * 0.5 + 's' }}
        />
      ))}
    </div>

    <div className="relative text-center px-6 animate-fade-in">
      <div className="inline-flex items-center gap-2 mb-4 hud-panel px-4 py-1.5">
        <Icon name="FlaskConical" size={14} className="text-[#5ff0e0]" />
        <span className="font-mono text-[10px] tracking-[0.3em] uppercase text-[#5ff0e0]">Bio-Sim Protocol</span>
      </div>
      <h1 className="font-display font-black text-6xl md:text-8xl text-white mb-3 leading-none">
        SLIME<span className="text-[#5ff0e0] text-glow">LAB</span>
      </h1>
      <p className="text-white/60 max-w-md mx-auto mb-8 leading-relaxed">
        Ты — разумный слизевик в стеклянной пробирке. Осязай мир мерцающими волнами, поглощай элементы, расти и сбеги в гигантскую лабораторию.
      </p>

      <button
        onClick={onStart}
        className="group px-8 py-4 rounded-2xl font-display font-bold text-lg text-[#04070d] bg-[#5ff0e0] hover:bg-[#7ff5e8] transition-all hover:scale-105 inline-flex items-center gap-3"
        style={{ boxShadow: '0 0 40px rgba(95,240,224,0.4)' }}
      >
        <Icon name="Play" size={20} />
        Начать симуляцию
      </button>

      {save.bestSize > 0 && (
        <div className="mt-6 flex items-center justify-center gap-5 font-mono text-xs text-white/40">
          <span>Рекорд сети: <span className="text-[#5ff0e0]">{save.bestSize}</span></span>
          <span>Побегов: <span className="text-[#a8ffb0]">{save.escapes}</span></span>
          <span>Элементов: <span className="text-[#ffd166]">{save.elementsEaten}</span></span>
        </div>
      )}
    </div>
  </div>
);

export default Index;
