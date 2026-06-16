/**
 * Physarum polycephalum — 3D движок
 *
 * - Карта 3D: объекты лаборатории расставлены в пространстве (стеллажи, приборы)
 * - Физарум 2D: сеть веин лежит на плоскости Y=0 (как в реальности на агаре)
 * - Камера: OrbitControls — вращение мышью/тачем, зум скроллом/щипком
 * - Управление: клик на плоскость → аттрактант → псевдоподии тянутся туда
 * - Волны осязания: кольца на плоскости Y=0, при пересечении 3D-объектов их подсвечивают
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ELEMENTS, BUFF_META, EXPERIMENTS, STRUCTURE_TYPES, ESCAPE_ENERGY, ESCAPE_SIZE } from './data';
import { Buff, ExperimentEvent, Food, GamePhase } from './types';

// ─── типы графа физарума ──────────────────────────────────────────────────────

interface Junction {
  id: number;
  x: number; z: number;   // Y всегда 0
  nutrient: number;
  mesh: THREE.Mesh;
}

interface Vein {
  id: number;
  a: number; b: number;
  radius: number;
  flow: number;
  phase: number;
  age: number;
  line: THREE.Mesh;        // CylinderGeometry между двумя точками
}

interface Tip {
  id: number;
  junctionId: number;
  dx: number; dz: number;
  energy: number;
  len: number;
  mesh: THREE.Mesh;
}

interface WaveRing {
  radius: number;
  life: number;
  x: number; z: number;
  mesh: THREE.Mesh;
}

interface LabObject {
  mesh: THREE.Group;
  x: number; z: number;
  w: number; d: number;
  h: number;
  label: string;
  revealed: boolean;
  labelSprite: THREE.Sprite;
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

const TUBE_HALF = 18;          // половина стороны пробирки в мировых единицах
const MAX_JUNCTIONS = 500;
const MAX_VEINS = 700;
const MAX_TIPS = 24;
const TIP_SPEED = 3.2;
const PULSE_FREQ = 1.4;
const RETRACT_R = 0.04;
const MAX_RADIUS = 1.1;
const GROW_RATE = 0.022;
const DECAY_RATE = 0.009;

// цвета физарума
const COL_VEIN = new THREE.Color(0.72, 0.90, 0.22);      // охра-жёлтый
const COL_CORE = new THREE.Color(0.90, 1.0, 0.55);
const COL_TIP  = new THREE.Color(0.85, 1.0, 0.30);
const COL_WAVE = new THREE.Color(0.78, 0.97, 1.0);
const COL_MEGA = new THREE.Color(1.0, 0.85, 0.15);

let _id = 0;
const uid = () => ++_id;

// ─── вспомогательные функции Three.js ────────────────────────────────────────

function makeTube(ax: number, az: number, bx: number, bz: number, r: number, mat: THREE.Material): THREE.Mesh {
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz) || 0.01;
  const geo = new THREE.CylinderGeometry(r, r, len, 6, 1);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set((ax + bx) / 2, 0, (az + bz) / 2);
  mesh.rotation.z = Math.PI / 2;
  mesh.rotation.y = -Math.atan2(dz, dx);
  return mesh;
}

function makeSphere(r: number, mat: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.SphereGeometry(r, 8, 8), mat);
}

function makeWaveRing(x: number, z: number, r: number, scene: THREE.Scene): WaveRing {
  const geo = new THREE.RingGeometry(r - 0.05, r + 0.05, 48);
  const mat = new THREE.MeshBasicMaterial({ color: COL_WAVE, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, 0.02, z);
  scene.add(mesh);
  return { radius: r, life: 1.8, x, z, mesh };
}

function makeLabelSprite(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fillRect(0, 0, 256, 64);
  ctx.font = 'bold 20px JetBrains Mono, monospace';
  ctx.fillStyle = '#9fe8ff';
  ctx.textAlign = 'center';
  ctx.fillText(text, 128, 40);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0 });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(8, 2, 1);
  return sprite;
}

// ─── главный движок ───────────────────────────────────────────────────────────

export class GameEngine3D {
  canvas: HTMLCanvasElement;
  cb: EngineCallbacks;

  renderer!: THREE.WebGLRenderer;
  scene!: THREE.Scene;
  camera!: THREE.PerspectiveCamera;
  controls!: OrbitControls;

  junctions = new Map<number, Junction>();
  veins = new Map<number, Vein>();
  tips: Tip[] = [];
  waveRings: WaveRing[] = [];
  foods3d: { food: Food; mesh: THREE.Mesh; revealed: boolean }[] = [];
  labObjects: LabObject[] = [];

  // материалы (переиспользуем)
  matVein!: THREE.MeshStandardMaterial;
  matCore!: THREE.MeshBasicMaterial;
  matTip!: THREE.MeshStandardMaterial;
  matJunc!: THREE.MeshStandardMaterial;
  matFloor!: THREE.MeshStandardMaterial;
  matTubeWall!: THREE.MeshPhysicalMaterial;

  target = { x: 0, z: 0 };
  targetMarker!: THREE.Mesh;

  phase: GamePhase = 'tube';
  energy = 72;
  freedom = false;
  elementsEaten = 0;
  bestSize = 0;
  buffs: Buff[] = [];
  experiment: ExperimentEvent | null = null;
  scratches: { x1: number; z1: number; x2: number; z2: number }[] = [];

  raf = 0;
  running = false;
  lastTime = 0;
  waveTimer = 0;
  experimentTimer = 0;
  foodTimer = 0;
  breakT = 0;

  raycaster = new THREE.Raycaster();
  groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  constructor(canvas: HTMLCanvasElement, cb: EngineCallbacks) {
    this.canvas = canvas;
    this.cb = cb;
    this.initThree();
    this.reset();
  }

  // ─── инициализация Three.js ───────────────────────────────────────────────

  initThree() {
    const W = this.canvas.clientWidth;
    const H = this.canvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(W, H);
    this.renderer.setClearColor(0x04070d);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x04070d, 0.018);

    this.camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 1000);
    this.camera.position.set(0, 38, 52);
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 180;
    this.controls.maxPolarAngle = Math.PI / 2.1;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };

    // материалы
    this.matVein = new THREE.MeshStandardMaterial({ color: COL_VEIN, emissive: COL_VEIN, emissiveIntensity: 0.4, roughness: 0.5, metalness: 0.1 });
    this.matCore = new THREE.MeshBasicMaterial({ color: COL_CORE });
    this.matTip  = new THREE.MeshStandardMaterial({ color: COL_TIP, emissive: COL_TIP, emissiveIntensity: 0.8, roughness: 0.3 });
    this.matJunc = new THREE.MeshStandardMaterial({ color: COL_VEIN, emissive: COL_VEIN, emissiveIntensity: 0.5, roughness: 0.4 });
    this.matFloor = new THREE.MeshStandardMaterial({ color: 0x0d1f1a, roughness: 0.9, metalness: 0.05 });
    this.matTubeWall = new THREE.MeshPhysicalMaterial({
      color: 0x88ddff, transparent: true, opacity: 0.13,
      roughness: 0.05, metalness: 0.0, transmission: 0.88,
      side: THREE.DoubleSide,
    });

    // освещение
    const ambient = new THREE.AmbientLight(0x0a1820, 1.2);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0x5feedd, 1.8);
    sun.position.set(20, 50, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    this.scene.add(sun);

    const fill = new THREE.PointLight(0x2244aa, 1.2, 200);
    fill.position.set(-30, 20, -30);
    this.scene.add(fill);

    // маркер цели (куда тянется физарум)
    const markerGeo = new THREE.RingGeometry(0.3, 0.5, 24);
    const markerMat = new THREE.MeshBasicMaterial({ color: 0xb0ffb0, transparent: true, opacity: 0.7, side: THREE.DoubleSide });
    this.targetMarker = new THREE.Mesh(markerGeo, markerMat);
    this.targetMarker.rotation.x = -Math.PI / 2;
    this.targetMarker.position.y = 0.03;
    this.scene.add(this.targetMarker);

    // фоновая сетка
    const grid = new THREE.GridHelper(400, 80, 0x0a2030, 0x061420);
    grid.position.y = -0.01;
    this.scene.add(grid);
  }

  // ─── сброс / инициализация мира ───────────────────────────────────────────

  reset() {
    _id = 0;
    this.phase = 'tube';
    this.energy = 72;
    this.freedom = false;
    this.elementsEaten = 0;
    this.breakT = 0;
    this.buffs = [];
    this.experiment = null;
    this.waveTimer = 0;
    this.experimentTimer = 0;
    this.foodTimer = 0;
    this.target = { x: 0, z: 0 };

    // чистим сцену (кроме grid, освещения, маркера)
    const keep = new Set<THREE.Object3D>();
    this.scene.traverse(o => {
      if (o instanceof THREE.GridHelper || o instanceof THREE.Light || o === this.targetMarker) keep.add(o);
    });
    const toRemove: THREE.Object3D[] = [];
    this.scene.children.forEach(c => { if (!keep.has(c)) toRemove.push(c); });
    toRemove.forEach(c => { this.scene.remove(c); });

    this.junctions.clear();
    this.veins.clear();
    this.tips = [];
    this.waveRings = [];
    this.foods3d = [];
    this.labObjects = [];

    this.buildTube();
    this.buildFloor();
    this.seedNetwork();

    for (let i = 0; i < 4; i++) this.spawnPellet();
    this.pushState();

    this.camera.position.set(0, 38, 52);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  buildFloor() {
    const geo = new THREE.PlaneGeometry(400, 400);
    const mesh = new THREE.Mesh(geo, this.matFloor);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -0.05;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  buildTube() {
    const h = TUBE_HALF;
    const wallH = 6;
    const wallMat = this.matTubeWall;
    const edges: [number, number, number, number, number, number][] = [
      // x, y, z, rx, ry, rz
      [0, wallH / 2, -h, 0, 0, 0],
      [0, wallH / 2,  h, 0, 0, 0],
      [-h, wallH / 2, 0, 0, Math.PI / 2, 0],
      [ h, wallH / 2, 0, 0, Math.PI / 2, 0],
    ];
    for (const [x, y, z, rx, ry, rz] of edges) {
      const geo = new THREE.PlaneGeometry(h * 2, wallH);
      const wall = new THREE.Mesh(geo, wallMat);
      wall.position.set(x, y, z);
      wall.rotation.set(rx, ry, rz);
      this.scene.add(wall);
    }

    // рамка стекла
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x88ddff, transparent: true, opacity: 0.5 });
    const corners = [
      [-h, 0, -h], [h, 0, -h], [h, 0, h], [-h, 0, h], [-h, 0, -h],
    ];
    const pts = corners.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
    this.scene.add(new THREE.Line(lineGeo, edgeMat));
    const topPts = corners.map(([x, , z]) => new THREE.Vector3(x, wallH, z));
    const topGeo = new THREE.BufferGeometry().setFromPoints(topPts);
    this.scene.add(new THREE.Line(topGeo, edgeMat));
  }

  seedNetwork() {
    const center = this.addJunction(0, 0);
    const dirs: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const ring: number[] = [];
    for (const [dx, dz] of dirs) {
      const j = this.addJunction(dx * 1.8, dz * 1.8);
      ring.push(j);
      this.addVein(center, j, 0.35);
    }
    for (let i = 0; i < ring.length; i++) this.addVein(ring[i], ring[(i + 1) % ring.length], 0.2);
    for (let i = 0; i < ring.length; i++) {
      const j = this.junctions.get(ring[i])!;
      this.addTip(ring[i], j.x / 1.8, j.z / 1.8);
    }
  }

  // ─── граф физарума ────────────────────────────────────────────────────────

  addJunction(x: number, z: number): number {
    const id = uid();
    const mesh = makeSphere(0.18, this.matJunc);
    mesh.position.set(x, 0, z);
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.junctions.set(id, { id, x, z, nutrient: 0, mesh });
    return id;
  }

  addVein(a: number, b: number, r = 0.15): number {
    const id = uid();
    const ja = this.junctions.get(a)!, jb = this.junctions.get(b)!;
    const mat = this.matVein.clone();
    const line = makeTube(ja.x, ja.z, jb.x, jb.z, r, mat);
    line.castShadow = true;
    this.scene.add(line);
    this.veins.set(id, { id, a, b, radius: r, flow: 0, phase: Math.random() * Math.PI * 2, age: 0, line });
    return id;
  }

  addTip(junctionId: number, dx: number, dz: number): Tip {
    const len = Math.hypot(dx, dz) || 1;
    const j = this.junctions.get(junctionId)!;
    const mesh = makeSphere(0.28, this.matTip.clone());
    mesh.position.set(j.x, 0.05, j.z);
    this.scene.add(mesh);
    const tip: Tip = { id: uid(), junctionId, dx: dx / len, dz: dz / len, energy: 1, len: 0, mesh };
    this.tips.push(tip);
    return tip;
  }

  removeVein(id: number) {
    const v = this.veins.get(id);
    if (!v) return;
    this.scene.remove(v.line);
    (v.line.material as THREE.Material).dispose();
    v.line.geometry.dispose();
    this.veins.delete(id);
  }

  removeJunction(id: number) {
    const j = this.junctions.get(id);
    if (!j) return;
    this.scene.remove(j.mesh);
    this.junctions.delete(id);
  }

  removeTip(i: number) {
    const tip = this.tips[i];
    this.scene.remove(tip.mesh);
    this.tips.splice(i, 1);
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
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  resize() {
    const W = this.canvas.clientWidth;
    const H = this.canvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setSize(W, H);
    this.renderer.setPixelRatio(dpr);
    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();
  }

  // ─── update ───────────────────────────────────────────────────────────────

  update(dt: number, t: number) {
    if (this.phase === 'dead') return;

    this.updatePressures(t);
    this.updateVeins(dt, t);
    this.updateTips(dt, t);
    this.pruneDeadVeins();

    // маркер цели пульсирует
    const mp = 0.7 + Math.sin(t * 0.003) * 0.3;
    (this.targetMarker.material as THREE.MeshBasicMaterial).opacity = mp * 0.6;

    // волны осязания
    this.waveTimer -= dt;
    const waveInterval = this.hasBuff('range') ? 0.14 : 0.28;
    if (this.waveTimer <= 0) {
      this.waveTimer = waveInterval;
      this.emitWaves(t);
    }
    const waveSpeed = this.phase === 'tube' ? 12 : 22;
    const waveRange = this.phase === 'tube' ? TUBE_HALF * 1.5 : 55;
    for (let i = this.waveRings.length - 1; i >= 0; i--) {
      const w = this.waveRings[i];
      w.radius += waveSpeed * dt;
      w.life -= dt;
      const alpha = (w.life / 1.8) * 0.45;
      const mat = w.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = alpha;
      // обновляем геометрию кольца
      w.mesh.geometry.dispose();
      w.mesh.geometry = new THREE.RingGeometry(w.radius - 0.08, w.radius + 0.08, 52);
      // reveal объектов
      this.checkReveal(w);
      if (w.life <= 0 || w.radius > waveRange) {
        this.scene.remove(w.mesh);
        w.mesh.geometry.dispose();
        (w.mesh.material as THREE.Material).dispose();
        this.waveRings.splice(i, 1);
      }
    }

    // энергия
    let drain = 1.1;
    if (this.experiment?.label === 'Ускорение метаболизма') drain *= 2;
    if (this.hasBuff('regen')) drain = -3;
    this.energy = Math.max(0, Math.min(100, this.energy - drain * dt));
    if (this.energy <= 0) { this.phase = 'dead'; this.pushState(); return; }

    // еда
    this.eatFood();
    this.foodTimer -= dt;
    if (this.phase === 'tube') {
      if (this.foodTimer <= 0 && this.foods3d.length < 6) { this.foodTimer = 4 + Math.random() * 5; this.spawnPellet(); }
    } else if (this.phase === 'world') {
      if (this.foodTimer <= 0 && this.foods3d.length < 28) { this.foodTimer = 1 + Math.random() * 2; this.spawnElement(); }
    }

    // эксперименты
    if (this.phase === 'tube') {
      this.experimentTimer -= dt;
      if (this.experimentTimer <= 0) { this.experimentTimer = 15 + Math.random() * 15; this.triggerExperiment(t); }
    }
    if (this.experiment && t - this.experiment.at > 5000) this.experiment = null;

    this.buffs = this.buffs.filter(b => b.until > t);

    // побег
    const size = this.junctions.size;
    if (this.phase === 'tube' && this.energy >= ESCAPE_ENERGY && size >= ESCAPE_SIZE) this.startEscape();
    if (this.phase === 'breaking') {
      this.breakT += dt;
      if (this.breakT > 2.0) {
        this.phase = 'world';
        this.freedom = true;
        this.generateWorld();
        this.cb.onAchievement('escape');
        this.controls.maxDistance = 500;
      }
    }

    if (size >= 500) this.cb.onAchievement('survive');
    if (size >= 1000) this.cb.onAchievement('size1000');

    if (Math.floor(t / 180) !== Math.floor((t - dt * 1000) / 180)) this.pushState();
  }

  // ─── Hagen-Poiseuille ─────────────────────────────────────────────────────

  updatePressures(t: number) {
    const pulse = Math.sin(t * PULSE_FREQ * Math.PI * 2);
    const pressure = new Map<number, number>();
    for (const [id, j] of this.junctions) {
      const d = Math.hypot(this.target.x - j.x, this.target.z - j.z) + 0.1;
      pressure.set(id, 1.2 / d + pulse * 0.1 + j.nutrient * 0.4);
    }
    for (const [, v] of this.veins) {
      const pa = pressure.get(v.a) ?? 0;
      const pb = pressure.get(v.b) ?? 0;
      v.flow = Math.pow(v.radius, 4) * (pa - pb);
    }
  }

  updateVeins(dt: number, t: number) {
    for (const [, v] of this.veins) {
      v.age += dt;
      v.phase += PULSE_FREQ * Math.PI * 2 * dt;
      const absFlow = Math.abs(v.flow);
      const targetR = absFlow > 0.00002
        ? Math.min(MAX_RADIUS, v.radius + GROW_RATE * dt * (absFlow * 500))
        : Math.max(RETRACT_R, v.radius - DECAY_RATE * dt);
      if (this.hasBuff('growth')) v.radius = Math.min(MAX_RADIUS, v.radius + 0.12 * dt);
      else v.radius += (targetR - v.radius) * Math.min(1, dt * 2);

      // обновляем mesh вейны — пульс меняет emissiveIntensity
      const ja = this.junctions.get(v.a), jb = this.junctions.get(v.b);
      if (!ja || !jb) continue;
      const pulse = 0.7 + Math.sin(v.phase + t * PULSE_FREQ * Math.PI * 2) * 0.3;
      const mat = v.line.material as THREE.MeshStandardMaterial;
      const mega = this.hasBuff('mega');
      mat.color.set(mega ? COL_MEGA : COL_VEIN);
      mat.emissive.set(mega ? COL_MEGA : COL_VEIN);
      mat.emissiveIntensity = (0.3 + Math.min(1, Math.abs(v.flow) * 800) * 0.7) * pulse;

      // пересоздаём геометрию только если радиус сильно изменился
      const curR = (v.line.geometry as THREE.CylinderGeometry).parameters?.radiusTop ?? 0;
      if (Math.abs(curR - v.radius) > 0.015) {
        v.line.geometry.dispose();
        const dx = jb.x - ja.x, dz = jb.z - ja.z;
        const len = Math.hypot(dx, dz) || 0.01;
        v.line.geometry = new THREE.CylinderGeometry(v.radius, v.radius, len, 6, 1);
        v.line.position.set((ja.x + jb.x) / 2, 0, (ja.z + jb.z) / 2);
        v.line.rotation.z = Math.PI / 2;
        v.line.rotation.y = -Math.atan2(dz, dx);
      }
    }
  }

  updateTips(dt: number, _t: number) {
    const speed = (this.hasBuff('speed') ? TIP_SPEED * 1.8 : TIP_SPEED)
                * (this.experiment?.label === 'Криозаморозка' ? 0.35 : 1);

    for (let i = this.tips.length - 1; i >= 0; i--) {
      const tip = this.tips[i];
      const junc = this.junctions.get(tip.junctionId);
      if (!junc) { this.removeTip(i); continue; }

      // хемотаксис к цели
      let ax = this.target.x - junc.x;
      let az = this.target.z - junc.z;
      const tD = Math.hypot(ax, az) || 1;
      ax /= tD; az /= tD;

      // притяжение к ближайшей открытой еде
      for (const { food, revealed } of this.foods3d) {
        if (!revealed) continue;
        const fd = Math.hypot(food.x - junc.x, food.y - junc.z);
        if (fd < 28) { ax += (food.x - junc.x) / fd * 1.4; az += (food.y - junc.z) / fd * 1.4; }
      }
      const aL = Math.hypot(ax, az) || 1; ax /= aL; az /= aL;

      // случайный дрейф псевдоподии
      tip.dx += ax * 0.14 + (Math.random() - 0.5) * 0.38;
      tip.dz += az * 0.14 + (Math.random() - 0.5) * 0.38;
      const tl = Math.hypot(tip.dx, tip.dz) || 1;
      tip.dx /= tl; tip.dz /= tl;

      const nx = junc.x + tip.dx * speed * dt;
      const nz = junc.z + tip.dz * speed * dt;

      // стенки пробирки
      if (this.phase === 'tube') {
        if (Math.abs(nx) > TUBE_HALF - 0.6) tip.dx *= -1;
        if (Math.abs(nz) > TUBE_HALF - 0.6) tip.dz *= -1;
        if (Math.abs(nx) > TUBE_HALF - 0.6 || Math.abs(nz) > TUBE_HALF - 0.6) {
          tip.mesh.position.set(junc.x, 0.05, junc.z); continue;
        }
      }

      tip.len += speed * dt;

      if (tip.len > 1.5 && this.junctions.size < MAX_JUNCTIONS && this.veins.size < MAX_VEINS) {
        tip.len = 0;
        const newJ = this.addJunction(nx, nz);
        this.addVein(tip.junctionId, newJ, 0.12 + Math.random() * 0.06);
        tip.junctionId = newJ;
        tip.mesh.position.set(nx, 0.05, nz);

        const branchProb = this.hasBuff('growth') ? 0.28 : 0.12;
        if (this.tips.length < MAX_TIPS && Math.random() < branchProb) {
          const angle = (Math.random() - 0.5) * Math.PI * 0.72;
          const cos = Math.cos(angle), sin = Math.sin(angle);
          this.addTip(newJ, tip.dx * cos - tip.dz * sin, tip.dx * sin + tip.dz * cos);
        }
      } else {
        junc.x = nx; junc.z = nz;
        junc.mesh.position.set(nx, 0, nz);
        tip.mesh.position.set(nx, 0.05, nz);
      }

      // анимация кончика
      const mat = tip.mesh.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.6 + Math.sin(_t * 0.004 + tip.id) * 0.4;

      if (this.energy < 12) tip.energy -= dt * 0.4;
      if (tip.energy <= 0) this.removeTip(i);
    }

    if (this.tips.length < 2 && this.junctions.size > 0) {
      const jArr = [...this.junctions.values()];
      const j = jArr[Math.floor(Math.random() * jArr.length)];
      this.addTip(j.id, Math.random() - 0.5, Math.random() - 0.5);
    }
  }

  pruneDeadVeins() {
    for (const [id, v] of this.veins) {
      if (v.radius < RETRACT_R && v.age > 1.8) {
        this.removeVein(id);
        this.tryPruneJunction(v.a);
        this.tryPruneJunction(v.b);
      }
    }
  }

  tryPruneJunction(jId: number) {
    for (const [, v] of this.veins) { if (v.a === jId || v.b === jId) return; }
    if (this.tips.some(t => t.junctionId === jId)) return;
    this.removeJunction(jId);
  }

  // ─── волны осязания ───────────────────────────────────────────────────────

  emitWaves(_t: number) {
    const jArr = [...this.junctions.values()];
    const step = Math.max(1, Math.floor(jArr.length / 12));
    for (let i = 0; i < jArr.length; i += step) {
      const j = jArr[i];
      this.waveRings.push(makeWaveRing(j.x, j.z, 0.1, this.scene));
    }
  }

  checkReveal(w: WaveRing) {
    for (const food of this.foods3d) {
      if (food.revealed) continue;
      const d = Math.hypot(food.food.x - w.x, food.food.y - w.z);
      if (Math.abs(d - w.radius) < 1.2) {
        food.revealed = true;
        food.mesh.visible = true;
        food.food.revealed = true;
      }
    }
    for (const obj of this.labObjects) {
      if (obj.revealed) continue;
      const d = Math.hypot(obj.x - w.x, obj.z - w.z);
      if (Math.abs(d - w.radius) < 3) {
        obj.revealed = true;
        // плавно показываем
        obj.mesh.traverse(c => {
          if ((c as THREE.Mesh).material) {
            ((c as THREE.Mesh).material as THREE.MeshStandardMaterial).opacity = 1;
            ((c as THREE.Mesh).material as THREE.MeshStandardMaterial).transparent = false;
          }
        });
        (obj.labelSprite.material as THREE.SpriteMaterial).opacity = 1;
        // подсветка при обнаружении
        const light = new THREE.PointLight(0x5feedd, 3, 12);
        light.position.set(obj.x, 3, obj.z);
        this.scene.add(light);
        setTimeout(() => this.scene.remove(light), 1200);
      }
    }
  }

  // ─── еда ──────────────────────────────────────────────────────────────────

  spawnPellet() {
    const h = TUBE_HALF - 1.8;
    const x = (Math.random() - 0.5) * h * 2;
    const z = (Math.random() - 0.5) * h * 2;
    const food: Food = { x, y: z, kind: 'pellet', revealed: false, reveal: 0, pulse: 0 };
    const geo = new THREE.SphereGeometry(0.4, 8, 8);
    const mat = new THREE.MeshStandardMaterial({ color: 0xa8ffb0, emissive: 0x50ff80, emissiveIntensity: 0.6, roughness: 0.4 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 0.4, z);
    mesh.visible = false;
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.foods3d.push({ food, mesh, revealed: false });
  }

  spawnElement() {
    const cx = this.getCentroid().x, cz = this.getCentroid().z;
    const ang = Math.random() * Math.PI * 2;
    const dist = 28 + Math.random() * 80;
    const x = cx + Math.cos(ang) * dist;
    const z = cz + Math.sin(ang) * dist;
    const pool = ELEMENTS.filter(e => e.rare ? Math.random() < 0.15 : true);
    const el = pool[Math.floor(Math.random() * pool.length)];
    const food: Food = { x, y: z, kind: 'element', element: el, revealed: false, reveal: 0, pulse: 0 };
    const r = el.rare ? 0.9 : 0.65;
    const col = new THREE.Color(el.color);
    const geo = new THREE.SphereGeometry(r, 10, 10);
    const mat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.7, roughness: 0.3 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, r, z);
    mesh.visible = false;
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.foods3d.push({ food, mesh, revealed: false });
  }

  eatFood() {
    const eatR = 1.6 + Math.min(1.5, this.junctions.size * 0.003);
    for (let i = this.foods3d.length - 1; i >= 0; i--) {
      const { food, mesh } = this.foods3d[i];
      let minD = Infinity;
      for (const [, j] of this.junctions) {
        const d = Math.hypot(food.x - j.x, food.y - j.z);
        if (d < minD) minD = d;
      }
      if (minD < eatR) {
        this.scene.remove(mesh);
        if (food.kind === 'pellet') {
          this.energy = Math.min(100, this.energy + 10);
          this.burstGrowth(food.x, food.y, 7);
        } else if (food.element) {
          this.energy = Math.min(100, this.energy + (food.element.rare ? 24 : 12));
          this.burstGrowth(food.x, food.y, food.element.rare ? 16 : 7);
          this.addBuff(food.element.buff);
          this.elementsEaten++;
          this.cb.onElementEaten(food.element.rare);
          if (food.element.rare) this.cb.onAchievement('rare');
          if (this.elementsEaten >= 50) this.cb.onAchievement('eat50');
        }
        this.foods3d.splice(i, 1);
      }
    }
  }

  burstGrowth(fx: number, fz: number, count: number) {
    let bestJ: Junction | null = null, bestD = Infinity;
    for (const [, j] of this.junctions) {
      const d = Math.hypot(fx - j.x, fz - j.z);
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
      const d = Math.hypot((ja.x + jb.x) / 2 - fx, (ja.z + jb.z) / 2 - fz);
      if (d < 8) v.radius = Math.min(MAX_RADIUS, v.radius + 0.18);
    }
  }

  // ─── баффы / эксперименты ─────────────────────────────────────────────────

  hasBuff(t: Buff['type']) { return this.buffs.some(b => b.type === t); }

  addBuff(type: Buff['type']) {
    const m = BUFF_META[type];
    const until = performance.now() + m.ms;
    const ex = this.buffs.find(b => b.type === type);
    if (ex) ex.until = until;
    else this.buffs.push({ type, label: m.label, icon: m.icon, color: m.color, until });
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
    this.foods3d.forEach(({ mesh }) => this.scene.remove(mesh));
    this.foods3d = [];
    this.experiment = null;
    this.pushState();
  }

  // ─── генерация мира лаборатории ───────────────────────────────────────────

  generateWorld() {
    const bounds = 220;
    let placed = 0, attempts = 0;
    while (placed < 40 && attempts < 3000) {
      attempts++;
      const tpl = STRUCTURE_TYPES[Math.floor(Math.random() * STRUCTURE_TYPES.length)];
      const w = 8 + Math.random() * 14;
      const d = 8 + Math.random() * 14;
      const h = 4 + Math.random() * 10;
      const x = (Math.random() - 0.5) * bounds * 2;
      const z = (Math.random() - 0.5) * bounds * 2;
      if (Math.abs(x) < 30 && Math.abs(z) < 30) continue;
      let overlap = false;
      for (const obj of this.labObjects) {
        if (Math.abs(obj.x - x) < (obj.w + w) / 2 + 4 && Math.abs(obj.z - z) < (obj.d + d) / 2 + 4) { overlap = true; break; }
      }
      if (overlap) continue;

      const group = this.buildLabObject(x, z, w, d, h, tpl.type);
      const label = tpl.label + ' #' + (placed + 1);
      const sprite = makeLabelSprite(label);
      sprite.position.set(x, h + 1.5, z);
      (sprite.material as THREE.SpriteMaterial).opacity = 0;
      this.scene.add(sprite);
      this.labObjects.push({ mesh: group, x, z, w, d, h, label, revealed: false, labelSprite: sprite });
      placed++;
    }
  }

  buildLabObject(x: number, z: number, w: number, d: number, h: number, type: string): THREE.Group {
    const group = new THREE.Group();
    const col = new THREE.Color().setHSL(0.55 + Math.random() * 0.15, 0.6, 0.25);
    const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.6, metalness: 0.3, transparent: true, opacity: 0 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat.clone());
    body.position.y = h / 2;
    body.castShadow = true; body.receiveShadow = true;
    group.add(body);

    // детали зависят от типа
    if (type === 'centrifuge') {
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.3, w * 0.3, h * 0.4, 12), mat.clone());
      cyl.position.y = h + h * 0.2;
      group.add(cyl);
    } else if (type === 'rack') {
      for (let i = 0; i < 4; i++) {
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, h * 0.8, 8), mat.clone());
        tube.position.set(-w / 2 + (i + 0.5) * w / 4, h + h * 0.4, 0);
        group.add(tube);
      }
    } else if (type === 'reactor') {
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(Math.min(w, d) * 0.4, 12, 12), mat.clone());
      sphere.position.y = h + Math.min(w, d) * 0.4;
      group.add(sphere);
    }

    // свечение-аура (невидимое пока не открыто)
    const glow = new THREE.PointLight(new THREE.Color(0x5feedd), 0, 10);
    glow.position.y = h;
    group.add(glow);

    group.position.set(x, 0, z);
    this.scene.add(group);
    return group;
  }

  // ─── вспомогательные ──────────────────────────────────────────────────────

  getCentroid() {
    if (this.junctions.size === 0) return { x: 0, z: 0 };
    let sx = 0, sz = 0;
    for (const [, j] of this.junctions) { sx += j.x; sz += j.z; }
    return { x: sx / this.junctions.size, z: sz / this.junctions.size };
  }

  pushState() {
    this.bestSize = Math.max(this.bestSize, this.junctions.size);
    this.cb.onState({
      phase: this.phase, energy: this.energy,
      size: this.junctions.size, bestSize: this.bestSize,
      elementsEaten: this.elementsEaten, buffs: [...this.buffs],
      experiment: this.experiment, freedom: this.freedom,
    });
  }

  // клик/тап — ставим аттрактант на плоскость Y=0
  setTargetFromScreen(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const pt = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(this.groundPlane, pt);
    this.target.x = pt.x;
    this.target.z = pt.z;
    this.targetMarker.position.set(pt.x, 0.03, pt.z);
  }

  // «голова» = центроид кончиков (для HUD)
  head() { return this.getCentroid(); }
}
