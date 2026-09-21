import { describe, expect, it } from 'vitest';
import {
  HEX_DIRECTIONS,
  hexDistance,
  hexKey,
  hexesInRadius,
  neighbors,
  rotate120,
  rotate120Orbit,
} from '../../src/core/hex';

describe('hexesInRadius', () => {
  it('一辺5マス(R=4)で61マス', () => {
    expect(hexesInRadius(4)).toHaveLength(61);
  });

  it('一辺6マス(R=5)で91マス', () => {
    expect(hexesInRadius(5)).toHaveLength(91);
  });

  it('生成マスはすべて距離 radius 以内', () => {
    for (const { q, r } of hexesInRadius(5)) {
      expect(hexDistance(q, r)).toBeLessThanOrEqual(5);
    }
  });
});

describe('neighbors', () => {
  it('中心の隣接マスは6つで重複しない', () => {
    const ns = neighbors({ q: 0, r: 0 });
    expect(ns).toHaveLength(6);
    expect(new Set(ns.map(({ q, r }) => hexKey(q, r))).size).toBe(6);
    for (const n of ns) expect(hexDistance(n.q, n.r)).toBe(1);
  });

  it('隣接マスはすべて HEX_DIRECTIONS に一致', () => {
    for (const d of HEX_DIRECTIONS) {
      expect(neighbors({ q: 0, r: 0 })).toContainEqual(d);
    }
  });
});

describe('rotate120', () => {
  it('3回適用で元に戻る', () => {
    const c = { q: 2, r: -1 };
    const once = rotate120(c);
    const twice = rotate120(once);
    expect(rotate120(twice)).toEqual(c);
  });

  it('距離を保つ', () => {
    const c = { q: -3, r: 1 };
    expect(hexDistance(rotate120(c).q, rotate120(c).r)).toBe(hexDistance(c.q, c.r));
  });

  it('中心以外のオービットは3つの異なるマス', () => {
    const [a, b, c] = rotate120Orbit({ q: 2, r: 0 });
    const keys = new Set([a, b, c].map(({ q, r }) => hexKey(q, r)));
    expect(keys.size).toBe(3);
  });
});
