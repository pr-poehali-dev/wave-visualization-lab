import { Element, BuffType } from './types';

export const ELEMENTS: Element[] = [
  { symbol: 'H', name: 'Водород', color: '#e8f4ff', buff: 'speed', rare: false },
  { symbol: 'He', name: 'Гелий', color: '#d4a8ff', buff: 'range', rare: false },
  { symbol: 'Li', name: 'Литий', color: '#ff8fa3', buff: 'regen', rare: false },
  { symbol: 'C', name: 'Углерод', color: '#9aa6b2', buff: 'growth', rare: false },
  { symbol: 'O', name: 'Кислород', color: '#5ff0e0', buff: 'regen', rare: false },
  { symbol: 'Na', name: 'Натрий', color: '#ffd166', buff: 'speed', rare: false },
  { symbol: 'Cl', name: 'Хлор', color: '#a8ffb0', buff: 'spore', rare: false },
  { symbol: 'K', name: 'Калий', color: '#c8a0ff', buff: 'range', rare: false },
  { symbol: 'Ca', name: 'Кальций', color: '#fff0d4', buff: 'growth', rare: false },
  { symbol: 'Fe', name: 'Железо', color: '#ff9d6c', buff: 'growth', rare: false },
  { symbol: 'Au', name: 'Золото', color: '#ffd700', buff: 'mega', rare: true },
  { symbol: 'Pt', name: 'Платина', color: '#b8e0ff', buff: 'mega', rare: true },
];

export const BUFF_META: Record<
  BuffType,
  { label: string; icon: string; color: string; ms: number }
> = {
  speed: { label: 'Ускорение', icon: 'Zap', color: '#ffd166', ms: 6000 },
  regen: { label: 'Регенерация', icon: 'HeartPulse', color: '#5ff0e0', ms: 7000 },
  growth: { label: 'Рост сети', icon: 'Sprout', color: '#a8ffb0', ms: 5000 },
  range: { label: 'Дальность', icon: 'Radar', color: '#c8a0ff', ms: 8000 },
  spore: { label: 'Споры', icon: 'Wind', color: '#a8ffb0', ms: 6000 },
  mega: { label: 'Мутация', icon: 'Atom', color: '#ffd700', ms: 9000 },
};

export const EXPERIMENTS = [
  { label: 'Ускорение метаболизма', desc: 'Энергия тратится быстрее', color: '#ff9d6c' },
  { label: 'Энергетический разряд', desc: 'Резкая потеря энергии', color: '#ff6b6b' },
  { label: 'Споровый выброс', desc: 'Временные споры активны', color: '#a8ffb0' },
  { label: 'Криозаморозка', desc: 'Движение замедлено', color: '#5ff0e0' },
  { label: 'Усиление сенсоров', desc: 'Дальность осязания выше', color: '#c8a0ff' },
];

export const STRUCTURE_TYPES = [
  { type: 'chromatograph', label: 'Хроматограф' },
  { type: 'centrifuge', label: 'Центрифуга' },
  { type: 'cryo', label: 'Криокамера' },
  { type: 'rack', label: 'Стеллаж пробирок' },
  { type: 'microscope', label: 'Микроскоп' },
  { type: 'reactor', label: 'Биореактор' },
  { type: 'spectro', label: 'Спектрометр' },
  { type: 'incubator', label: 'Инкубатор' },
  { type: 'analyzer', label: 'Анализатор ДНК' },
  { type: 'fridge', label: 'Холодильный блок' },
];

export const ACHIEVEMENTS = [
  { id: 'escape', title: 'Первый побег', desc: 'Разбей пробирку и вырвись на свободу', icon: 'DoorOpen' },
  { id: 'eat50', title: 'Гурман', desc: 'Съешь 50 элементов', icon: 'Utensils' },
  { id: 'size1000', title: 'Колония', desc: 'Сеть из 1000 узлов', icon: 'Network' },
  { id: 'rare', title: 'Алхимик', desc: 'Поглоти редкий элемент', icon: 'Gem' },
  { id: 'survive', title: 'Живучий', desc: 'Достигни сети в 500 узлов', icon: 'Shield' },
];

export const ESCAPE_ENERGY = 88;
export const ESCAPE_SIZE = 220;
export const MAX_NODES = 1400;
