export interface Axial {
  q: number;
  r: number;
}

export const HEX_DIRECTIONS: readonly Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function hexKey(q: number, r: number): string {
  return `${q},${r}`;
}

export function parseKey(key: string): Axial {
  const [q, r] = key.split(',').map(Number);
  return { q, r };
}

export function hexDistance(q: number, r: number): number {
  return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
}

export function hexesInRadius(radius: number): Axial[] {
  const cells: Axial[] = [];
  for (let q = -radius; q <= radius; q++) {
    const lo = Math.max(-radius, -q - radius);
    const hi = Math.min(radius, -q + radius);
    for (let r = lo; r <= hi; r++) {
      cells.push({ q, r });
    }
  }
  return cells;
}

export function neighborAt(cell: Axial, dirIndex: number): Axial {
  const d = HEX_DIRECTIONS[dirIndex];
  return { q: cell.q + d.q, r: cell.r + d.r };
}

export function neighbors(cell: Axial): Axial[] {
  return HEX_DIRECTIONS.map((d) => ({ q: cell.q + d.q, r: cell.r + d.r }));
}

export function rotate120(cell: Axial): Axial {
  return { q: -cell.q - cell.r, r: cell.q };
}

export function rotate120Orbit(cell: Axial): [Axial, Axial, Axial] {
  const a = rotate120(cell);
  const b = rotate120(a);
  return [cell, a, b];
}
