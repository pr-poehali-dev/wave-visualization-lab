export interface Wave {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  life: number;
  flicker: number;
}

export type FoodKind = 'pellet' | 'element';

export interface Element {
  symbol: string;
  name: string;
  color: string;
  buff: BuffType;
  rare: boolean;
}

export interface Food {
  x: number;
  y: number;
  kind: FoodKind;
  revealed: boolean;
  reveal: number;
  element?: Element;
  pulse: number;
}

export interface Structure {
  x: number;
  y: number;
  w: number;
  h: number;
  type: string;
  label: string;
  revealed: boolean;
  reveal: number;
  seed: number;
}

export type BuffType =
  | 'speed'
  | 'regen'
  | 'growth'
  | 'range'
  | 'spore'
  | 'mega';

export interface Buff {
  type: BuffType;
  label: string;
  icon: string;
  color: string;
  until: number;
}

export interface Achievement {
  id: string;
  title: string;
  desc: string;
  icon: string;
  unlocked: boolean;
}

export interface SaveData {
  bestSize: number;
  escapes: number;
  elementsEaten: number;
  achievements: string[];
}

export type GamePhase = 'tube' | 'breaking' | 'world' | 'dead';

export interface ExperimentEvent {
  label: string;
  desc: string;
  color: string;
  at: number;
}