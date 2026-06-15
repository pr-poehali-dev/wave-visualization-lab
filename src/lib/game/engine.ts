import {
  Node,
  Wave,
  Food,
  Structure,
  Buff,
  GamePhase,
  ExperimentEvent,
} from './types';
import {
  ELEMENTS,
  BUFF_META,
  EXPERIMENTS,
  STRUCTURE_TYPES,
  ESCAPE_ENERGY,
  ESCAPE_SIZE,
  MAX_NODES,
} from './data';

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

const TUBE_SIZE = 520;

export class GameEngine {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  cb: EngineCallbacks;

  W = 0;
  H = 0;
  dpr = 1;

  nodes: Node[] = [];
  waves: Wave[] = [];
  foods: Food[] = [];
  structures: Structure[] = [];
  buffs: Buff[] = [];

  cam = { x: 0, y: 0, scale: 1 };
  target = { x: 0, y: 0 };
  pointer = { x: 0, y: 0, active: false };
  mode: 'follow' | 'target' = 'follow';

  phase: GamePhase = 'tube';
  energy = 70;
  growth = 0;
  freedom = false;
  elementsEaten = 0;
  bestSize = 0;

  worldSize = 6000;
  tube = { x: 0, y: 0, size: TUBE_SIZE };

  lastTime = 0;
  raf = 0;
  waveTimer = 0;
  experimentTimer = 0;
  foodTimer = 0;
  breakT = 0;
  running = false;

  scratches: { x1: number; y1: number; x2: number; y2: number }[] = [];

  constructor(canvas: HTMLCanvasElement, cb: EngineCallbacks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.cb = cb;
    this.resize();
    this.reset();
  }

  reset() {
    this.phase = 'tube';
    this.energy = 70;
    this.freedom = false;
    this.elementsEaten = 0;
    this.growth = 0;
    this.breakT = 0;
    this.buffs = [];
    this.waves = [];
    this.foods = [];
    this.structures = [];
    this.tube = { x: 0, y: 0, size: TUBE_SIZE };
    this.cam = { x: 0, y: 0, scale: 1 };
    this.target = { x: 0, y: 0 };

    this.nodes = [];
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 40;
      this.nodes.push({
        x: Math.cos(a) * r,
        y: Math.sin(a) * r,
        vx: 0,
        vy: 0,
        age: Math.random(),
        parent: 0,
      });
    }

    this.scratches = [];
    for (let i = 0; i < 14; i++) {
      const x1 = (Math.random() - 0.5) * TUBE_SIZE * 0.9;
      const y1 = (Math.random() - 0.5) * TUBE_SIZE * 0.9;
      const len = 20 + Math.random() * 60;
      const a = Math.random() * Math.PI;
      this.scratches.push({
        x1,
        y1,
        x2: x1 + Math.cos(a) * len,
        y2: y1 + Math.sin(a) * len,
      });
    }

    for (let i = 0; i < 5; i++) this.spawnPellet();
    this.pushState();
  }

  spawnPellet() {
    const h = this.tube.size / 2 - 20;
    this.foods.push({
      x: (Math.random() - 0.5) * h * 2,
      y: (Math.random() - 0.5) * h * 2,
      kind: 'pellet',
      revealed: false,
      reveal: 0,
      pulse: Math.random() * Math.PI * 2,
    });
  }

  spawnElement() {
    const head = this.head();
    const ang = Math.random() * Math.PI * 2;
    const dist = 400 + Math.random() * 1400;
    const x = head.x + Math.cos(ang) * dist;
    const y = head.y + Math.sin(ang) * dist;
    const bounds = this.worldSize / 2;
    if (Math.abs(x) > bounds || Math.abs(y) > bounds) return;
    const pool = ELEMENTS.filter((e) => (e.rare ? Math.random() < 0.12 : true));
    const el = pool[Math.floor(Math.random() * pool.length)];
    this.foods.push({
      x,
      y,
      kind: 'element',
      element: el,
      revealed: false,
      reveal: 0,
      pulse: Math.random() * Math.PI * 2,
    });
  }

  generateWorld() {
    this.structures = [];
    const bounds = this.worldSize / 2 - 400;
    let attempts = 0;
    while (this.structures.length < 56 && attempts < 4000) {
      attempts++;
      const t = STRUCTURE_TYPES[Math.floor(Math.random() * STRUCTURE_TYPES.length)];
      const w = 120 + Math.random() * 220;
      const h = 120 + Math.random() * 220;
      const x = (Math.random() - 0.5) * bounds * 2;
      const y = (Math.random() - 0.5) * bounds * 2;
      if (Math.abs(x) < 500 && Math.abs(y) < 500) continue;
      let overlap = false;
      for (const s of this.structures) {
        if (
          Math.abs(s.x - x) < (s.w + w) / 2 + 60 &&
          Math.abs(s.y - y) < (s.h + h) / 2 + 60
        ) {
          overlap = true;
          break;
        }
      }
      if (overlap) continue;
      this.structures.push({
        x,
        y,
        w,
        h,
        type: t.type,
        label: t.label + ' #' + (this.structures.length + 1),
        revealed: false,
        reveal: 0,
        seed: Math.random() * 1000,
      });
    }
  }

  head(): Node {
    return this.nodes[this.nodes.length - 1] || { x: 0, y: 0, vx: 0, vy: 0, age: 0, parent: 0 };
  }

  hasBuff(t: Buff['type']) {
    return this.buffs.some((b) => b.type === t);
  }

  addBuff(type: Buff['type']) {
    const m = BUFF_META[type];
    const existing = this.buffs.find((b) => b.type === type);
    const until = performance.now() + m.ms;
    if (existing) existing.until = until;
    else this.buffs.push({ type, label: m.label, icon: m.icon, color: m.color, until });
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = this.canvas.clientWidth;
    this.H = this.canvas.clientHeight;
    this.canvas.width = this.W * this.dpr;
    this.canvas.height = this.H * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  screenToWorld(sx: number, sy: number) {
    return {
      x: (sx - this.W / 2) / this.cam.scale + this.cam.x,
      y: (sy - this.H / 2) / this.cam.scale + this.cam.y,
    };
  }

  setPointer(sx: number, sy: number, active: boolean) {
    this.pointer.active = active;
    const w = this.screenToWorld(sx, sy);
    this.pointer.x = w.x;
    this.pointer.y = w.y;
    if (this.mode === 'follow' && active) {
      this.target.x = w.x;
      this.target.y = w.y;
    }
  }

  setTarget(sx: number, sy: number) {
    const w = this.screenToWorld(sx, sy);
    this.target.x = w.x;
    this.target.y = w.y;
  }

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

  pushState() {
    this.bestSize = Math.max(this.bestSize, this.nodes.length);
    this.cb.onState({
      phase: this.phase,
      energy: this.energy,
      size: this.nodes.length,
      bestSize: this.bestSize,
      elementsEaten: this.elementsEaten,
      buffs: [...this.buffs],
      experiment: null,
      freedom: this.freedom,
    });
  }

  update(dt: number, t: number) {
    if (this.phase === 'dead') return;

    const head = this.head();

    // movement
    if (this.mode === 'follow' && !this.pointer.active && this.phase !== 'tube') {
      // drift
    }
    const dx = this.target.x - head.x;
    const dy = this.target.y - head.y;
    const dist = Math.hypot(dx, dy) || 1;
    let speed = 150 + this.nodes.length * 0.05;
    if (this.hasBuff('speed')) speed *= 1.7;
    if (this.experiment?.label === 'Криозаморозка') speed *= 0.5;
    if (dist > 4) {
      head.vx += (dx / dist) * speed * dt * 6;
      head.vy += (dy / dist) * speed * dt * 6;
    }
    head.vx *= 0.86;
    head.vy *= 0.86;
    head.x += head.vx * dt;
    head.y += head.vy * dt;

    // constrain to tube
    if (this.phase === 'tube') {
      const lim = this.tube.size / 2 - 14;
      head.x = Math.max(-lim, Math.min(lim, head.x));
      head.y = Math.max(-lim, Math.min(lim, head.y));
    }

    // body follows (chain)
    for (let i = this.nodes.length - 2; i >= 0; i--) {
      const n = this.nodes[i];
      const lead = this.nodes[i + 1];
      const ddx = lead.x - n.x;
      const ddy = lead.y - n.y;
      const d = Math.hypot(ddx, ddy) || 1;
      const link = 3.2;
      if (d > link) {
        n.x += (ddx / d) * (d - link) * 0.6;
        n.y += (ddy / d) * (d - link) * 0.6;
      }
      n.age += dt;
    }

    // camera
    const targetScale = this.phase === 'tube' ? Math.min(this.W, this.H) / (this.tube.size + 120) : 1;
    this.cam.scale += (targetScale - this.cam.scale) * Math.min(1, dt * 4);
    this.cam.x += (head.x - this.cam.x) * Math.min(1, dt * 5);
    this.cam.y += (head.y - this.cam.y) * Math.min(1, dt * 5);

    // energy
    let drain = 1.4;
    if (this.experiment?.label === 'Ускорение метаболизма') drain *= 2.2;
    if (this.hasBuff('regen')) drain = -3;
    this.energy -= drain * dt;
    this.energy = Math.max(0, Math.min(100, this.energy));

    if (this.energy <= 0 && this.phase !== 'dead') {
      this.phase = 'dead';
      this.pushState();
      return;
    }

    // waves
    this.waveTimer -= dt;
    const waveInterval = this.hasBuff('range') ? 0.18 : 0.32;
    if (this.waveTimer <= 0) {
      this.waveTimer = waveInterval;
      this.emitWaves();
    }
    let range = this.phase === 'tube' ? this.tube.size * 0.7 : 520;
    if (this.hasBuff('range') || this.experiment?.label === 'Усиление сенсоров') range *= 1.6;
    for (const w of this.waves) {
      w.radius += (this.phase === 'tube' ? 220 : 320) * dt;
      w.life -= dt;
      w.flicker = 0.6 + Math.sin(t * 0.02 + w.x) * 0.4;
    }
    this.waves = this.waves.filter((w) => w.life > 0 && w.radius < range);

    // wave reveal collisions
    this.checkReveals();

    // food eating
    this.eatFood(head, t);

    // food timers
    this.foodTimer -= dt;
    if (this.phase === 'tube') {
      if (this.foodTimer <= 0 && this.foods.length < 6) {
        this.foodTimer = 4 + Math.random() * 4;
        this.spawnPellet();
      }
    } else if (this.phase === 'world') {
      if (this.foodTimer <= 0 && this.foods.length < 28) {
        this.foodTimer = 1.2 + Math.random() * 1.8;
        this.spawnElement();
      }
    }

    // experiment
    if (this.phase === 'tube') {
      this.experimentTimer -= dt;
      if (this.experimentTimer <= 0) {
        this.experimentTimer = 15 + Math.random() * 15;
        this.triggerExperiment(t);
      }
    }
    if (this.experiment && t - this.experiment.at > 5000) this.experiment = null;

    // buffs expire
    this.buffs = this.buffs.filter((b) => b.until > t);

    // growth from buff
    if (this.hasBuff('growth') && this.nodes.length < MAX_NODES) {
      this.growth += dt * 40;
      while (this.growth >= 1 && this.nodes.length < MAX_NODES) {
        this.growth -= 1;
        this.grow();
      }
    }

    // escape check
    if (
      this.phase === 'tube' &&
      this.energy >= ESCAPE_ENERGY &&
      this.nodes.length >= ESCAPE_SIZE
    ) {
      this.startEscape();
    }

    // breaking animation
    if (this.phase === 'breaking') {
      this.breakT += dt;
      this.cam.scale += (1 - this.cam.scale) * Math.min(1, dt * 3);
      if (this.breakT > 1.6) {
        this.phase = 'world';
        this.freedom = true;
        this.generateWorld();
        this.cb.onAchievement('escape');
        this.pushState();
      }
    }

    // achievements
    if (this.nodes.length >= 500) this.cb.onAchievement('survive');
    if (this.nodes.length >= 1000) this.cb.onAchievement('size1000');

    // periodic state
    if (Math.floor(t / 200) !== Math.floor((t - dt * 1000) / 200)) this.pushState();
  }

  emitWaves() {
    const step = Math.max(1, Math.floor(this.nodes.length / 18));
    for (let i = 0; i < this.nodes.length; i += step) {
      const n = this.nodes[i];
      this.waves.push({
        x: n.x,
        y: n.y,
        radius: 4,
        maxRadius: 400,
        life: 1.6,
        flicker: 1,
      });
    }
  }

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

  grow() {
    if (this.nodes.length >= MAX_NODES) return;
    const tail = this.nodes[0];
    this.nodes.unshift({
      x: tail.x + (Math.random() - 0.5) * 3,
      y: tail.y + (Math.random() - 0.5) * 3,
      vx: 0,
      vy: 0,
      age: 0,
      parent: 0,
    });
  }

  checkReveals() {
    for (const w of this.waves) {
      for (const f of this.foods) {
        if (f.revealed) continue;
        const d = Math.hypot(f.x - w.x, f.y - w.y);
        if (Math.abs(d - w.radius) < 14) f.revealed = true;
      }
      for (const s of this.structures) {
        if (s.revealed) continue;
        const cx = Math.max(s.x - s.w / 2, Math.min(w.x, s.x + s.w / 2));
        const cy = Math.max(s.y - s.h / 2, Math.min(w.y, s.y + s.h / 2));
        const d = Math.hypot(cx - w.x, cy - w.y);
        if (Math.abs(d - w.radius) < 30) s.revealed = true;
      }
    }
    for (const f of this.foods) if (f.revealed) f.reveal = Math.min(1, f.reveal + 0.05);
    for (const s of this.structures) if (s.revealed) s.reveal = Math.min(1, s.reveal + 0.03);
  }

  eatFood(head: Node, t: number) {
    const eatR = 18 + Math.min(20, this.nodes.length * 0.02);
    for (let i = this.foods.length - 1; i >= 0; i--) {
      const f = this.foods[i];
      f.pulse += 0.05;
      const d = Math.hypot(f.x - head.x, f.y - head.y);
      if (d < eatR) {
        if (f.kind === 'pellet') {
          this.energy = Math.min(100, this.energy + 9);
          for (let g = 0; g < 14; g++) this.grow();
        } else if (f.element) {
          this.energy = Math.min(100, this.energy + (f.element.rare ? 22 : 11));
          const burst = f.element.rare ? 70 : 26;
          for (let g = 0; g < burst; g++) this.grow();
          this.addBuff(f.element.buff);
          this.elementsEaten++;
          this.cb.onElementEaten(f.element.rare);
          if (f.element.rare) this.cb.onAchievement('rare');
          if (this.elementsEaten >= 50) this.cb.onAchievement('eat50');
        }
        this.foods.splice(i, 1);
      }
    }
  }

  // ---------- RENDERING ----------

  render(t: number) {
    const ctx = this.ctx;
    ctx.fillStyle = '#04070d';
    ctx.fillRect(0, 0, this.W, this.H);

    // vignette grid background
    this.drawBackground(t);

    ctx.save();
    ctx.translate(this.W / 2, this.H / 2);
    ctx.scale(this.cam.scale, this.cam.scale);
    ctx.translate(-this.cam.x, -this.cam.y);

    if (this.phase === 'world' || this.phase === 'breaking') this.drawStructures(t);
    this.drawWaves(t);
    this.drawFoods(t);
    this.drawSlime(t);
    if (this.phase === 'tube' || this.phase === 'breaking') this.drawTube(t);

    ctx.restore();
  }

  drawBackground(t: number) {
    const ctx = this.ctx;
    const g = ctx.createRadialGradient(
      this.W / 2,
      this.H / 2,
      0,
      this.W / 2,
      this.H / 2,
      Math.max(this.W, this.H) * 0.8
    );
    g.addColorStop(0, '#0a1320');
    g.addColorStop(1, '#02050a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.H);

    // faint grid
    ctx.strokeStyle = 'rgba(60,120,160,0.05)';
    ctx.lineWidth = 1;
    const gridSize = 60 * this.cam.scale;
    const ox = ((-this.cam.x * this.cam.scale) % gridSize + this.W / 2) % gridSize;
    const oy = ((-this.cam.y * this.cam.scale) % gridSize + this.H / 2) % gridSize;
    ctx.beginPath();
    for (let x = ox; x < this.W; x += gridSize) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.H);
    }
    for (let y = oy; y < this.H; y += gridSize) {
      ctx.moveTo(0, y);
      ctx.lineTo(this.W, y);
    }
    ctx.stroke();
  }

  drawWaves(t: number) {
    const ctx = this.ctx;
    ctx.lineWidth = 1.4 / this.cam.scale;
    for (const w of this.waves) {
      const alpha = (w.life / 1.6) * 0.32 * w.flicker;
      ctx.strokeStyle = `rgba(200,245,255,${alpha})`;
      ctx.beginPath();
      ctx.arc(w.x, w.y, w.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  drawSlime(t: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const step = Math.max(1, Math.floor(this.nodes.length / 600));
    for (let i = 0; i < this.nodes.length; i += step) {
      const n = this.nodes[i];
      const f = i / this.nodes.length;
      const r = 2 + f * 5;
      const wobble = Math.sin(t * 0.004 + i) * 0.4;
      const grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 3);
      const hue = this.hasBuff('mega') ? '255,215,0' : '95,240,224';
      grad.addColorStop(0, `rgba(${hue},0.5)`);
      grad.addColorStop(1, `rgba(${hue},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(n.x, n.y, (r + wobble) * 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // head core
    const head = this.head();
    ctx.fillStyle = '#eafffb';
    ctx.shadowColor = '#5ff0e0';
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(head.x, head.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  drawFoods(t: number) {
    const ctx = this.ctx;
    for (const f of this.foods) {
      if (!f.revealed) continue;
      const pulse = 0.6 + Math.sin(f.pulse) * 0.4;
      if (f.kind === 'pellet') {
        ctx.fillStyle = `rgba(168,255,176,${f.reveal})`;
        ctx.shadowColor = '#a8ffb0';
        ctx.shadowBlur = 12 * pulse * f.reveal;
        ctx.beginPath();
        ctx.arc(f.x, f.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      } else if (f.element) {
        const r = f.element.rare ? 16 : 12;
        ctx.shadowColor = f.element.color;
        ctx.shadowBlur = (f.element.rare ? 26 : 14) * pulse * f.reveal;
        ctx.fillStyle = f.element.color;
        ctx.globalAlpha = f.reveal;
        ctx.beginPath();
        ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#04070d';
        ctx.font = `bold ${r}px JetBrains Mono`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(f.element.symbol, f.x, f.y + 1);
        ctx.globalAlpha = 1;
      }
    }
  }

  drawTube(t: number) {
    const ctx = this.ctx;
    const s = this.tube.size;
    const half = s / 2;

    let crackAlpha = 0;
    if (this.phase === 'breaking') crackAlpha = Math.min(1, this.breakT / 0.6);

    // glass fill
    ctx.fillStyle = 'rgba(120,200,255,0.04)';
    ctx.fillRect(-half, -half, s, s);

    // walls
    ctx.lineWidth = 6 / this.cam.scale;
    ctx.strokeStyle = `rgba(150,220,255,${0.5 - crackAlpha * 0.4})`;
    ctx.shadowColor = '#5ff0e0';
    ctx.shadowBlur = 16;
    ctx.strokeRect(-half, -half, s, s);
    ctx.shadowBlur = 0;

    // inner highlight
    ctx.lineWidth = 1.5 / this.cam.scale;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.strokeRect(-half + 8, -half + 8, s - 16, s - 16);

    // reflections / blik
    const g = ctx.createLinearGradient(-half, -half, half, half);
    g.addColorStop(0, 'rgba(255,255,255,0.12)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.02)');
    g.addColorStop(1, 'rgba(255,255,255,0.06)');
    ctx.fillStyle = g;
    ctx.fillRect(-half, -half, s * 0.25, s);

    // scratches
    ctx.strokeStyle = 'rgba(220,240,255,0.12)';
    ctx.lineWidth = 1 / this.cam.scale;
    ctx.beginPath();
    for (const sc of this.scratches) {
      ctx.moveTo(sc.x1, sc.y1);
      ctx.lineTo(sc.x2, sc.y2);
    }
    ctx.stroke();

    // cracks when breaking
    if (this.phase === 'breaking') {
      ctx.strokeStyle = `rgba(255,255,255,${crackAlpha})`;
      ctx.lineWidth = 2 / this.cam.scale;
      ctx.shadowColor = '#fff';
      ctx.shadowBlur = 10;
      const cx = this.head().x;
      const cy = this.head().y;
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        let px = cx;
        let py = cy;
        for (let j = 0; j < 5; j++) {
          px += Math.cos(a + (Math.random() - 0.5)) * 40 * this.breakT;
          py += Math.sin(a + (Math.random() - 0.5)) * 40 * this.breakT;
          ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }
  }

  drawStructures(t: number) {
    const ctx = this.ctx;
    for (const s of this.structures) {
      if (s.reveal <= 0) continue;
      ctx.save();
      ctx.globalAlpha = s.reveal;
      ctx.translate(s.x, s.y);

      ctx.shadowColor = '#5ff0e0';
      ctx.shadowBlur = 14 * s.reveal;

      const col = '#9fe8ff';
      ctx.strokeStyle = col;
      ctx.fillStyle = 'rgba(60,130,180,0.12)';
      ctx.lineWidth = 2;

      this.drawStructureShape(s);

      ctx.shadowBlur = 0;
      // label
      ctx.globalAlpha = s.reveal * 0.9;
      ctx.fillStyle = '#cfeeff';
      ctx.font = '13px JetBrains Mono';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(s.label, 0, s.h / 2 + 8);
      ctx.restore();
    }
  }

  drawStructureShape(s: Structure) {
    const ctx = this.ctx;
    const hw = s.w / 2;
    const hh = s.h / 2;
    ctx.beginPath();
    ctx.rect(-hw, -hh, s.w, s.h);
    ctx.fill();
    ctx.stroke();

    switch (s.type) {
      case 'centrifuge':
        ctx.beginPath();
        ctx.arc(0, 0, Math.min(hw, hh) * 0.7, 0, Math.PI * 2);
        ctx.stroke();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + s.seed;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(a) * hw * 0.6, Math.sin(a) * hh * 0.6);
          ctx.stroke();
        }
        break;
      case 'chromatograph':
        for (let i = 0; i < 5; i++) {
          const x = -hw + (i + 0.5) * (s.w / 5);
          ctx.beginPath();
          ctx.moveTo(x, -hh + 8);
          ctx.lineTo(x, hh - 8);
          ctx.stroke();
        }
        break;
      case 'cryo':
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.moveTo(-hw + 6, -hh + (i + 1) * (s.h / 5));
          ctx.lineTo(hw - 6, -hh + (i + 1) * (s.h / 5));
          ctx.stroke();
        }
        break;
      case 'rack':
        for (let i = 0; i < 6; i++) {
          const x = -hw + (i + 0.5) * (s.w / 6);
          ctx.beginPath();
          ctx.arc(x, hh * 0.3, 4, 0, Math.PI * 2);
          ctx.moveTo(x, hh * 0.3);
          ctx.lineTo(x, -hh + 8);
          ctx.stroke();
        }
        break;
      case 'microscope':
        ctx.beginPath();
        ctx.arc(0, -hh * 0.3, hw * 0.25, 0, Math.PI * 2);
        ctx.moveTo(0, -hh * 0.3);
        ctx.lineTo(hw * 0.4, hh * 0.5);
        ctx.stroke();
        break;
      case 'reactor':
        ctx.beginPath();
        ctx.arc(0, 0, Math.min(hw, hh) * 0.55, 0, Math.PI * 2);
        ctx.arc(0, 0, Math.min(hw, hh) * 0.3, 0, Math.PI * 2);
        ctx.stroke();
        break;
      default:
        ctx.beginPath();
        ctx.moveTo(-hw + 8, 0);
        ctx.lineTo(hw - 8, 0);
        ctx.moveTo(0, -hh + 8);
        ctx.lineTo(0, hh - 8);
        ctx.stroke();
    }
  }
}
