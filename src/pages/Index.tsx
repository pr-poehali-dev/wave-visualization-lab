import { useEffect, useRef, useState, useCallback } from 'react';
import { GameEngine3D, GameState } from '@/lib/game/engine3d';
import { ExperimentEvent, Achievement } from '@/lib/game/types';
import { ACHIEVEMENTS } from '@/lib/game/data';
import HUD from '@/components/game/HUD';
import {
  ExperimentToast,
  FreedomBanner,
  DeathScreen,
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
  const engineRef = useRef<GameEngine3D | null>(null);
  const saveRef = useRef<Save>(loadSave());

  const [started, setStarted] = useState(false);
  const [state, setState] = useState<GameState | null>(null);
  const [exp, setExp] = useState<ExperimentEvent | null>(null);
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
    const meta = ACHIEVEMENTS.find(a => a.id === id);
    if (meta) setPop({ text: 'Достижение: ' + meta.title, icon: 'Trophy', color: '#ffd166' });
    setTimeout(() => setPop(null), 2600);
  }, [persist]);

  const initEngine = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new GameEngine3D(canvas, {
      onState: (s) => {
        setState(s);
        if (s.bestSize > saveRef.current.bestSize) persist({ bestSize: s.bestSize });
        if (s.freedom && s.phase === 'world') {
          setFreedomBanner(prev => {
            if (!prev) setTimeout(() => setFreedomBanner(false), 3200);
            return true;
          });
        }
      },
      onEvent: (e) => {
        setExp(e);
        setTimeout(() => setExp(cur => cur === e ? null : cur), 4500);
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

  // клик/тап — аттрактант (куда расти)
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const eng = engineRef.current;
    if (!eng || eng.phase === 'dead') return;
    // правая кнопка и двухпальцевое нажатие — для OrbitControls, не трогаем
    if (e.button === 2) return;
    eng.setTargetFromScreen(e.clientX, e.clientY);
  }, []);

  const restart = () => {
    engineRef.current?.reset();
    setFreedomBanner(false);
    setExp(null);
  };

  const achList: Achievement[] = ACHIEVEMENTS.map(a => ({ ...a, unlocked: unlocked.includes(a.id) }));

  if (!started) {
    return <StartScreen onStart={() => setStarted(true)} save={saveRef.current} />;
  }

  return (
    <div className="fixed inset-0 bg-[#04070d] overflow-hidden select-none">
      {/* Three.js рендерит в этот canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full touch-none"
        onPointerDown={handlePointerDown}
      />

      {state && (
        <HUD
          energy={state.energy}
          size={state.size}
          bestSize={state.bestSize}
          elementsEaten={saveRef.current.elementsEaten}
          buffs={state.buffs}
          freedom={state.freedom}
          mode="follow"
          onMode={() => {}}
          onAchievements={() => setShowAch(true)}
        />
      )}

      <ExperimentToast exp={exp} />
      <FreedomBanner show={freedomBanner} />
      {pop && <ToastPop {...pop} />}

      {state?.phase === 'dead' && <DeathScreen size={state.size} onRestart={restart} />}
      {showAch && <AchievementsPanel list={achList} onClose={() => setShowAch(false)} />}

      {/* подсказка управления */}
      <div className="absolute bottom-4 right-4 hud-panel px-3 py-2.5 text-[10px] font-mono text-white/40 max-w-[200px] leading-relaxed">
        <div className="flex items-center gap-1.5 mb-1 text-white/60">
          <Icon name="MousePointer2" size={12} className="text-[#5ff0e0]" />
          <span className="text-[#5ff0e0]">Управление</span>
        </div>
        <div>• Клик — поставить аттрактант</div>
        <div>• ПКМ + тяни — вращение камеры</div>
        <div>• Скролл / щипок — зум</div>
        <div>• Волны открывают мир</div>
      </div>
    </div>
  );
};

const StartScreen = ({ onStart, save }: { onStart: () => void; save: Save }) => (
  <div className="fixed inset-0 bg-[#04070d] flex items-center justify-center overflow-hidden">
    <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at 50% 40%, #0c1a2c, #02050a)' }} />
    <div className="absolute inset-0 flex items-center justify-center">
      {[0, 1, 2].map(i => (
        <div key={i} className="absolute rounded-full border border-[#5ff0e0]/15 animate-glow-pulse"
          style={{ width: 200 + i * 200, height: 200 + i * 200, animationDelay: i * 0.5 + 's' }} />
      ))}
    </div>

    <div className="relative text-center px-6 animate-fade-in">
      <div className="inline-flex items-center gap-2 mb-4 hud-panel px-4 py-1.5">
        <Icon name="FlaskConical" size={14} className="text-[#5ff0e0]" />
        <span className="font-mono text-[10px] tracking-[0.3em] uppercase text-[#5ff0e0]">Physarum polycephalum</span>
      </div>
      <h1 className="font-display font-black text-6xl md:text-8xl text-white mb-2 leading-none">
        SLIME<span className="text-[#5ff0e0] text-glow">LAB</span>
      </h1>
      <p className="font-mono text-[11px] italic tracking-wider text-white/40 mb-5">
        многоголовый слизевик · 3D лаборатория · биологически точная модель
      </p>
      <p className="text-white/60 max-w-md mx-auto mb-8 leading-relaxed">
        Ты — <span className="text-white/90">Physarum polycephalum</span> на агаровой пластине. Кликай куда расти — псевдоподии тянутся туда через хемотаксис. Волны осязания открывают мир вокруг. Вращай камеру чтобы видеть пространство.
      </p>

      <button
        onClick={onStart}
        className="px-8 py-4 rounded-2xl font-display font-bold text-lg text-[#04070d] bg-[#5ff0e0] hover:bg-[#7ff5e8] transition-all hover:scale-105 inline-flex items-center gap-3"
        style={{ boxShadow: '0 0 40px rgba(95,240,224,0.4)' }}
      >
        <Icon name="Play" size={20} />
        Начать симуляцию
      </button>

      {save.bestSize > 0 && (
        <div className="mt-6 flex items-center justify-center gap-5 font-mono text-xs text-white/40">
          <span>Рекорд: <span className="text-[#5ff0e0]">{save.bestSize}</span></span>
          <span>Побегов: <span className="text-[#a8ffb0]">{save.escapes}</span></span>
          <span>Элементов: <span className="text-[#ffd166]">{save.elementsEaten}</span></span>
        </div>
      )}
    </div>
  </div>
);

export default Index;
