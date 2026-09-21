import { describe, expect, it } from 'vitest';
import { SoundPlayer } from '../../src/client/sound';

describe('SoundPlayer(node 環境では no-op)', () => {
  it('AudioContext がなくても play は例外を投げない', () => {
    const sp = new SoundPlayer();
    expect(() => {
      sp.play('place');
      sp.play('flip', 3);
      sp.play('bomb');
      sp.play('win');
      sp.play('pass');
    }).not.toThrow();
  });

  it('toggle で on/off が切り替わる', () => {
    const sp = new SoundPlayer();
    const initial = sp.isEnabled();
    expect(sp.toggle()).toBe(!initial);
    expect(sp.isEnabled()).toBe(!initial);
    expect(sp.toggle()).toBe(initial);
  });

  it('OFF のとき play は no-op', () => {
    const sp = new SoundPlayer();
    if (sp.isEnabled()) sp.toggle();
    expect(() => sp.play('bomb')).not.toThrow();
    expect(sp.isEnabled()).toBe(false);
  });
});
