export const PLAYER_COUNT = 3;

export type StoneColor = 0 | 1 | 2;

export const EMPTY = -1;

export type CellStone = StoneColor | typeof EMPTY;

export type CellType = 'normal' | 'double' | 'triple' | 'blackhole' | 'bomb';

/** 地雷の起爆効果: 周囲反転 または 周囲破壊(ブラックホール化)。 */
export type BombEffect = 'flip' | 'destroy';

/** 席の対戦担当種別。 */
export type ComType = 'none' | 'engine' | 'llm';

export function nextColor(color: StoneColor): StoneColor {
  return ((color + 1) % PLAYER_COUNT) as StoneColor;
}
