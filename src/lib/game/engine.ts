/**
 * Движок Physarum polycephalum
 *
 * Биологическая модель:
 * - Организм — граф веин (трубочек). Узлы — Junction. Рёбра — Vein.
 * - Протоплазма пульсирует по каждой вейне (закон Хаген-Пуазейля: Q = r⁴·ΔP).
 * - Радиус вейны растёт при высоком потоке, убывает при низком → сеть самооптимизируется.
 * - Рост: кончики-псевдоподии (Tip) случайно ветвятся в сторону источника питания.
 * - Ретракция: вейна с радиусом < порога удаляется.
 * - Нет «головы» — есть фронт роста (Tips) и пульсирующий поток.
 */

import { Wave, Food, Structure, Buff, GamePhase, ExperimentEvent } from './types';
import {
  ELEMENTS, BUFF_META, EXPERIMENTS, STRUCTURE_TYPES,
  ESCAPE_ENERGY, ESCAPE_SIZE,
} from './data';

// ─── граф ────────────────────────────────────────────────────────────────────

export interface Junction {
  id: number;
  x: number;
  y: number;
  pressure: number;
  nutrient: number;
}

export interface Vein {
  id: number;
  a: number;
  b: number;
  radius: number;
  flow: number;
  phase: number;
  age: number;
}

export interface Tip {
  id: number;
  junctionId: number;
  dx: number;
  dy: number;
  energy: number;
  len: number;
}

// ─── публичный state ──────────────────────────────────────────────────────────

export interface GameState {
  phase: GamePhase;
  energy: number;
  size: number;
  bestSize: number;
  elementsEaten: number;
  buffs: Buff[];
  experiment: ExperimentEvent | null;
  freedom: boolean;
}

export interface EngineCallbacks {
  onState: (s: GameState) => void;
  onEvent: (e: ExperimentEvent) => void;
  onAchievement: (id: string) => void;
  onElementEaten: (rare: boolean) => void;
}

// ─── константы ───────────────────────────────────────────────────────────────

const TUBE_HALF = 240;
const MIN_RADIUS = 0.6;
const MAX_RADIUS = 14;
const GROW_RATE = 0.30;
const DECAY_RATE = 0.13;
const RETRACT_R = 0.52;
const TIP_SPEED = 42;
const PULSE_FREQ = 1.4;
const MAX_TIPS = 30;
const MAX_VEINS = 1000;
const MAX_JUNCTIONS = 650;

let _id = 0;
const uid = () => ++_id;

export class GameEngine {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  cb: EngineCallbacks;

  W = 0; H = 0; dpr = 1;

  junctions = new Map<number, Junction>();
  veins = new Map<number, Vein>();
  tips: Tip[] = [];

  waves: Wave[] = [];
  foods: Food[] = [];
  structures: Structure[] = [];
  buffs: Buff[] = [];

  cam = { x: 0, y: 0, scale: 1 };
  target = { x: 0, y: 0 };

  phase: GamePhase = 'tube';
  energy = 72;
  freedom = false;
  elementsEaten = 0;
  bestSize = 0;

  worldSize = 5600;
  scratches: { x1: number; y1: number; x2: number; y2: number }[] = [];

  lastTime = 0;
  raf = 0;
  waveTimer = 0;
  experimentTimer = 0;
  foodTimer = 0;
  breakT = 0;
  running = false;
  experiment: ExperimentEvent | null = null;

  mode: 'follow' | 'target' = 'follow';
  pointer = { x: 0, y: 0, active: false };

  constructor(canvas: HTMLCanvasElement, cb: EngineCallbacks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.cb = cb;
    this.resize();
    this.reset();
  }

  // ─── инициализация ────────────────────────────────────────────────────────

  reset() {
    _id = 0;
    this.phase = 'tube';
    this.energy = 72;
    this.freedom = false;
    this.elementsEaten = 0;
    this.breakT = 0;
    this.buffs = [];
    this.waves = [];
    this.foods = [];
    this.structures = [];
    this.junctions.clear();
    this.veins.clear();
    this.tips = [];
    this.experiment = null;
    this.cam = { x: 0, y: 0, scale: 1 };
    this.target = { x: 0, y: 0 };
    this.waveTimer = 0;
    this.experimentTimer = 0;
    this.foodTimer = 0;

    this.seedNetwork();

    this.scratches = [];
    for (let i = 0; i < 14; i++) {
      const x1 = (Math.random() - 0.5) * TUBE_HALF * 1.7;
      const y1 = (Math.random() - 0.5) * TUBE_HALF * 1.7;
      const len = 20 + Math.random() * 70;
      const a = Math.random() * Math.PI;
      this.scratches.push({ x1, y1, x2: x1 + Math.cos(a) * len, y2: y1 + Math.sin(a) * len });
    }

    for (let i = 0; i < 4; i++) this.spawnPellet();
    this.pushState();
  }

  seedNetwork() {
    const center = this.addJunction(0, 0);
    const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const ring: number[] = [];
    for (const [dx, dy] of dirs) {
      const j = this.addJunction(dx * 24, dy * 24);
      ring.push(j);
      this.addVein(center, j, 4.5);
    }
    for (let i = 0; i < ring.length; i++) {
      this.addVein(ring[i], ring[(i + 1) % ring.length], 2.5);
    }
    for (let i = 0; i < ring.length; i++) {
      const j = this.junctions.get(ring[i])!;
      this.addTip(ring[i], j.x / 24, j.y / 24);
    }
  }

  addJunction(x: number, y: number): number {
    const id = uid();
    this.junctions.set(id, { id, x, y, pressure: Math.random(), nutrient: 0 });
    return id;
  }

  addVein(a: number, b: number, r = 2): number {
    const id = uid();
    this.veins.set(id, { id, a, b, radius: r, flow: 0, phase: Math.random() * Math.PI * 2, age: 0 });
    return id;
  }

  addTip(junctionId: number, dx: number, dy: number): Tip {
    const len = Math.hypot(dx, dy) || 1;
    const tip: Tip = { id: uid(), junctionId, dx: dx / len, dy: dy / len, energy: 1, len: 0 };
    this.tips.push(tip);
    return tip;
  }

  // ─── game loop ────────────────────────────────────────────────────────────

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    const loop = (t: number) => {
      if (!this.running) return;
      const dt = Math.min((t - this.lastTime) / 1000, 0.05);
      this.lastTime = t;
      this.update(dt, t);
      this.render(t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  // ─── update ───────────────────────────────────────────────────────────────

  update(dt: number, t: number) {
    if (this.phase === 'dead') return;

    this.updatePressures(t);
    this.updateVeins(dt, t);
    this.updateTips(dt, t);
    this.pruneDeadVeins();
    this.updateCamera(dt);

    // энергия
    let drain = 1.2;
    if (this.experiment?.label === 'Ускорение метаболизма') drain *= 2.2;
    if (this.hasBuff('regen')) drain = -3;
    this.energy -= drain * dt;
    this.energy = Math.max(0, Math.min(100, this.energy));

    if (this.energy <= 0 && this.phase !== 'dead') {
      this.phase = 'dead';
      this.pushState();
      return;
    }

    // волны осязания
    this.waveTimer -= dt;
    const waveInterval = this.hasBuff('range') ? 0.14 : 0.26;
    if (this.waveTimer <= 0) {
      this.waveTimer = waveInterval;
      this.emitWaves();
    }
    const waveRange = this.phase === 'tube' ? TUBE_HALF * 1.6 : 680;
    const waveSpeed = this.phase === 'tube' ? 180 : 320;
    for (const w of this.waves) {
      w.radius += waveSpeed * dt;
      w.life -= dt;
      w.flicker = 0.55 + Math.sin(t * 0.018 + w.x * 0.1) * 0.45;
    }
    this.waves = this.waves.filter(w => w.life > 0 && w.radius < waveRange);
    this.checkReveals();

    this.eatFood();

    // спавн еды
    this.foodTimer -= dt;
    if (this.phase === 'tube') {
      if (this.foodTimer <= 0 && this.foods.length < 6) {
        this.foodTimer = 4 + Math.random() * 5;
        this.spawnPellet();
      }
    } else if (this.phase === 'world') {
      if (this.foodTimer <= 0 && this.foods.length < 32) {
        this.foodTimer = 1 + Math.random() * 2;
        this.spawnElement();
      }
    }

    // эксперименты
    if (this.phase === 'tube') {
      this.experimentTimer -= dt;
      if (this.experimentTimer <= 0) {
        this.experimentTimer = 15 + Math.random() * 15;
        this.triggerExperiment(t);
      }
    }
    if (this.experiment && t - this.experiment.at > 5000) this.experiment = null;

    this.buffs = this.buffs.filter(b => b.until > t);
    for (const f of this.foods) f.pulse += 0.05;

    const size = this.junctions.size;
    if (this.phase === 'tube' && this.energy >= ESCAPE_ENERGY && size >= ESCAPE_SIZE) {
      this.startEscape();
    }
    if (this.phase === 'breaking') {
      this.breakT += dt;
      this.cam.scale += (1.2 - this.cam.scale) * Math.min(1, dt * 3);
      if (this.breakT > 1.8) {
        this.phase = 'world';
        this.freedom = true;
        this.generateWorld();
        this.cb.onAchievement('escape');
        this.pushState();
      }
    }

    if (size >= 500) this.cb.onAchievement('survive');
    if (size >= 1000) this.cb.onAchievement('size1000');

    if (Math.floor(t / 180) !== Math.floor((t - dt * 1000) / 180)) this.pushState();
  }

  // ─── Physarum: давление → поток (Хаген-Пуазейль) ────────────────────────

  updatePressures(t: number) {
    const pulse = Math.sin(t * PULSE_FREQ * Math.PI * 2);
    const pressure = new Map<number, number>();

    for (const [id, j] of this.junctions) {
      const dx = this.target.x - j.x;
      const dy = this.target.y - j.y;
      const dist = Math.hypot(dx, dy) + 1;
      // давление выше ближе к цели + питательный сигнал + пульс
      pressure.set(id, 1.2 / dist + pulse * 0.12 + j.nutrient * 0.4);
    }

    for (const [, v] of this.veins) {
      const pa = pressure.get(v.a) ?? 0;
      const pb = pressure.get(v.b) ?? 0;
      // Q = r⁴ · ΔP  (Hagen-Poiseuille)
      v.flow = Math.pow(v.radius, 4) * (pa - pb);
    }

    for (const [id, j] of this.junctions) j.pressure = pressure.get(id) ?? 0;
  }

  updateVeins(dt: number, _t: number) {
    for (const [, v] of this.veins) {
      v.age += dt;
      v.phase += PULSE_FREQ * Math.PI * 2 * dt;
      const absFlow = Math.abs(v.flow);

      let targetR: number;
      if (absFlow > 0.0003) {
        targetR = Math.min(MAX_RADIUS, v.radius + GROW_RATE * dt * (absFlow * 400));
      } else {
        targetR = Math.max(RETRACT_R, v.radius - DECAY_RATE * dt);
      }

      if (this.hasBuff('growth')) {
        v.radius = Math.min(MAX_RADIUS, v.radius + 1.8 * dt);
      } else {
        v.radius += (targetR - v.radius) * Math.min(1, dt * 2.2);
      }
    }
  }

  updateTips(dt: number, _t: number) {
    const speed = this.hasBuff('speed') ? TIP_SPEED * 1.9 : TIP_SPEED;
    const slowdown = this.experiment?.label === 'Криозаморозка' ? 0.35 : 1;
    const foods = this.foods.filter(f => f.revealed);

    for (let i = this.tips.length - 1; i >= 0; i--) {
      const tip = this.tips[i];
      const junc = this.junctions.get(tip.junctionId);
      if (!junc) { this.tips.splice(i, 1); continue; }

      // хемотаксис: к цели (курсор)
      let ax = this.target.x - junc.x;
      let ay = this.target.y - junc.y;
      const tDist = Math.hypot(ax, ay) || 1;
      ax /= tDist; ay /= tDist;

      // дополнительно: к ближайшей открытой еде
      for (const f of foods) {
        const fd = Math.hypot(f.x - junc.x, f.y - junc.y);
        if (fd < 350) {
          ax += (f.x - junc.x) / fd * 1.6;
          ay += (f.y - junc.y) / fd * 1.6;
        }
      }
      const aLen = Math.hypot(ax, ay) || 1;
      ax /= aLen; ay /= aLen;

      // случайный дрейф псевдоподии
      const drift = 0.38;
      tip.dx += ax * 0.14 + (Math.random() - 0.5) * drift;
      tip.dy += ay * 0.14 + (Math.random() - 0.5) * drift;
      const tl = Math.hypot(tip.dx, tip.dy) || 1;
      tip.dx /= tl; tip.dy /= tl;

      const nx = junc.x + tip.dx * speed * slowdown * dt;
      const ny = junc.y + tip.dy * speed * slowdown * dt;

      // отражение от стенок пробирки
      if (this.phase === 'tube') {
        if (Math.abs(nx) > TUBE_HALF - 8) tip.dx *= -1;
        if (Math.abs(ny) > TUBE_HALF - 8) tip.dy *= -1;
        if (Math.abs(nx) > TUBE_HALF - 8 || Math.abs(ny) > TUBE_HALF - 8) continue;
      }

      tip.len += speed * slowdown * dt;

      // каждые 18px — новый Junction + Vein (рост сети)
      if (tip.len > 18 && this.junctions.size < MAX_JUNCTIONS && this.veins.size < MAX_VEINS) {
        tip.len = 0;
        const newJ = this.addJunction(nx, ny);
        this.addVein(tip.junctionId, newJ, 1.6 + Math.random() * 0.8);
        tip.junctionId = newJ;

        // ветвление
        const branchProb = this.hasBuff('growth') ? 0.30 : 0.13;
        if (this.tips.length < MAX_TIPS && Math.random() < branchProb) {
          const angle = (Math.random() - 0.5) * Math.PI * 0.75;
          const cos = Math.cos(angle), sin = Math.sin(angle);
          this.addTip(newJ,
            tip.dx * cos - tip.dy * sin,
            tip.dx * sin + tip.dy * cos
          );
        }
      } else {
        junc.x = nx;
        junc.y = ny;
      }

      if (this.energy < 12) tip.energy -= dt * 0.5;
      if (tip.energy <= 0) this.tips.splice(i, 1);
    }

    // держим минимум 2 кончика
    if (this.tips.length < 2 && this.junctions.size > 0) {
      const jArr = [...this.junctions.values()];
      const j = jArr[Math.floor(Math.random() * jArr.length)];
      this.addTip(j.id, Math.random() - 0.5, Math.random() - 0.5);
    }
  }

  pruneDeadVeins() {
    for (const [id, v] of this.veins) {
      if (v.radius < RETRACT_R && v.age > 1.8) {
        this.veins.delete(id);
        this.pruneJunction(v.a);
        this.pruneJunction(v.b);
      }
    }
  }

  pruneJunction(jId: number) {
    for (const [, v] of this.veins) {
      if (v.a === jId || v.b === jId) return;
    }
    if (this.tips.some(t => t.junctionId === jId)) return;
    this.junctions.delete(jId);
  }

  // ─── камера ───────────────────────────────────────────────────────────────

  updateCamera(dt: number) {
    const centroid = this.getCentroid();
    const targetScale = this.phase === 'tube'
      ? Math.min(this.W, this.H) / ((TUBE_HALF + 80) * 2)
      : Math.min(1.6, Math.max(0.35, 260 / (this.getSpread() + 1)));
    this.cam.scale += (targetScale - this.cam.scale) * Math.min(1, dt * 3);
    this.cam.x += (centroid.x - this.cam.x) * Math.min(1, dt * 4);
    this.cam.y += (centroid.y - this.cam.y) * Math.min(1, dt * 4);
  }

  getCentroid() {
    if (this.junctions.size === 0) return { x: 0, y: 0 };
    let sx = 0, sy = 0;
    for (const [, j] of this.junctions) { sx += j.x; sy += j.y; }
    return { x: sx / this.junctions.size, y: sy / this.junctions.size };
  }

  getSpread() {
    if (this.junctions.size < 2) return 100;
    let mx = -Infinity, mn = Infinity, my = -Infinity, mny = Infinity;
    for (const [, j] of this.junctions) {
      mx = Math.max(mx, j.x); mn = Math.min(mn, j.x);
      my = Math.max(my, j.y); mny = Math.min(mny, j.y);
    }
    return Math.max(mx - mn, my - mny);
  }

  // «голова» для HUD = центроид фронта псевдоподий
  head() {
    if (this.tips.length === 0) return this.getCentroid();
    let sx = 0, sy = 0;
    for (const tip of this.tips) {
      const j = this.junctions.get(tip.junctionId);
      if (j) { sx += j.x; sy += j.y; }
    }
    return { x: sx / this.tips.length, y: sy / this.tips.length };
  }

  // ─── управление ───────────────────────────────────────────────────────────

  setPointer(sx: number, sy: number, active: boolean) {
    this.pointer = { x: sx, y: sy, active };
    const w = this.screenToWorld(sx, sy);
    this.target.x = w.x;
    this.target.y = w.y;
  }

  setTarget(sx: number, sy: number) {
    const w = this.screenToWorld(sx, sy);
    this.target.x = w.x;
    this.target.y = w.y;
  }

  screenToWorld(sx: number, sy: number) {
    return {
      x: (sx - this.W / 2) / this.cam.scale + this.cam.x,
      y: (sy - this.H / 2) / this.cam.scale + this.cam.y,
    };
  }

  // ─── баффы ────────────────────────────────────────────────────────────────

  hasBuff(t: Buff['type']) { return this.buffs.some(b => b.type === t); }

  addBuff(type: Buff['type']) {
    const m = BUFF_META[type];
    const until = performance.now() + m.ms;
    const ex = this.buffs.find(b => b.type === type);
    if (ex) ex.until = until;
    else this.buffs.push({ type, label: m.label, icon: m.icon, color: m.color, until });
  }

  // ─── еда ──────────────────────────────────────────────────────────────────

  spawnPellet() {
    const h = TUBE_HALF - 22;
    this.foods.push({
      x: (Math.random() - 0.5) * h * 2, y: (Math.random() - 0.5) * h * 2,
      kind: 'pellet', revealed: false, reveal: 0, pulse: Math.random() * Math.PI * 2,
    });
  }

  spawnElement() {
    const c = this.getCentroid();
    const ang = Math.random() * Math.PI * 2;
    const dist = 350 + Math.random() * 1200;
    const x = c.x + Math.cos(ang) * dist;
    const y = c.y + Math.sin(ang) * dist;
    const b = this.worldSize / 2;
    if (Math.abs(x) > b || Math.abs(y) > b) return;
    const pool = ELEMENTS.filter(e => e.rare ? Math.random() < 0.15 : true);
    const el = pool[Math.floor(Math.random() * pool.length)];
    this.foods.push({ x, y, kind: 'element', element: el, revealed: false, reveal: 0, pulse: Math.random() * Math.PI * 2 });
  }

  eatFood() {
    const eatR = 20 + Math.min(22, this.junctions.size * 0.035);
    for (let i = this.foods.length - 1; i >= 0; i--) {
      const f = this.foods[i];
      let minD = Infinity;
      let nearestJ: Junction | null = null;
      for (const [, j] of this.junctions) {
        const d = Math.hypot(f.x - j.x, f.y - j.y);
        if (d < minD) { minD = d; nearestJ = j; }
      }
      if (minD < eatR && nearestJ) {
        if (f.kind === 'pellet') {
          this.energy = Math.min(100, this.energy + 10);
          this.burstGrowth(f.x, f.y, 7);
        } else if (f.element) {
          this.energy = Math.min(100, this.energy + (f.element.rare ? 24 : 12));
          this.burstGrowth(f.x, f.y, f.element.rare ? 16 : 7);
          this.addBuff(f.element.buff);
          for (const [, j] of this.junctions) {
            j.nutrient = Math.min(1, j.nutrient + 0.18 / (1 + Math.hypot(f.x - j.x, f.y - j.y) / 180));
          }
          this.elementsEaten++;
          this.cb.onElementEaten(f.element.rare);
          if (f.element.rare) this.cb.onAchievement('rare');
          if (this.elementsEaten >= 50) this.cb.onAchievement('eat50');
        }
        this.foods.splice(i, 1);
      }
    }
  }

  burstGrowth(fx: number, fy: number, count: number) {
    let bestJ: Junction | null = null;
    let bestD = Infinity;
    for (const [, j] of this.junctions) {
      const d = Math.hypot(fx - j.x, fy - j.y);
      if (d < bestD) { bestD = d; bestJ = j; }
    }
    if (!bestJ) return;
    for (let i = 0; i < count && this.tips.length < MAX_TIPS; i++) {
      const a = (i / count) * Math.PI * 2;
      this.addTip(bestJ.id, Math.cos(a), Math.sin(a));
    }
    for (const [, v] of this.veins) {
      const ja = this.junctions.get(v.a), jb = this.junctions.get(v.b);
      if (!ja || !jb) continue;
      const d = Math.hypot((ja.x + jb.x) / 2 - fx, (ja.y + jb.y) / 2 - fy);
      if (d < 130) v.radius = Math.min(MAX_RADIUS, v.radius + 2.2);
    }
  }

  // ─── волны / reveal ───────────────────────────────────────────────────────

  emitWaves() {
    const jArr = [...this.junctions.values()];
    const step = Math.max(1, Math.floor(jArr.length / 18));
    for (let i = 0; i < jArr.length; i += step) {
      const j = jArr[i];
      this.waves.push({ x: j.x, y: j.y, radius: 3, maxRadius: 500, life: 1.8, flicker: 1 });
    }
  }

  checkReveals() {
    for (const w of this.waves) {
      for (const f of this.foods) {
        if (f.revealed) continue;
        if (Math.abs(Math.hypot(f.x - w.x, f.y - w.y) - w.radius) < 16) f.revealed = true;
      }
      for (const s of this.structures) {
        if (s.revealed) continue;
        const cx = Math.max(s.x - s.w / 2, Math.min(w.x, s.x + s.w / 2));
        const cy = Math.max(s.y - s.h / 2, Math.min(w.y, s.y + s.h / 2));
        if (Math.abs(Math.hypot(cx - w.x, cy - w.y) - w.radius) < 32) s.revealed = true;
      }
    }
    for (const f of this.foods) if (f.revealed) f.reveal = Math.min(1, f.reveal + 0.04);
    for (const s of this.structures) if (s.revealed) s.reveal = Math.min(1, s.reveal + 0.025);
  }

  // ─── эксперименты ─────────────────────────────────────────────────────────

  triggerExperiment(t: number) {
    const e = EXPERIMENTS[Math.floor(Math.random() * EXPERIMENTS.length)];
    this.experiment = { ...e, at: t };
    this.cb.onEvent({ ...e, at: t });
    if (e.label === 'Энергетический разряд') this.energy = Math.max(0, this.energy - 18);
    if (e.label === 'Споровый выброс') this.addBuff('spore');
    if (e.label === 'Усиление сенсоров') this.addBuff('range');
  }

  startEscape() {
    this.phase = 'breaking';
    this.breakT = 0;
    this.foods = [];
    this.experiment = null;
    this.pushState();
  }

  generateWorld() {
    this.structures = [];
    const bounds = this.worldSize / 2 - 400;
    let attempts = 0;
    while (this.structures.length < 56 && attempts < 5000) {
      attempts++;
      const t = STRUCTURE_TYPES[Math.floor(Math.random() * STRUCTURE_TYPES.length)];
      const w = 130 + Math.random() * 200;
      const h = 130 + Math.random() * 200;
      const x = (Math.random() - 0.5) * bounds * 2;
      const y = (Math.random() - 0.5) * bounds * 2;
      if (Math.abs(x) < 500 && Math.abs(y) < 500) continue;
      let overlap = false;
      for (const s of this.structures) {
        if (Math.abs(s.x - x) < (s.w + w) / 2 + 60 && Math.abs(s.y - y) < (s.h + h) / 2 + 60) {
          overlap = true; break;
        }
      }
      if (overlap) continue;
      this.structures.push({
        x, y, w, h, type: t.type,
        label: t.label + ' #' + (this.structures.length + 1),
        revealed: false, reveal: 0, seed: Math.random() * 1000,
      });
    }
  }

  pushState() {
    this.bestSize = Math.max(this.bestSize, this.junctions.size);
    this.cb.onState({
      phase: this.phase,
      energy: this.energy,
      size: this.junctions.size,
      bestSize: this.bestSize,
      elementsEaten: this.elementsEaten,
      buffs: [...this.buffs],
      experiment: this.experiment,
      freedom: this.freedom,
    });
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = this.canvas.clientWidth;
    this.H = this.canvas.clientHeight;
    this.canvas.width = this.W * this.dpr;
    this.canvas.height = this.H * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  // ─── RENDER ───────────────────────────────────────────────────────────────

  render(t: number) {
    const ctx = this.ctx;
    ctx.fillStyle = '#04070d';
    ctx.fillRect(0, 0, this.W, this.H);
    this.drawBackground();

    ctx.save();
    ctx.translate(this.W / 2, this.H / 2);
    ctx.scale(this.cam.scale, this.cam.scale);
    ctx.translate(-this.cam.x, -this.cam.y);

    if (this.phase === 'world' || this.phase === 'breaking') this.drawStructures();
    this.drawWaves();
    this.drawFoods();
    this.drawPhysarum(t);
    if (this.phase === 'tube' || this.phase === 'breaking') this.drawTube(t);

    ctx.restore();
  }

  drawBackground() {
    const ctx = this.ctx;
    const g = ctx.createRadialGradient(this.W / 2, this.H / 2, 0, this.W / 2, this.H / 2, Math.max(this.W, this.H) * 0.85);
    g.addColorStop(0, '#071220');
    g.addColorStop(1, '#02050a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.H);

    ctx.strokeStyle = 'rgba(50,100,140,0.04)';
    ctx.lineWidth = 1;
    const gs = 56 * this.cam.scale;
    const ox = ((-this.cam.x * this.cam.scale) % gs + this.W / 2) % gs;
    const oy = ((-this.cam.y * this.cam.scale) % gs + this.H / 2) % gs;
    ctx.beginPath();
    for (let x = ox; x < this.W; x += gs) { ctx.moveTo(x, 0); ctx.lineTo(x, this.H); }
    for (let y = oy; y < this.H; y += gs) { ctx.moveTo(0, y); ctx.lineTo(this.W, y); }
    ctx.stroke();
  }

  drawPhysarum(t: number) {
    const ctx = this.ctx;
    const mega = this.hasBuff('mega');

    // ── трубочки-вейны с пульсирующим потоком ──
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const [, v] of this.veins) {
      const ja = this.junctions.get(v.a);
      const jb = this.junctions.get(v.b);
      if (!ja || !jb) continue;

      const r = Math.max(0.4, v.radius);
      const pulse = 0.70 + Math.sin(v.phase + t * PULSE_FREQ * Math.PI * 2) * 0.30;
      const alpha = Math.min(1, r / 4.5) * pulse;

      // настоящий физарум — жёлто-охристый
      const hueOut = mega ? '255,200,55' : '185,225,75';
      const hueCore = mega ? '255,245,130' : '230,255,150';

      // свечение
      ctx.globalAlpha = alpha * 0.28;
      ctx.strokeStyle = `rgba(${hueOut},0.7)`;
      ctx.lineWidth = r * 3.0;
      ctx.beginPath(); ctx.moveTo(ja.x, ja.y); ctx.lineTo(jb.x, jb.y); ctx.stroke();

      // тело
      ctx.globalAlpha = alpha * 0.88;
      ctx.strokeStyle = `rgba(${hueOut},1)`;
      ctx.lineWidth = r * 1.5;
      ctx.stroke();

      // поток — яркая центральная жилка
      if (r > 1.4) {
        const flowAlpha = Math.min(0.95, Math.abs(v.flow) * 900) * pulse;
        ctx.globalAlpha = flowAlpha * alpha;
        ctx.strokeStyle = `rgba(${hueCore},1)`;
        ctx.lineWidth = r * 0.52;
        ctx.stroke();

        // бегущая капля протоплазмы вдоль вейны
        if (r > 3 && Math.abs(v.flow) > 0.0001) {
          const dropPos = ((t * 0.6 * Math.sign(v.flow)) % 1 + 1) % 1;
          const dx = jb.x - ja.x, dy = jb.y - ja.y;
          const dpx = ja.x + dx * dropPos, dpy = ja.y + dy * dropPos;
          ctx.globalAlpha = pulse * 0.8;
          ctx.fillStyle = `rgba(${hueCore},1)`;
          ctx.beginPath();
          ctx.arc(dpx, dpy, r * 0.7, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();

    // ── кончики-псевдоподии (фронт роста) ──
    for (const tip of this.tips) {
      const j = this.junctions.get(tip.junctionId);
      if (!j) continue;
      const pulse = 0.65 + Math.sin(t * 3.8 + tip.id * 0.7) * 0.35;
      ctx.save();
      ctx.globalAlpha = tip.energy * pulse;
      ctx.shadowColor = mega ? '#ffd700' : '#c8ff60';
      ctx.shadowBlur = 14;
      ctx.fillStyle = mega ? '#ffe07a' : '#ccff5a';
      ctx.beginPath();
      ctx.arc(j.x, j.y, 5.5, 0, Math.PI * 2);
      ctx.fill();
      // стрелка направления роста
      ctx.globalAlpha = tip.energy * pulse * 0.55;
      ctx.strokeStyle = mega ? '#ffd060' : '#b8ff40';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(j.x, j.y);
      ctx.lineTo(j.x + tip.dx * 12, j.y + tip.dy * 12);
      ctx.stroke();
      ctx.restore();
    }

    // ── узлы-развилки ──
    for (const [, j] of this.junctions) {
      let degree = 0;
      for (const [, v] of this.veins) if (v.a === j.id || v.b === j.id) degree++;
      if (degree < 3) continue;
      ctx.save();
      ctx.globalAlpha = 0.72;
      ctx.fillStyle = mega ? 'rgba(255,210,80,0.9)' : 'rgba(210,255,100,0.9)';
      ctx.shadowColor = mega ? '#ffd700' : '#90ff20';
      ctx.shadowBlur = 7;
      ctx.beginPath();
      ctx.arc(j.x, j.y, Math.min(3.8, 0.8 + degree * 0.55), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  drawWaves() {
    const ctx = this.ctx;
    ctx.lineWidth = 1.2 / this.cam.scale;
    for (const w of this.waves) {
      const alpha = (w.life / 1.8) * 0.26 * w.flicker;
      ctx.strokeStyle = `rgba(200,245,255,${alpha})`;
      ctx.beginPath();
      ctx.arc(w.x, w.y, w.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  drawFoods() {
    const ctx = this.ctx;
    for (const f of this.foods) {
      if (!f.revealed) continue;
      const pulse = 0.6 + Math.sin(f.pulse) * 0.4;
      if (f.kind === 'pellet') {
        ctx.fillStyle = `rgba(180,255,160,${f.reveal})`;
        ctx.shadowColor = '#a8ffb0'; ctx.shadowBlur = 10 * pulse * f.reveal;
        ctx.beginPath(); ctx.arc(f.x, f.y, 5, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      } else if (f.element) {
        const r = f.element.rare ? 16 : 12;
        ctx.shadowColor = f.element.color;
        ctx.shadowBlur = (f.element.rare ? 28 : 14) * pulse * f.reveal;
        ctx.fillStyle = f.element.color;
        ctx.globalAlpha = f.reveal;
        ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#04070d';
        ctx.font = `bold ${r}px JetBrains Mono`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(f.element.symbol, f.x, f.y + 1);
        ctx.globalAlpha = 1;
      }
    }
  }

  drawTube(t: number) {
    const ctx = this.ctx;
    const half = TUBE_HALF;
    const s = half * 2;
    let crackAlpha = 0;
    if (this.phase === 'breaking') crackAlpha = Math.min(1, this.breakT / 0.7);

    ctx.fillStyle = 'rgba(100,190,255,0.03)';
    ctx.fillRect(-half, -half, s, s);

    ctx.lineWidth = 5 / this.cam.scale;
    ctx.strokeStyle = `rgba(140,210,255,${0.55 - crackAlpha * 0.45})`;
    ctx.shadowColor = '#5ff0e0'; ctx.shadowBlur = 14;
    ctx.strokeRect(-half, -half, s, s);
    ctx.shadowBlur = 0;

    ctx.lineWidth = 1.5 / this.cam.scale;
    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    ctx.strokeRect(-half + 7, -half + 7, s - 14, s - 14);

    const g = ctx.createLinearGradient(-half, -half, half, half);
    g.addColorStop(0, 'rgba(255,255,255,0.10)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.01)');
    g.addColorStop(1, 'rgba(255,255,255,0.04)');
    ctx.fillStyle = g; ctx.fillRect(-half, -half, s * 0.22, s);

    ctx.strokeStyle = 'rgba(220,240,255,0.09)';
    ctx.lineWidth = 1 / this.cam.scale;
    ctx.beginPath();
    for (const sc of this.scratches) { ctx.moveTo(sc.x1, sc.y1); ctx.lineTo(sc.x2, sc.y2); }
    ctx.stroke();

    if (this.phase === 'breaking') {
      ctx.strokeStyle = `rgba(255,255,255,${crackAlpha})`;
      ctx.lineWidth = 2 / this.cam.scale;
      ctx.shadowColor = '#fff'; ctx.shadowBlur = 12;
      const c = this.getCentroid();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(c.x, c.y);
        let px = c.x, py = c.y;
        for (let j = 0; j < 5; j++) {
          px += Math.cos(a + (Math.random() - 0.5) * 0.8) * 46 * this.breakT;
          py += Math.sin(a + (Math.random() - 0.5) * 0.8) * 46 * this.breakT;
          ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }
  }

  drawStructures() {
    const ctx = this.ctx;
    for (const s of this.structures) {
      if (s.reveal <= 0) continue;
      ctx.save();
      ctx.globalAlpha = s.reveal;
      ctx.translate(s.x, s.y);
      ctx.shadowColor = '#5ff0e0'; ctx.shadowBlur = 12 * s.reveal;
      ctx.strokeStyle = '#9fe8ff'; ctx.fillStyle = 'rgba(50,120,170,0.1)'; ctx.lineWidth = 2;
      this.drawStructureShape(s);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = s.reveal * 0.85;
      ctx.fillStyle = '#cfeeff';
      ctx.font = '13px JetBrains Mono';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(s.label, 0, s.h / 2 + 8);
      ctx.restore();
    }
  }

  drawStructureShape(s: Structure) {
    const ctx = this.ctx;
    const hw = s.w / 2, hh = s.h / 2;
    ctx.beginPath(); ctx.rect(-hw, -hh, s.w, s.h); ctx.fill(); ctx.stroke();
    switch (s.type) {
      case 'centrifuge':
        ctx.beginPath(); ctx.arc(0, 0, Math.min(hw, hh) * 0.65, 0, Math.PI * 2); ctx.stroke();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + s.seed;
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * hw * 0.55, Math.sin(a) * hh * 0.55); ctx.stroke();
        }
        break;
      case 'chromatograph':
        for (let i = 0; i < 5; i++) {
          const x = -hw + (i + 0.5) * (s.w / 5);
          ctx.beginPath(); ctx.moveTo(x, -hh + 8); ctx.lineTo(x, hh - 8); ctx.stroke();
        }
        break;
      case 'cryo':
        for (let i = 0; i < 4; i++) {
          ctx.beginPath(); ctx.moveTo(-hw + 6, -hh + (i + 1) * (s.h / 5)); ctx.lineTo(hw - 6, -hh + (i + 1) * (s.h / 5)); ctx.stroke();
        }
        break;
      case 'rack':
        for (let i = 0; i < 6; i++) {
          const x = -hw + (i + 0.5) * (s.w / 6);
          ctx.beginPath(); ctx.arc(x, hh * 0.3, 4, 0, Math.PI * 2); ctx.moveTo(x, hh * 0.3); ctx.lineTo(x, -hh + 8); ctx.stroke();
        }
        break;
      case 'microscope':
        ctx.beginPath(); ctx.arc(0, -hh * 0.3, hw * 0.25, 0, Math.PI * 2); ctx.moveTo(0, -hh * 0.3); ctx.lineTo(hw * 0.4, hh * 0.5); ctx.stroke();
        break;
      case 'reactor':
        ctx.beginPath(); ctx.arc(0, 0, Math.min(hw, hh) * 0.55, 0, Math.PI * 2); ctx.arc(0, 0, Math.min(hw, hh) * 0.3, 0, Math.PI * 2); ctx.stroke();
        break;
      default:
        ctx.beginPath(); ctx.moveTo(-hw + 8, 0); ctx.lineTo(hw - 8, 0); ctx.moveTo(0, -hh + 8); ctx.lineTo(0, hh - 8); ctx.stroke();
    }
  }
}
