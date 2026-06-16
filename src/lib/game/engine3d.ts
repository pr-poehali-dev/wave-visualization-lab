/**
 * Physarum polycephalum — 3D движок v3
 *
 * Биологическая модель:
 * - Гибрид: центральное пятно-плазмодий + толстые вейны + тонкие псевдоподии
 * - Рост по ТРЁМ поверхностям: пол (Y=0), стены (X=±W, Z=±D), потолок (Y=H)
 * - Мутации от элементов: Глаза / Жгутики / Токсины / Споры
 * - Организмы: Бактерии (еда), Грибки (конкуренты, блокируют путь), Нематоды (враги)
 * - Интерьер лаборатории с ползабельными объектами
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BUFF_META, EXPERIMENTS } from './data';
import { Buff, ExperimentEvent, GamePhase } from './types';

// ─── типы ─────────────────────────────────────────────────────────────────────

export type Surface = 'floor' | 'wall_px' | 'wall_nx' | 'wall_pz' | 'wall_nz' | 'ceiling';

export interface Junction {
  id: number;
  pos: THREE.Vector3;   // мировая позиция
  surface: Surface;
  nutrient: number;
  mesh: THREE.Mesh;
}

export interface Vein {
  id: number;
  a: number; b: number;
  radius: number;
  flow: number;
  phase: number;
  age: number;
  mesh: THREE.Mesh;
}

export interface Tip {
  id: number;
  junctionId: number;
  dir: THREE.Vector3;   // направление на поверхности
  surface: Surface;
  energy: number;
  len: number;
  mesh: THREE.Mesh;
}

export interface WaveRing {
  pos: THREE.Vector3;
  surface: Surface;
  radius: number;
  life: number;
  mesh: THREE.Mesh;
}

export interface Organism {
  id: number;
  kind: 'bacteria' | 'fungus' | 'nematode';
  pos: THREE.Vector3;
  hp: number;
  mesh: THREE.Mesh;
  vx: number; vz: number;  // для нематод
  phase: number;
}

export interface LabObject {
  mesh: THREE.Group;
  pos: THREE.Vector3;
  size: THREE.Vector3;
  label: string;
  revealed: boolean;
  surfaces: Surface[];  // поверхности на которых растёт
}

// мутации
export type MutationType = 'eyes' | 'flagella' | 'toxin' | 'spores';
export interface Mutation {
  type: MutationType;
  level: number;  // 1-3
}

export interface GameState {
  phase: GamePhase;
  energy: number;
  size: number;
  bestSize: number;
  elementsEaten: number;
  buffs: Buff[];
  experiment: ExperimentEvent | null;
  freedom: boolean;
  mutations: Mutation[];
  surface: Surface;
}

export interface EngineCallbacks {
  onState: (s: GameState) => void;
  onEvent: (e: ExperimentEvent) => void;
  onAchievement: (id: string) => void;
  onElementEaten: (rare: boolean, symbol: string) => void;
  onMutation: (m: Mutation) => void;
  onKill: (kind: string) => void;
}

// ─── константы ────────────────────────────────────────────────────────────────

const LAB_W = 60;   // ширина лаборатории
const LAB_H = 22;   // высота
const LAB_D = 80;   // глубина

const TUBE_HALF = 16;

const MAX_J = 600;
const MAX_V = 900;
const MAX_T = 32;
const TIP_SPEED = 3.8;
const PULSE_FREQ = 1.4;
const RETRACT_R = 0.035;
const MAX_R = 1.2;
const GROW_R = 0.025;
const DECAY_R = 0.01;

// Цвета физарума
const C_BODY   = new THREE.Color(0.85, 0.75, 0.10);
const C_VEIN   = new THREE.Color(0.78, 0.88, 0.18);
const C_CORE   = new THREE.Color(0.95, 1.00, 0.50);
const C_TIP    = new THREE.Color(0.90, 1.00, 0.25);
const C_MEGA   = new THREE.Color(1.00, 0.82, 0.10);
const C_WAVE   = new THREE.Color(0.78, 0.97, 1.0);

let _id = 0;
const uid = () => ++_id;

// ─── утилиты Three.js ─────────────────────────────────────────────────────────

// Кэшированные нормали поверхностей — не создаём new Vector3 в каждом кадре
const SURFACE_NORMALS: Record<Surface, THREE.Vector3> = {
  floor:   new THREE.Vector3(0, 1, 0),
  ceiling: new THREE.Vector3(0, -1, 0),
  wall_px: new THREE.Vector3(-1, 0, 0),
  wall_nx: new THREE.Vector3(1, 0, 0),
  wall_pz: new THREE.Vector3(0, 0, -1),
  wall_nz: new THREE.Vector3(0, 0, 1),
};

// Переиспользуемые temp-векторы чтобы не создавать new Vector3 в loop
const _tmpA = new THREE.Vector3();
const _tmpC = new THREE.Vector3();
const _yUp  = new THREE.Vector3(0, 1, 0);

function makeCylinder(pa: THREE.Vector3, pb: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh {
  _tmpA.subVectors(pb, pa);
  const len = _tmpA.length() || 0.01;
  const geo = new THREE.CylinderGeometry(r, r, len, 7, 1);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(pa).addScaledVector(_tmpA.normalize(), len / 2);
  mesh.quaternion.setFromUnitVectors(_yUp, _tmpA);
  return mesh;
}

function makeSphere(r: number, mat: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.SphereGeometry(r, 8, 8), mat);
}

// получить нормаль поверхности — возвращает кэшированный объект (readonly)
function surfaceNormal(s: Surface): THREE.Vector3 {
  return SURFACE_NORMALS[s];
}

// спроецировать вектор движения на плоскость поверхности — пишет в out
function projectOnSurface(dir: THREE.Vector3, s: Surface, out?: THREE.Vector3): THREE.Vector3 {
  const n = SURFACE_NORMALS[s];
  const res = out ?? _tmpC;
  res.copy(dir).addScaledVector(n, -dir.dot(n));
  if (res.lengthSq() > 0) res.normalize();
  return res;
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
  waves: WaveRing[] = [];
  organisms: Organism[] = [];
  labObjects: LabObject[] = [];

  // центральное пятно-плазмодий
  blobMesh!: THREE.Mesh;
  blobPos = new THREE.Vector3(0, 0.05, 0);

  // материалы
  matVein!: THREE.MeshStandardMaterial;
  matTip!: THREE.MeshStandardMaterial;
  matJunc!: THREE.MeshStandardMaterial;
  matBlob!: THREE.MeshStandardMaterial;

  targetMarker!: THREE.Mesh;
  targetPos = new THREE.Vector3(0, 0, 0);

  phase: GamePhase = 'tube';
  energy = 75;
  freedom = false;
  elementsEaten = 0;
  bestSize = 0;
  buffs: Buff[] = [];
  mutations: Mutation[] = [];
  experiment: ExperimentEvent | null = null;
  currentSurface: Surface = 'floor';

  // статистика убийств
  kills = { bacteria: 0, fungus: 0, nematode: 0 };

  // капли протоплазмы — обновляются в главном loop, не в RAF
  drops: { t: number; veinA: number; veinB: number; dir: number; mesh: THREE.Mesh }[] = [];

  // temp-векторы для update методов (не создаём new в кадре)
  _tv1 = new THREE.Vector3();
  _tv2 = new THREE.Vector3();
  _tv3 = new THREE.Vector3();
  _blobTarget = new THREE.Vector3();

  // индекс вейнов по junction-id для O(1) pruneJ
  veinsByJ = new Map<number, Set<number>>();

  raf = 0;
  running = false;
  lastTime = 0;
  waveTimer = 0;
  experimentTimer = 0;
  foodTimer = 0;
  orgTimer = 0;
  breakT = 0;
  t = 0;

  raycaster = new THREE.Raycaster();
  // плоскости для raycast по поверхностям
  planes: { surface: Surface; plane: THREE.Plane }[] = [];

  constructor(canvas: HTMLCanvasElement, cb: EngineCallbacks) {
    this.canvas = canvas;
    this.cb = cb;
    this.initThree();
    this.reset();
  }

  // ─── Three.js init ────────────────────────────────────────────────────────

  initThree() {
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(W, H);
    this.renderer.setClearColor(0x04070d);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x030912, 0.012);

    this.camera = new THREE.PerspectiveCamera(58, W / H, 0.1, 600);
    this.camera.position.set(0, 42, 58);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 220;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };

    // Материалы
    this.matVein = new THREE.MeshStandardMaterial({ color: C_VEIN, emissive: C_VEIN, emissiveIntensity: 0.45, roughness: 0.4, metalness: 0.0, transparent: true, opacity: 0.88 });
    this.matTip  = new THREE.MeshStandardMaterial({ color: C_TIP, emissive: C_TIP, emissiveIntensity: 0.9, roughness: 0.3 });
    this.matJunc = new THREE.MeshStandardMaterial({ color: C_VEIN, emissive: C_VEIN, emissiveIntensity: 0.5, roughness: 0.4 });
    this.matBlob = new THREE.MeshStandardMaterial({ color: C_BODY, emissive: C_BODY, emissiveIntensity: 0.5, roughness: 0.55, metalness: 0.05, transparent: true, opacity: 0.82 });

    // Освещение
    this.scene.add(new THREE.AmbientLight(0x0a1520, 1.4));

    const sun = new THREE.DirectionalLight(0x88ddcc, 2.0);
    sun.position.set(20, 40, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    this.scene.add(sun);

    const fill = new THREE.PointLight(0x1133aa, 1.5, 300);
    fill.position.set(-30, 15, -20);
    this.scene.add(fill);

    // Маркер цели
    const mg = new THREE.RingGeometry(0.25, 0.45, 24);
    const mm = new THREE.MeshBasicMaterial({ color: 0xaaffaa, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthTest: false });
    this.targetMarker = new THREE.Mesh(mg, mm);
    this.scene.add(this.targetMarker);

    // planes для raycast
    this.planes = [
      { surface: 'floor',   plane: new THREE.Plane(new THREE.Vector3(0,1,0), 0) },
      { surface: 'ceiling', plane: new THREE.Plane(new THREE.Vector3(0,-1,0), -LAB_H) },
      { surface: 'wall_px', plane: new THREE.Plane(new THREE.Vector3(-1,0,0), -LAB_W/2) },
      { surface: 'wall_nx', plane: new THREE.Plane(new THREE.Vector3(1,0,0), -LAB_W/2) },
      { surface: 'wall_pz', plane: new THREE.Plane(new THREE.Vector3(0,0,-1), -LAB_D/2) },
      { surface: 'wall_nz', plane: new THREE.Plane(new THREE.Vector3(0,0,1), -LAB_D/2) },
    ];
  }

  // ─── reset ────────────────────────────────────────────────────────────────

  reset() {
    _id = 0;
    this.phase = 'tube';
    this.energy = 75;
    this.freedom = false;
    this.elementsEaten = 0;
    this.breakT = 0;
    this.buffs = [];
    this.mutations = [];
    this.experiment = null;
    this.currentSurface = 'floor';
    this.waveTimer = 0;
    this.experimentTimer = 0;
    this.foodTimer = 0;
    this.orgTimer = 0;
    this.kills = { bacteria: 0, fungus: 0, nematode: 0 };

    // чистим сцену
    const toRemove: THREE.Object3D[] = [];
    this.scene.children.forEach(c => {
      if (!(c instanceof THREE.Light)) toRemove.push(c);
    });
    toRemove.forEach(c => this.disposeObject(c));
    this.scene.children.forEach(c => { if (!(c instanceof THREE.Light)) this.scene.remove(c); });

    this.junctions.clear();
    this.veins.clear();
    this.tips = [];
    this.waves = [];
    this.organisms = [];
    this.labObjects = [];

    // маркер цели
    this.scene.add(this.targetMarker);

    this.buildLab();
    this.buildBlob();
    this.seedNetwork();
    this.spawnOrganisms(8, 'bacteria');

    this.camera.position.set(0, 42, 58);
    this.controls.target.set(0, 5, 0);
    this.controls.update();

    this.pushState();
  }

  disposeObject(obj: THREE.Object3D) {
    obj.traverse(c => {
      const m = c as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) {
        if (Array.isArray(m.material)) m.material.forEach(mt => mt.dispose());
        else (m.material as THREE.Material).dispose();
      }
    });
  }

  // ─── лаборатория ─────────────────────────────────────────────────────────

  buildLab() {
    const W = LAB_W, H = LAB_H, D = LAB_D;
    const hw = W / 2, hd = D / 2;

    // материалы стен
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x0d1e1a, roughness: 0.9, metalness: 0.05, side: THREE.BackSide });
    const room = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), wallMat);
    room.position.set(0, H / 2, 0);
    room.receiveShadow = true;
    this.scene.add(room);

    // пол — агаровая пластина
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x1a2e1a, roughness: 0.8, metalness: 0.02 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // сетка пола
    const grid = new THREE.GridHelper(W, 24, 0x0a2018, 0x061410);
    grid.position.y = 0.01;
    this.scene.add(grid);

    // лабораторные объекты
    this.addLabObject('microscope',  new THREE.Vector3(-22, 0, -28), new THREE.Vector3(5, 12, 5));
    this.addLabObject('microscope',  new THREE.Vector3(20, 0, -32), new THREE.Vector3(5, 12, 5));
    this.addLabObject('fridge',      new THREE.Vector3(-hw + 3, 0, -15), new THREE.Vector3(6, 14, 5));
    this.addLabObject('fridge',      new THREE.Vector3(-hw + 3, 0, 10), new THREE.Vector3(6, 14, 5));
    this.addLabObject('shelf',       new THREE.Vector3(hw - 3, 0, -20), new THREE.Vector3(4, 18, 8));
    this.addLabObject('shelf',       new THREE.Vector3(hw - 3, 0, 15), new THREE.Vector3(4, 18, 8));
    this.addLabObject('bench',       new THREE.Vector3(-10, 0, 30), new THREE.Vector3(20, 5, 6));
    this.addLabObject('bench',       new THREE.Vector3(12, 0, 30), new THREE.Vector3(16, 5, 6));
    this.addLabObject('centrifuge',  new THREE.Vector3(5, 0, -30), new THREE.Vector3(4, 6, 4));
    this.addLabObject('incubator',   new THREE.Vector3(-5, 0, -30), new THREE.Vector3(7, 9, 6));
    this.addLabObject('petri_rack',  new THREE.Vector3(0, 0, 25), new THREE.Vector3(8, 3, 5));
    this.addLabObject('computer',    new THREE.Vector3(-18, 0, 28), new THREE.Vector3(5, 8, 3));

    // пробирка (в начале игры)
    this.buildTube();

    // лампы на потолке
    for (let i = -1; i <= 1; i++) {
      const lamp = new THREE.PointLight(0xccffee, 1.8, 60);
      lamp.position.set(i * 18, H - 1, 0);
      this.scene.add(lamp);
      const lampMesh = new THREE.Mesh(
        new THREE.BoxGeometry(6, 0.4, 1.5),
        new THREE.MeshStandardMaterial({ color: 0xaaffdd, emissive: 0x44ffaa, emissiveIntensity: 1.2 })
      );
      lampMesh.position.set(i * 18, H - 0.3, 0);
      this.scene.add(lampMesh);
    }
  }

  addLabObject(type: string, pos: THREE.Vector3, size: THREE.Vector3) {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x1a3030, roughness: 0.7, metalness: 0.3 });
    const matMetal = new THREE.MeshStandardMaterial({ color: 0x445566, roughness: 0.3, metalness: 0.8 });
    const matGlass = new THREE.MeshStandardMaterial({ color: 0x88ccff, transparent: true, opacity: 0.35, roughness: 0.05 });
    const matScreen = new THREE.MeshStandardMaterial({ color: 0x002200, emissive: 0x00ff44, emissiveIntensity: 0.4 });

    switch (type) {
      case 'microscope': {
        // основание
        const base = new THREE.Mesh(new THREE.BoxGeometry(size.x, 1, size.z), mat.clone());
        base.position.y = 0.5;
        group.add(base);
        // колонна
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, size.y * 0.7, 10), matMetal.clone());
        col.position.y = size.y * 0.35 + 1;
        group.add(col);
        // объектив
        const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 1.5, 10), matMetal.clone());
        lens.position.set(1.2, size.y * 0.6, 0);
        lens.rotation.z = Math.PI / 2;
        group.add(lens);
        // окуляр
        const eye = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 2, 10), matMetal.clone());
        eye.position.set(0, size.y + 1, 0);
        group.add(eye);
        break;
      }
      case 'fridge': {
        const body = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), mat.clone());
        body.position.y = size.y / 2;
        group.add(body);
        const door = new THREE.Mesh(new THREE.BoxGeometry(size.x - 0.2, size.y * 0.95, 0.15), matMetal.clone());
        door.position.set(0, size.y / 2, size.z / 2 + 0.05);
        group.add(door);
        const handle = new THREE.Mesh(new THREE.BoxGeometry(0.15, size.y * 0.4, 0.2), matMetal.clone());
        handle.position.set(size.x * 0.35, size.y / 2, size.z / 2 + 0.2);
        group.add(handle);
        // подсветка синяя
        const light = new THREE.PointLight(0x0066ff, 0.8, 8);
        light.position.set(0, size.y * 0.6, size.z * 0.3);
        group.add(light);
        break;
      }
      case 'shelf': {
        // стойки
        for (let sx = -1; sx <= 1; sx += 2) {
          const pole = new THREE.Mesh(new THREE.BoxGeometry(0.3, size.y, 0.3), matMetal.clone());
          pole.position.set(sx * size.x / 2, size.y / 2, 0);
          group.add(pole);
        }
        // полки
        for (let i = 0; i < 4; i++) {
          const shelf = new THREE.Mesh(new THREE.BoxGeometry(size.x, 0.2, size.z), mat.clone());
          shelf.position.y = (i + 1) * size.y / 4.5;
          group.add(shelf);
          // пробирки на полке
          for (let t = 0; t < 5; t++) {
            const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.2, 8), matGlass.clone());
            tube.position.set(-size.x / 2 + 0.5 + t * 0.9, shelf.position.y + 0.7, 0);
            group.add(tube);
          }
        }
        break;
      }
      case 'bench': {
        const top = new THREE.Mesh(new THREE.BoxGeometry(size.x, 0.4, size.z), matMetal.clone());
        top.position.y = size.y;
        group.add(top);
        for (let lx = -1; lx <= 1; lx += 2) {
          for (let lz = -1; lz <= 1; lz += 2) {
            const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, size.y, 0.3), mat.clone());
            leg.position.set(lx * (size.x / 2 - 0.5), size.y / 2, lz * (size.z / 2 - 0.5));
            group.add(leg);
          }
        }
        // чашки Петри на столе
        for (let p = 0; p < 4; p++) {
          const petri = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.3, 16), matGlass.clone());
          petri.position.set(-size.x / 2 + 2 + p * 3.5, size.y + 0.25, 0);
          group.add(petri);
        }
        break;
      }
      case 'centrifuge': {
        const body = new THREE.Mesh(new THREE.CylinderGeometry(size.x / 2, size.x / 2, size.y, 14), mat.clone());
        body.position.y = size.y / 2;
        group.add(body);
        const rotor = new THREE.Mesh(new THREE.CylinderGeometry(size.x * 0.38, size.x * 0.38, 0.5, 12), matMetal.clone());
        rotor.position.y = size.y + 0.1;
        group.add(rotor);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const slot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1, 6), matMetal.clone());
          slot.position.set(Math.cos(a) * size.x * 0.25, size.y + 0.1, Math.sin(a) * size.x * 0.25);
          slot.rotation.x = Math.PI / 4;
          group.add(slot);
        }
        break;
      }
      case 'incubator': {
        const body = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), mat.clone());
        body.position.y = size.y / 2;
        group.add(body);
        const window_ = new THREE.Mesh(new THREE.BoxGeometry(size.x * 0.6, size.y * 0.5, 0.15), matGlass.clone());
        window_.position.set(0, size.y * 0.55, size.z / 2 + 0.05);
        group.add(window_);
        const glow = new THREE.PointLight(0xff6600, 0.8, 6);
        glow.position.set(0, size.y / 2, 0);
        group.add(glow);
        break;
      }
      case 'petri_rack': {
        const rack = new THREE.Mesh(new THREE.BoxGeometry(size.x, 0.3, size.z), mat.clone());
        rack.position.y = 0.15;
        group.add(rack);
        for (let px = -1; px <= 1; px++) {
          for (let pz = -1; pz <= 1; pz += 2) {
            const p = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.35, 16), matGlass.clone());
            p.position.set(px * 2.2, 0.4, pz * 1.2);
            group.add(p);
            // содержимое - цветная агара
            const agar = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.15, 16),
              new THREE.MeshStandardMaterial({ color: px === 0 ? 0x88ff44 : 0xff8844, transparent: true, opacity: 0.6 }));
            agar.position.set(px * 2.2, 0.4, pz * 1.2);
            group.add(agar);
          }
        }
        break;
      }
      case 'computer': {
        const body = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y * 0.6, size.z), mat.clone());
        body.position.y = size.y * 0.3;
        group.add(body);
        const monitor = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y * 0.5, 0.2), matScreen.clone());
        monitor.position.set(0, size.y * 0.8, -size.z * 0.3);
        monitor.rotation.x = -0.15;
        group.add(monitor);
        // данные на экране
        const screenGlow = new THREE.PointLight(0x00ff44, 0.6, 4);
        screenGlow.position.copy(monitor.position);
        group.add(screenGlow);
        break;
      }
      default: {
        const b = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), mat.clone());
        b.position.y = size.y / 2;
        group.add(b);
      }
    }

    group.position.copy(pos);
    group.traverse(c => { (c as THREE.Mesh).castShadow = true; (c as THREE.Mesh).receiveShadow = true; });
    this.scene.add(group);

    this.labObjects.push({
      mesh: group, pos: pos.clone(), size, label: type, revealed: false,
      surfaces: ['floor'],
    });
  }

  buildTube() {
    const s = TUBE_HALF * 2;
    const h = 10;
    const glassM = new THREE.MeshPhysicalMaterial({
      color: 0x88ddff, transparent: true, opacity: 0.12,
      roughness: 0.02, transmission: 0.9, side: THREE.DoubleSide,
    });
    const edgeM = new THREE.LineBasicMaterial({ color: 0x88ddff, transparent: true, opacity: 0.5 });

    // стены пробирки
    for (const [dx, dz, ry] of [[0, -1, 0], [0, 1, Math.PI], [-1, 0, Math.PI / 2], [1, 0, -Math.PI / 2]]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(s, h), glassM.clone());
      wall.position.set((dx as number) * TUBE_HALF, h / 2, (dz as number) * TUBE_HALF);
      wall.rotation.y = ry as number;
      this.scene.add(wall);
    }

    // рамки
    const pts = [
      new THREE.Vector3(-TUBE_HALF, 0, -TUBE_HALF),
      new THREE.Vector3(TUBE_HALF, 0, -TUBE_HALF),
      new THREE.Vector3(TUBE_HALF, 0, TUBE_HALF),
      new THREE.Vector3(-TUBE_HALF, 0, TUBE_HALF),
      new THREE.Vector3(-TUBE_HALF, 0, -TUBE_HALF),
    ];
    this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), edgeM));
    const topPts = pts.map(p => new THREE.Vector3(p.x, h, p.z));
    this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(topPts), edgeM));
    for (let i = 0; i < 4; i++) {
      this.scene.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([pts[i], topPts[i]]), edgeM
      ));
    }
  }

  // ─── центральное пятно-плазмодий ─────────────────────────────────────────

  buildBlob() {
    const geo = new THREE.SphereGeometry(3.5, 18, 18);
    this.blobMesh = new THREE.Mesh(geo, this.matBlob.clone());
    this.blobMesh.position.copy(this.blobPos);
    this.blobMesh.scale.set(1, 0.22, 1);  // приплюснутый — как настоящий плазмодий
    this.scene.add(this.blobMesh);
  }

  // ─── граф физарума ────────────────────────────────────────────────────────

  seedNetwork() {
    const s: Surface = 'floor';
    const c = this.addJunction(new THREE.Vector3(0, 0.02, 0), s);
    const dirs: [number, number][] = [[0,-1],[1,0],[0,1],[-1,0]];
    const ring: number[] = [];
    for (const [dx, dz] of dirs) {
      const j = this.addJunction(new THREE.Vector3(dx * 2, 0.02, dz * 2), s);
      ring.push(j);
      this.addVein(c, j, 0.38);
    }
    for (let i = 0; i < 4; i++) this.addVein(ring[i], ring[(i+1)%4], 0.22);
    for (const jid of ring) {
      const j = this.junctions.get(jid)!;
      const dx = j.pos.x / 2, dz = j.pos.z / 2;
      this.addTip(jid, new THREE.Vector3(dx, 0, dz), s);
    }
  }

  addJunction(pos: THREE.Vector3, surface: Surface): number {
    const id = uid();
    const mesh = makeSphere(0.16, this.matJunc.clone());
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.junctions.set(id, { id, pos: pos.clone(), surface, nutrient: 0, mesh });
    return id;
  }

  addVein(a: number, b: number, r = 0.14): number {
    const id = uid();
    const ja = this.junctions.get(a)!, jb = this.junctions.get(b)!;
    const mat = this.matVein.clone();
    const mesh = makeCylinder(ja.pos, jb.pos, r, mat);
    this.scene.add(mesh);
    this.veins.set(id, { id, a, b, radius: r, flow: 0, phase: Math.random() * Math.PI * 2, age: 0, mesh });
    // индекс
    if (!this.veinsByJ.has(a)) this.veinsByJ.set(a, new Set());
    if (!this.veinsByJ.has(b)) this.veinsByJ.set(b, new Set());
    this.veinsByJ.get(a)!.add(id);
    this.veinsByJ.get(b)!.add(id);
    return id;
  }

  addTip(jId: number, dir: THREE.Vector3, surface: Surface): Tip {
    const j = this.junctions.get(jId)!;
    const mesh = makeSphere(0.3, this.matTip.clone());
    mesh.position.copy(j.pos);
    this.scene.add(mesh);
    const tip: Tip = {
      id: uid(), junctionId: jId,
      dir: projectOnSurface(dir, surface).normalize(),
      surface, energy: 1, len: 0, mesh,
    };
    this.tips.push(tip);
    return tip;
  }

  removeVein(id: number) {
    const v = this.veins.get(id); if (!v) return;
    this.scene.remove(v.mesh); this.disposeObject(v.mesh);
    this.veinsByJ.get(v.a)?.delete(id);
    this.veinsByJ.get(v.b)?.delete(id);
    this.veins.delete(id);
  }

  removeJunction(id: number) {
    const j = this.junctions.get(id); if (!j) return;
    this.scene.remove(j.mesh); this.disposeObject(j.mesh);
    this.junctions.delete(id);
  }

  removeTip(i: number) {
    const t = this.tips[i];
    this.scene.remove(t.mesh); this.disposeObject(t.mesh);
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
      this.t = t;
      this.update(dt, t);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() { this.running = false; cancelAnimationFrame(this.raf); }

  resize() {
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    this.renderer.setSize(W, H);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();
  }

  // ─── update ───────────────────────────────────────────────────────────────

  update(dt: number, t: number) {
    if (this.phase === 'dead') return;

    this.updateBlob(dt, t);
    this.updatePressures(t);
    this.updateVeins(dt, t);
    this.updateTips(dt, t);
    this.pruneDeadVeins();
    this.updateDrops(dt);
    this.updateOrganisms(dt, t);
    this.updateWaves(dt);

    // энергия
    let drain = 1.0 + this.junctions.size * 0.0008;
    if (this.experiment?.label === 'Ускорение метаболизма') drain *= 2;
    if (this.hasBuff('regen')) drain = -2.5;
    this.energy = Math.max(0, Math.min(100, this.energy - drain * dt));
    if (this.energy <= 0) { this.phase = 'dead'; this.pushState(); return; }

    // волны осязания
    this.waveTimer -= dt;
    const eyeLvl = this.getMutationLevel('eyes');
    const waveInt = 0.28 - eyeLvl * 0.05;
    if (this.waveTimer <= 0) { this.waveTimer = waveInt; this.emitWaves(); }

    // еда
    this.eatNearby();
    this.foodTimer -= dt;
    if (this.phase !== 'tube' && this.foodTimer <= 0) {
      this.foodTimer = 2 + Math.random() * 3;
      this.spawnBacteria();
    }

    // организмы
    this.orgTimer -= dt;
    if (this.phase !== 'tube' && this.orgTimer <= 0) {
      this.orgTimer = 8 + Math.random() * 10;
      const r = Math.random();
      if (r < 0.4) this.spawnOrganisms(3, 'bacteria');
      else if (r < 0.65) this.spawnOrganisms(2, 'fungus');
      else this.spawnOrganisms(1, 'nematode');
    }

    // эксперименты
    if (this.phase === 'tube') {
      this.experimentTimer -= dt;
      if (this.experimentTimer <= 0) {
        this.experimentTimer = 14 + Math.random() * 14;
        this.triggerExperiment(t);
      }
    }
    if (this.experiment && t - this.experiment.at > 5000) this.experiment = null;

    this.buffs = this.buffs.filter(b => b.until > t);

    // побег
    const size = this.junctions.size;
    if (this.phase === 'tube' && this.energy >= 88 && size >= 200) this.startEscape();
    if (this.phase === 'breaking') {
      this.breakT += dt;
      if (this.breakT > 2.0) {
        this.phase = 'world';
        this.freedom = true;
        this.cb.onAchievement('escape');
        this.controls.maxDistance = 400;
      }
    }

    if (size >= 500) this.cb.onAchievement('survive');
    if (size >= 1000) this.cb.onAchievement('size1000');
    if (this.kills.nematode >= 3) this.cb.onAchievement('killer');

    if (Math.floor(t / 160) !== Math.floor((t - dt * 1000) / 160)) this.pushState();
  }

  // ─── анимация пятна-плазмодия ─────────────────────────────────────────────

  updateBlob(dt: number, t: number) {
    const c = this.getCentroid();
    this._blobTarget.set(c.x, 0.05, c.z);
    this.blobPos.lerp(this._blobTarget, dt * 3);
    this.blobMesh.position.copy(this.blobPos);

    // пульсация
    const pulse = 0.9 + Math.sin(t * PULSE_FREQ * Math.PI * 2) * 0.1;
    const sizeScale = Math.min(2.8, 1 + this.junctions.size * 0.003);
    this.blobMesh.scale.set(sizeScale * pulse, 0.22 + Math.sin(t * 2.2) * 0.03, sizeScale * pulse);

    // цвет от мутаций
    const mat = this.blobMesh.material as THREE.MeshStandardMaterial;
    if (this.hasBuff('mega')) {
      mat.color.set(C_MEGA); mat.emissive.set(C_MEGA); mat.emissiveIntensity = 0.7;
    } else {
      mat.color.set(C_BODY); mat.emissive.set(C_BODY);
      mat.emissiveIntensity = 0.4 + Math.sin(t * 1.8) * 0.15;
    }

    // если есть мутация глаз — добавляем «зрачки»
    if (this.getMutationLevel('eyes') > 0 && !this.scene.getObjectByName('eye_l')) {
      const eyeM = new THREE.MeshStandardMaterial({ color: 0x000011, emissive: 0x0044ff, emissiveIntensity: 1.5 });
      const eyeGeo = new THREE.SphereGeometry(0.22, 8, 8);
      const eyeL = new THREE.Mesh(eyeGeo, eyeM); eyeL.name = 'eye_l';
      const eyeR = new THREE.Mesh(eyeGeo, eyeM); eyeR.name = 'eye_r';
      this.blobMesh.add(eyeL); this.blobMesh.add(eyeR);
      eyeL.position.set(-0.5, 2, 0.8);
      eyeR.position.set(0.5, 2, 0.8);
    }
  }

  // ─── Hagen-Poiseuille ─────────────────────────────────────────────────────

  updatePressures(t: number) {
    const pulse = Math.sin(t * PULSE_FREQ * Math.PI * 2);
    const pressure = new Map<number, number>();
    for (const [id, j] of this.junctions) {
      const d = j.pos.distanceTo(this.targetPos) + 0.1;
      pressure.set(id, 1.2 / d + pulse * 0.1 + j.nutrient * 0.4);
    }
    for (const [, v] of this.veins) {
      const pa = pressure.get(v.a) ?? 0, pb = pressure.get(v.b) ?? 0;
      v.flow = Math.pow(v.radius, 4) * (pa - pb);
    }
  }

  updateVeins(dt: number, t: number) {
    for (const [, v] of this.veins) {
      v.age += dt;
      v.phase += PULSE_FREQ * Math.PI * 2 * dt;
      const af = Math.abs(v.flow);
      const tR = af > 0.00002
        ? Math.min(MAX_R, v.radius + GROW_R * dt * af * 400)
        : Math.max(RETRACT_R, v.radius - DECAY_R * dt);
      if (this.hasBuff('growth')) v.radius = Math.min(MAX_R, v.radius + 0.1 * dt);
      else v.radius += (tR - v.radius) * Math.min(1, dt * 2);

      const ja = this.junctions.get(v.a), jb = this.junctions.get(v.b);
      if (!ja || !jb) continue;

      const pulse = 0.68 + Math.sin(v.phase + t * PULSE_FREQ * Math.PI * 2) * 0.32;
      const mat = v.mesh.material as THREE.MeshStandardMaterial;
      const mega = this.hasBuff('mega');
      mat.color.set(mega ? C_MEGA : C_VEIN);
      mat.emissive.set(mega ? C_MEGA : C_VEIN);
      mat.emissiveIntensity = (0.3 + Math.min(1, af * 700) * 0.7) * pulse;
      mat.opacity = 0.7 + pulse * 0.18;

      // обновляем масштаб цилиндра вместо пересоздания геометрии
      const curR = (v.mesh.geometry as THREE.CylinderGeometry).parameters?.radiusTop ?? 0;
      if (Math.abs(curR - v.radius) > 0.012) {
        const scale = v.radius / Math.max(curR, 0.001);
        v.mesh.scale.x = scale;
        v.mesh.scale.z = scale;
      }

      // бегущие капли протоплазмы — добавляем в массив, анимируем в update()
      if (this.drops.length < 40 && v.radius > 0.3 && Math.abs(v.flow) > 0.00002 && Math.random() < 0.008) {
        const drop = makeSphere(v.radius * 0.5, new THREE.MeshBasicMaterial({ color: C_CORE }));
        drop.position.copy(ja.pos);
        this.scene.add(drop);
        this.drops.push({ t: 0, veinA: v.a, veinB: v.b, dir: v.flow > 0 ? 1 : -1, mesh: drop });
      }
    }
  }

  updateTips(dt: number, _t: number) {
    const flagellaLvl = this.getMutationLevel('flagella');
    const speed = TIP_SPEED * (1 + flagellaLvl * 0.5) * (this.hasBuff('speed') ? 1.8 : 1)
                * (this.experiment?.label === 'Криозаморозка' ? 0.35 : 1);

    for (let i = this.tips.length - 1; i >= 0; i--) {
      const tip = this.tips[i];
      const junc = this.junctions.get(tip.junctionId);
      if (!junc) { this.removeTip(i); continue; }

      // хемотаксис к цели — переиспользуем _tv1 вместо new Vector3
      this._tv1.subVectors(this.targetPos, junc.pos);
      projectOnSurface(this._tv1, tip.surface, this._tv2);  // attract в _tv2
      const attract = this._tv2;

      // притяжение к ближайшей бактерии — _tv3 как bestFoodDir
      this._tv3.set(0, 0, 0);
      let bestFoodD = Infinity;
      for (const org of this.organisms) {
        if (org.kind !== 'bacteria') continue;
        const d = junc.pos.distanceTo(org.pos);
        if (d < 25 && d < bestFoodD) {
          bestFoodD = d;
          this._tv3.subVectors(org.pos, junc.pos).normalize();
        }
      }

      // отталкивание от нематод (если есть токсины — наоборот)
      const toxinLvl = this.getMutationLevel('toxin');
      for (const org of this.organisms) {
        if (org.kind !== 'nematode') continue;
        const d = junc.pos.distanceTo(org.pos);
        if (d < 15) {
          this._tv1.subVectors(junc.pos, org.pos).normalize();
          if (toxinLvl > 0) attract.addScaledVector(this._tv1, -1.5);
          else attract.addScaledVector(this._tv1, 2.0);
        }
      }

      // случайный дрейф — используем _tv1
      this._tv1.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      if (this._tv1.lengthSq() > 0) this._tv1.normalize();
      tip.dir.addScaledVector(attract, 0.16)
              .addScaledVector(this._tv3, 0.2)
              .addScaledVector(this._tv1, 0.36);
      projectOnSurface(tip.dir, tip.surface, tip.dir);

      // newPos — переиспользуем _tv1
      this._tv1.copy(junc.pos).addScaledVector(tip.dir, speed * dt);
      const newPos = this._tv1;

      // проверяем переход на другую поверхность (ребро комнаты)
      const nextSurface = this.checkSurfaceTransition(newPos, tip.surface);

      // стенки в режиме пробирки
      if (this.phase === 'tube') {
        if (Math.abs(newPos.x) > TUBE_HALF - 0.5) tip.dir.x *= -1;
        if (Math.abs(newPos.z) > TUBE_HALF - 0.5) tip.dir.z *= -1;
        if (Math.abs(newPos.x) > TUBE_HALF - 0.5 || Math.abs(newPos.z) > TUBE_HALF - 0.5) {
          tip.mesh.position.copy(junc.pos); continue;
        }
      }

      tip.len += speed * dt;
      if (tip.len > 1.4 && this.junctions.size < MAX_J && this.veins.size < MAX_V) {
        tip.len = 0;
        // snapToSurface пишет в newPos (который это _tv1) — не создаём новый объект
        this.snapToSurface(newPos, nextSurface, newPos);
        const newJ = this.addJunction(newPos, nextSurface);
        this.addVein(tip.junctionId, newJ, 0.1 + Math.random() * 0.06);
        tip.junctionId = newJ;
        tip.surface = nextSurface;
        tip.mesh.position.copy(newPos);

        // ветвление
        const branchProb = this.hasBuff('growth') ? 0.26 : 0.11;
        if (this.tips.length < MAX_T && Math.random() < branchProb) {
          const angle = (Math.random() - 0.5) * Math.PI * 0.75;
          // applyAxisAngle не мутирует нормаль — берём _tv3 как bDir
          this._tv3.copy(tip.dir).applyAxisAngle(SURFACE_NORMALS[nextSurface], angle);
          this.addTip(newJ, this._tv3, nextSurface);
        }
      } else {
        this.snapToSurface(newPos, tip.surface, junc.pos);
        junc.mesh.position.copy(junc.pos);
        tip.mesh.position.copy(junc.pos);
      }

      // анимация кончика
      const mat = tip.mesh.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.7 + Math.sin(_t * 0.005 + tip.id) * 0.3;

      if (this.energy < 10) tip.energy -= dt * 0.5;
      if (tip.energy <= 0) this.removeTip(i);
    }

    if (this.tips.length < 2 && this.junctions.size > 0) {
      // берём случайный junction без создания массива
      const keys = this.junctions.keys();
      let j: Junction | undefined;
      let skip = Math.floor(Math.random() * this.junctions.size);
      for (const k of keys) { j = this.junctions.get(k); if (skip-- <= 0) break; }
      if (j) {
        this._tv1.set(Math.random() - 0.5, 0, Math.random() - 0.5);
        this.addTip(j.id, this._tv1, j.surface);
      }
    }
  }

  // переход между поверхностями у края
  checkSurfaceTransition(pos: THREE.Vector3, cur: Surface): Surface {
    if (this.phase === 'tube') return cur;
    const hw = LAB_W / 2, hd = LAB_D / 2, ch = LAB_H;
    if (cur === 'floor') {
      if (pos.x > hw - 0.3) return 'wall_px';
      if (pos.x < -hw + 0.3) return 'wall_nx';
      if (pos.z > hd - 0.3) return 'wall_pz';
      if (pos.z < -hd + 0.3) return 'wall_nz';
    }
    if (cur === 'wall_px' || cur === 'wall_nx' || cur === 'wall_pz' || cur === 'wall_nz') {
      if (pos.y < 0.2) return 'floor';
      if (pos.y > ch - 0.2) return 'ceiling';
    }
    if (cur === 'ceiling') {
      if (pos.x > hw - 0.3) return 'wall_px';
      if (pos.x < -hw + 0.3) return 'wall_nx';
      if (pos.z > hd - 0.3) return 'wall_pz';
      if (pos.z < -hd + 0.3) return 'wall_nz';
    }
    return cur;
  }

  // привязать позицию к поверхности — пишет в out (без new Vector3)
  snapToSurface(pos: THREE.Vector3, s: Surface, out?: THREE.Vector3): THREE.Vector3 {
    const p = out ?? pos;
    if (p !== pos) p.copy(pos);
    const off = 0.02;
    switch (s) {
      case 'floor':   p.y = off; break;
      case 'ceiling': p.y = LAB_H - off; break;
      case 'wall_px': p.x = LAB_W / 2 - off; break;
      case 'wall_nx': p.x = -LAB_W / 2 + off; break;
      case 'wall_pz': p.z = LAB_D / 2 - off; break;
      case 'wall_nz': p.z = -LAB_D / 2 + off; break;
    }
    return p;
  }

  pruneDeadVeins() {
    for (const [id, v] of this.veins) {
      if (v.radius < RETRACT_R && v.age > 2) {
        this.removeVein(id);
        this.tryPruneJ(v.a);
        this.tryPruneJ(v.b);
      }
    }
  }

  tryPruneJ(jId: number) {
    const set = this.veinsByJ.get(jId);
    if (set && set.size > 0) return;
    if (this.tips.some(t => t.junctionId === jId)) return;
    this.removeJunction(jId);
  }

  // ─── капли протоплазмы (главный loop, без вложенного RAF) ────────────────

  updateDrops(dt: number) {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.t += dt * 2.2;  // ~0.45с на проход
      if (d.t >= 1) {
        this.scene.remove(d.mesh);
        this.disposeObject(d.mesh);
        this.drops.splice(i, 1);
        continue;
      }
      const ja = this.junctions.get(d.veinA);
      const jb = this.junctions.get(d.veinB);
      if (!ja || !jb) {
        this.scene.remove(d.mesh);
        this.disposeObject(d.mesh);
        this.drops.splice(i, 1);
        continue;
      }
      const frac = d.dir > 0 ? d.t : 1 - d.t;
      d.mesh.position.lerpVectors(ja.pos, jb.pos, frac);
    }
  }

  // ─── организмы ────────────────────────────────────────────────────────────

  spawnBacteria() {
    const c = this.getCentroid();
    const ang = Math.random() * Math.PI * 2;
    const d = 15 + Math.random() * 35;
    this.spawnOrg('bacteria', new THREE.Vector3(c.x + Math.cos(ang) * d, 0.2, c.z + Math.sin(ang) * d));
  }

  spawnOrganisms(count: number, kind: Organism['kind']) {
    const c = this.getCentroid();
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const d = kind === 'nematode' ? 25 + Math.random() * 40 : 12 + Math.random() * 28;
      const pos = new THREE.Vector3(c.x + Math.cos(ang) * d, kind === 'nematode' ? 0.3 : 0.15, c.z + Math.sin(ang) * d);
      this.spawnOrg(kind, pos);
    }
  }

  spawnOrg(kind: Organism['kind'], pos: THREE.Vector3) {
    const id = uid();
    let geo: THREE.BufferGeometry;
    let col: number;
    let hp: number;
    switch (kind) {
      case 'bacteria':
        geo = new THREE.SphereGeometry(0.28, 7, 7);
        col = 0x44ff88; hp = 1; break;
      case 'fungus':
        geo = new THREE.ConeGeometry(0.5, 1.2, 8);
        col = 0xff8833; hp = 4; break;
      case 'nematode':
        geo = new THREE.CapsuleGeometry(0.18, 1.4, 6, 10);
        col = 0xff3333; hp = 8; break;
    }
    const mat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.35, roughness: 0.6 });
    const mesh = new THREE.Mesh(geo!, mat);
    mesh.position.copy(pos);
    mesh.castShadow = true;
    this.scene.add(mesh);

    const org: Organism = { id, kind, pos: pos.clone(), hp, mesh, vx: (Math.random()-0.5)*2, vz: (Math.random()-0.5)*2, phase: Math.random()*Math.PI*2 };
    this.organisms.push(org);
  }

  updateOrganisms(dt: number, t: number) {
    const toxinLvl = this.getMutationLevel('toxin');

    for (let i = this.organisms.length - 1; i >= 0; i--) {
      const org = this.organisms[i];
      org.phase += dt;

      if (org.kind === 'nematode') {
        // нематоды ползают к физаруму
        const c = this.getCentroid();
        const toDx = c.x - org.pos.x, toDz = c.z - org.pos.z;
        const toD = Math.hypot(toDx, toDz) + 0.1;
        org.vx += (toDx / toD) * 4 * dt;
        org.vz += (toDz / toD) * 4 * dt;
        org.vx = Math.max(-3, Math.min(3, org.vx));
        org.vz = Math.max(-3, Math.min(3, org.vz));
        org.pos.x += org.vx * dt;
        org.pos.z += org.vz * dt;
        org.mesh.position.copy(org.pos);
        org.mesh.rotation.y = Math.atan2(org.vx, org.vz);
        org.mesh.rotation.z = Math.sin(org.phase * 8) * 0.3;  // извивание

        // нематода ест физарум
        for (let vi = this.veins.size - 1; vi >= 0; vi--) { /* handled below */ }
        for (const [vid, v] of this.veins) {
          const ja = this.junctions.get(v.a), jb = this.junctions.get(v.b);
          if (!ja || !jb) continue;
          const mid = ja.pos.clone().add(jb.pos).multiplyScalar(0.5);
          if (org.pos.distanceTo(mid) < 1.5) {
            v.radius -= 0.1 * dt;
            this.energy -= 0.5 * dt;
          }
        }
        // токсины убивают нематоду рядом
        if (toxinLvl > 0) {
          const c2 = this.getCentroid();
          if (org.pos.distanceTo(new THREE.Vector3(c2.x, 0, c2.z)) < 6 + toxinLvl * 3) {
            org.hp -= toxinLvl * 5 * dt;
          }
        }
      } else if (org.kind === 'fungus') {
        // грибки растут на месте и блокируют
        org.mesh.scale.y = 1 + Math.sin(org.phase * 0.5) * 0.1;
        // замедляют рост веин рядом
        for (const [, v] of this.veins) {
          const ja = this.junctions.get(v.a); if (!ja) continue;
          if (ja.pos.distanceTo(org.pos) < 3) v.radius -= 0.05 * dt;
        }
        // грибок получает урон от токсинов
        if (toxinLvl > 0) {
          for (const [, j] of this.junctions) {
            if (j.pos.distanceTo(org.pos) < 4) { org.hp -= toxinLvl * 2 * dt; break; }
          }
        }
      } else {
        // бактерии просто плавают
        org.pos.x += Math.sin(org.phase * 1.3) * 0.8 * dt;
        org.pos.z += Math.cos(org.phase * 1.1) * 0.8 * dt;
        org.mesh.position.copy(org.pos);
        org.mesh.rotation.y += dt * 1.5;
      }

      if (org.hp <= 0) {
        this.scene.remove(org.mesh); this.disposeObject(org.mesh);
        this.organisms.splice(i, 1);
        this.kills[org.kind]++;
        this.cb.onKill(org.kind);
      }
    }
  }

  // ─── еда ──────────────────────────────────────────────────────────────────

  eatNearby() {
    const eatR = 1.8 + Math.min(2, this.junctions.size * 0.003);
    for (let i = this.organisms.length - 1; i >= 0; i--) {
      const org = this.organisms[i];
      if (org.kind === 'nematode') continue;  // нематоду не едим просто так
      for (const [, j] of this.junctions) {
        if (j.pos.distanceTo(org.pos) < eatR) {
          const isFungus = org.kind === 'fungus';
          this.energy = Math.min(100, this.energy + (isFungus ? 5 : 8));
          if (!isFungus) this.burstGrowth(org.pos, 5);
          else this.burstGrowth(org.pos, 2);
          this.scene.remove(org.mesh); this.disposeObject(org.mesh);
          this.organisms.splice(i, 1);
          this.kills[org.kind]++;
          this.cb.onKill(org.kind);
          break;
        }
      }
    }

    // поедание элементов (если есть на полу как объекты)
    for (const [, j] of this.junctions) {
      // проверяем ближайшие labObjects типа 'element'
    }
  }

  burstGrowth(pos: THREE.Vector3, count: number) {
    let bestJ: Junction | null = null, bestD = Infinity;
    for (const [, j] of this.junctions) {
      const d = j.pos.distanceTo(pos);
      if (d < bestD) { bestD = d; bestJ = j; }
    }
    if (!bestJ) return;
    for (let i = 0; i < count && this.tips.length < MAX_T; i++) {
      const a = (i / count) * Math.PI * 2;
      this.addTip(bestJ.id, new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), bestJ.surface);
    }
    for (const [, v] of this.veins) {
      const ja = this.junctions.get(v.a), jb = this.junctions.get(v.b);
      if (!ja || !jb) continue;
      const mid = ja.pos.clone().add(jb.pos).multiplyScalar(0.5);
      if (mid.distanceTo(pos) < 8) v.radius = Math.min(MAX_R, v.radius + 0.18);
    }
  }

  // ─── волны осязания ───────────────────────────────────────────────────────

  emitWaves() {
    // Волна — один базовый RingGeometry r=1, масштабируем через mesh.scale
    const jArr = [...this.junctions.values()];
    const step = Math.max(1, Math.floor(jArr.length / 10));
    for (let i = 0; i < jArr.length; i += step) {
      const j = jArr[i];
      // базовая геометрия кольца радиусом 1 — масштабируем в updateWaves
      const geo = new THREE.RingGeometry(0.9, 1.0, 48);
      const mat = new THREE.MeshBasicMaterial({ color: C_WAVE, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.scale.setScalar(0.05);

      // ориентируем кольцо по нормали поверхности
      const n = SURFACE_NORMALS[j.surface];
      mesh.quaternion.setFromUnitVectors(_yUp, n);
      mesh.position.copy(j.pos).addScaledVector(n, 0.05);
      this.scene.add(mesh);

      this.waves.push({ pos: j.pos.clone(), surface: j.surface, radius: 0.05, life: 1.8, mesh });
    }
  }

  updateWaves(dt: number) {
    const eyeLvl = this.getMutationLevel('eyes');
    const waveRange = (this.phase === 'tube' ? TUBE_HALF * 1.4 : 42) * (1 + eyeLvl * 0.4);
    const waveSpeed = this.phase === 'tube' ? 11 : 18;

    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.radius += waveSpeed * dt;
      w.life -= dt;

      // scale вместо пересоздания геометрии — ключевая оптимизация
      w.mesh.scale.setScalar(w.radius);
      (w.mesh.material as THREE.MeshBasicMaterial).opacity = (w.life / 1.8) * 0.45;

      this.checkWaveReveal(w);

      if (w.life <= 0 || w.radius > waveRange) {
        this.scene.remove(w.mesh); this.disposeObject(w.mesh);
        this.waves.splice(i, 1);
      }
    }
  }

  checkWaveReveal(w: WaveRing) {
    // организмы
    for (const org of this.organisms) {
      if (org.surface !== undefined) continue;
      const d = org.pos.distanceTo(w.pos);
      if (Math.abs(d - w.radius) < 2) {
        const mat = org.mesh.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 1.5;
        setTimeout(() => { if (mat) mat.emissiveIntensity = 0.35; }, 300);
      }
    }
    // лаб-объекты
    for (const obj of this.labObjects) {
      if (obj.revealed) continue;
      const d = obj.pos.distanceTo(w.pos);
      if (Math.abs(d - w.radius) < 4) {
        obj.revealed = true;
        // вспышка при обнаружении
        const light = new THREE.PointLight(0x5feedd, 4, 16);
        light.position.copy(obj.pos).y += 4;
        this.scene.add(light);
        setTimeout(() => this.scene.remove(light), 800);
      }
    }
  }

  // ─── мутации ─────────────────────────────────────────────────────────────

  getMutationLevel(type: MutationType): number {
    return this.mutations.find(m => m.type === type)?.level ?? 0;
  }

  applyMutation(symbol: string) {
    // элемент → мутация
    const map: Record<string, MutationType> = {
      'Au': 'eyes', 'Pt': 'eyes',
      'Fe': 'flagella', 'Na': 'flagella',
      'Cl': 'toxin', 'K': 'toxin',
      'He': 'spores', 'Li': 'spores',
    };
    const type = map[symbol];
    if (!type) return;
    const existing = this.mutations.find(m => m.type === type);
    if (existing && existing.level < 3) {
      existing.level++;
      this.cb.onMutation(existing);
    } else if (!existing) {
      const mut: Mutation = { type, level: 1 };
      this.mutations.push(mut);
      this.cb.onMutation(mut);
      this.cb.onAchievement('mutation_' + type);
    }
  }

  // ─── эксперименты / баффы ─────────────────────────────────────────────────

  hasBuff(t: Buff['type']) { return this.buffs.some(b => b.type === t); }

  addBuff(type: Buff['type']) {
    const m = BUFF_META[type];
    const until = performance.now() + m.ms;
    const ex = this.buffs.find(b => b.type === type);
    if (ex) ex.until = until; else this.buffs.push({ type, label: m.label, icon: m.icon, color: m.color, until });
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
    this.experiment = null;
    this.pushState();
  }

  // ─── вспомогательные ─────────────────────────────────────────────────────

  getCentroid(): { x: number; z: number } {
    if (this.junctions.size === 0) return { x: 0, z: 0 };
    let sx = 0, sz = 0;
    for (const [, j] of this.junctions) { sx += j.pos.x; sz += j.pos.z; }
    return { x: sx / this.junctions.size, z: sz / this.junctions.size };
  }

  pushState() {
    this.bestSize = Math.max(this.bestSize, this.junctions.size);
    const c = this.getCentroid();
    // определяем текущую поверхность по ближайшему кончику
    if (this.tips.length > 0) this.currentSurface = this.tips[this.tips.length - 1].surface;
    this.cb.onState({
      phase: this.phase, energy: this.energy,
      size: this.junctions.size, bestSize: this.bestSize,
      elementsEaten: this.elementsEaten, buffs: [...this.buffs],
      experiment: this.experiment, freedom: this.freedom,
      mutations: [...this.mutations], surface: this.currentSurface,
    });
  }

  // клик/тап → аттрактант
  setTargetFromScreen(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);

    // пробуем все поверхности, берём ближайшую
    let bestDist = Infinity;
    let bestPt = new THREE.Vector3();
    for (const { plane } of this.planes) {
      const pt = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(plane, pt)) {
        const d = this.camera.position.distanceTo(pt);
        if (d < bestDist) { bestDist = d; bestPt = pt; }
      }
    }

    this.targetPos.copy(bestPt);
    // orient marker
    const surface = this.nearestSurface(bestPt);
    const n = surfaceNormal(surface);
    this.targetMarker.position.copy(bestPt).addScaledVector(n, 0.05);
    this.targetMarker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  }

  nearestSurface(pos: THREE.Vector3): Surface {
    const hw = LAB_W / 2, hd = LAB_D / 2;
    const dists: [number, Surface][] = [
      [pos.y, 'floor'],
      [LAB_H - pos.y, 'ceiling'],
      [hw - pos.x, 'wall_px'],
      [pos.x + hw, 'wall_nx'],
      [hd - pos.z, 'wall_pz'],
      [pos.z + hd, 'wall_nz'],
    ];
    dists.sort((a, b) => a[0] - b[0]);
    return dists[0][1];
  }

  head() { return { x: this.blobPos.x, z: this.blobPos.z }; }
}

