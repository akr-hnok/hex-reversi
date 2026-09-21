import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/core/board';
import { movesFor } from '../../src/core/game';
import { ComType } from '../../src/core/types';
import { RoomCore } from '../../src/server/room-core';

const CONFIG = { radius: 2, gimmicks: false as const };

function makeRoom(com: [ComType, ComType, ComType] = ['none', 'none', 'none']) {
  return new RoomCore('test-room', CONFIG, com, createRng(99));
}

describe('RoomCore', () => {
  it('3席そろうと自動で対局が開始される', () => {
    const room = makeRoom();
    expect(room.game).toBeNull();
    expect(room.join(0)).toEqual({ ok: true });
    expect(room.join(1)).toEqual({ ok: true });
    expect(room.game).toBeNull();
    expect(room.join(2)).toEqual({ ok: true });
    expect(room.game).not.toBeNull();
    expect(room.game!.turn).toBe(0);
  });

  it('同じ席への二重参加は拒否される', () => {
    const room = makeRoom();
    room.join(0);
    const res = room.join(0);
    expect(res.ok).toBe(false);
  });

  it('切断中の席には再参加できる', () => {
    const room = makeRoom();
    room.join(0);
    room.disconnect(0);
    expect(room.snapshot().seats[0].connected).toBe(false);
    expect(room.join(0)).toEqual({ ok: true });
    expect(room.snapshot().seats[0].connected).toBe(true);
  });

  it('着手は自分の番でのみ可能(サーバー権威)', () => {
    const room = makeRoom();
    room.join(0);
    room.join(1);
    room.join(2);
    const current = room.game!.current;
    const other = ((current + 1) % 3) as 0 | 1 | 2;
    // 自分の番でない席の着手は拒否
    expect(room.move(other, 0, 0).ok).toBe(false);
    // 自分の番の合法手は受理
    const m = movesFor(room.game!, current)[0];
    expect(room.move(current, m.q, m.r)).toEqual({ ok: true });
  });

  it('不正な場所への着手は拒否され、状態が変わらない', () => {
    const room = makeRoom();
    room.join(0);
    room.join(1);
    room.join(2);
    const current = room.game!.current;
    const before = room.snapshot();
    const res = room.move(current, 0, 0); // 初期配置済みのマス → 不正
    expect(res.ok).toBe(false);
    expect(room.snapshot().game?.turn).toBe(before.game?.turn);
  });

  it('再戦投票が3席に達すると新しい対局が始まる', () => {
    const room = makeRoom();
    room.join(0);
    room.join(1);
    room.join(2);
    // 対局を終局まで進める
    let guard = 0;
    while (!room.game!.over && guard++ < 200) {
      const c = room.game!.current;
      const m = movesFor(room.game!, c)[0];
      expect(room.move(c, m.q, m.r).ok).toBe(true);
    }
    expect(room.game!.over).toBe(true);
    room.voteRematch(0);
    room.voteRematch(1);
    expect(room.game!.over).toBe(true); // 2票ではまだ終了のまま
    expect(room.snapshot().rematchVotes).toHaveLength(2);
    room.voteRematch(2);
    expect(room.game!.over).toBe(false); // 新対局開始
    expect(room.game!.turn).toBe(0);
    expect(room.snapshot().rematchVotes).toHaveLength(0);
  });

  it('永続化からの復元ができる', () => {
    const room = makeRoom();
    room.join(0);
    room.join(1);
    room.join(2);
    const current = room.game!.current;
    const m = movesFor(room.game!, current)[0];
    room.move(current, m.q, m.r);

    const restored = RoomCore.restore('test-room', JSON.parse(JSON.stringify(room.toJSON())));
    expect(restored.game!.turn).toBe(room.game!.turn);
    expect(restored.snapshot().seats).toEqual(room.snapshot().seats);
    expect([...restored.game!.board.cells.values()]).toEqual([...room.game!.board.cells.values()]);
  });
});

describe('RoomCore の COM 席', () => {
  it('COM 席は人の参加なしで対局が開始される', () => {
    const room = makeRoom(['none', 'engine', 'engine']);
    expect(room.game).toBeNull();
    expect(room.join(0)).toEqual({ ok: true });
    // 人間1席 + COM2席 で自動開始
    expect(room.game).not.toBeNull();
  });

  it('COM 席への参加は拒否される', () => {
    const room = makeRoom(['none', 'engine', 'none']);
    const res = room.join(1);
    expect(res.ok).toBe(false);
  });

  it('再戦に必要な票数は人間の席数', () => {
    const room = makeRoom(['none', 'engine', 'llm']);
    room.join(0); // 人間1 + COM2 → 自動開始
    expect(room.game).not.toBeNull();
    let guard = 0;
    while (!room.game!.over && guard++ < 200) {
      const c = room.game!.current;
      const m = movesFor(room.game!, c)[0];
      expect(room.move(c, m.q, m.r).ok).toBe(true);
    }
    expect(room.game!.over).toBe(true);
    room.voteRematch(0); // 人間が1票で即再戦開始
    expect(room.game!.over).toBe(false);
    expect(room.game!.turn).toBe(0);
  });

  it('COM 種別とコメントは永続化される', () => {
    const room = makeRoom(['none', 'llm', 'engine']);
    room.join(0);
    room.setComment(1, '角を狙います');
    const restored = RoomCore.restore('test-room', JSON.parse(JSON.stringify(room.toJSON())));
    expect(restored.com).toEqual<ComType[]>(['none', 'llm', 'engine']);
    expect(restored.lastComment).toEqual({ seat: 1, text: '角を狙います' });
  });

  it('ハンデ(席2を3番手固定)は対局開始・永続化に反映される', () => {
    const room = new RoomCore('handicap-room', CONFIG, ['none', 'none', 'none'], createRng(5), true);
    room.join(0);
    room.join(1);
    room.join(2);
    expect(room.game).not.toBeNull();
    expect(room.game!.fixThirdSeat).toBe(true);
    expect(room.snapshot().fixThirdSeat).toBe(true);

    const restored = RoomCore.restore('handicap-room', JSON.parse(JSON.stringify(room.toJSON())));
    expect(restored.fixThirdSeat).toBe(true);
    expect(restored.game!.fixThirdSeat).toBe(true);

    // 通常ルームは固定されない
    const normal = makeRoom();
    normal.join(0);
    normal.join(1);
    normal.join(2);
    expect(normal.game!.fixThirdSeat).toBe(false);
  });
});
