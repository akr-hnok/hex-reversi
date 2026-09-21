import './styles.css';
import { Board, createBoard } from '../core/board';
import { chooseMove } from '../core/engine';
import { GameState, applyMove, createGame, movesFor, seatForTurn, seatOptsFromSeed } from '../core/game';
import { deserializeGame, serializeGame } from '../core/serde';
import { ComType } from '../core/types';
import { RoomSnapshot, Seat } from '../shared/protocol';
import { createBoardView, BoardView } from './boardView';
import { OnlineSession, createRoomApi, fetchSnapshot, requestComAdvice } from './net';
import { GameSettings, PlayMode, Theme, createQuickSettings, renderJoin, renderResultPanel, renderSetup, renderTitle, renderWaiting } from './ui';

const PLAYER_COLORS: Theme['playerColors'] = ['#e9e9f2', '#e63946', '#4ea5d9'];

const setupEl = document.querySelector<HTMLElement>('#setup-screen')!;
const gameEl = document.querySelector<HTMLElement>('#game-screen')!;
const boardHost = document.querySelector<HTMLElement>('#board-host')!;

let lastConfig: GameSettings | null = null;
let resultPanel: HTMLElement | null = null;
let gameId = 0;

function seatName(com: ComType, i: number): string {
  return com === 'none' ? `プレイヤー ${i + 1}` : com === 'engine' ? `COM ${i + 1}` : `AI COM ${i + 1}`;
}

// ===== ローカル対戦 =====

function removeResultPanel(): void {
  resultPanel?.remove();
  resultPanel = null;
}

function showResult(
  state: GameState,
  names: [string, string, string],
  online?: { votes: number; needed: number; voted: boolean },
): void {
  removeResultPanel();
  resultPanel = renderResultPanel(gameEl, state, { playerNames: names, playerColors: PLAYER_COLORS }, {
    onRematch: () => {
      if (online) {
        session?.voteRematch();
        return;
      }
      if (lastConfig) startGame(lastConfig);
      else showTitle();
    },
    onSetup: () => (online ? teardownOnlineAndShowTitle() : showTitle()),
  }, online);
}

function showTitle(): void {
  teardownOnline();
  removeResultPanel();
  gameEl.classList.add('hidden');
  setupEl.classList.remove('hidden');
  renderTitle(setupEl, {
    onQuickStart: (humanCount) => {
      startGame(createQuickSettings(humanCount));
    },
    onOpenSettings: showSetup,
    onJoin: (roomId) => showJoin(roomId),
  });
}

function showSetup(): void {
  teardownOnline();
  removeResultPanel();
  gameEl.classList.add('hidden');
  setupEl.classList.remove('hidden');
  renderSetup(setupEl, {
    onStart: (settings, mode) => {
      if (mode === 'online') void startOnlineCreate(settings);
      else startGame(settings);
    },
    onBack: showTitle,
  });
}

function startGame(settings: GameSettings): void {
  lastConfig = settings;
  removeResultPanel();
  const myId = ++gameId; // 設定画面へ戻った後に遅れて動かないための世代管理
  setupEl.classList.add('hidden');
  gameEl.classList.remove('hidden');

  const names: [string, string, string] = [0, 1, 2].map((i) =>
    seatName(settings.com[i], i),
  ) as [string, string, string];

  const board = createBoard(settings.board);
  let state = createGame(board, {
    ...seatOptsFromSeed(settings.board.seed ?? 1),
    fixThirdSeat: settings.fixThirdSeat,
  });

  const view = createBoardView(boardHost, board, {
    playerNames: names,
    playerColors: PLAYER_COLORS,
    onQuit: () => {
      gameId++;
      showTitle();
    },
    onAdvice: () => {
      if (state.over || settings.com[state.current] !== 'none') return;
      view.update(state, { showHints: true, comment: '🤔 AI に助言を求めています…' });
      void requestComAdvice(serializeGame(state))
        .then((res) => {
          if (myId !== gameId || state.over) return;
          view.update(state, {
            showHints: true,
            comment: `💡 おすすめ: ${res.comment ?? '光っているマスに置いてみてください'}`,
            advice: { q: res.q, r: res.r },
          });
        })
        .catch(() => {
          if (myId !== gameId) return;
          view.update(state, {
            showHints: true,
            comment: 'AI に接続できませんでした(Workers AI を利用できない環境の可能性があります)',
          });
        });
    },
    onCellClick: (q, r) => {
      if (state.over || settings.com[state.current] !== 'none') return;
      if (!movesFor(state, state.current).some((m) => m.q === q && m.r === r)) return;
      state = applyMove(state, q, r);
      view.update(state, { showHints: settings.com[state.current] === 'none' });
      afterMove(myId);
    },
  });
  view.update(state, { showHints: settings.com[state.current] === 'none' });
  afterMove(myId);

  /** 終了表示、または COM の自動着手を予約する */
  function afterMove(id: number): void {
    if (id !== gameId) return;
    if (state.over) {
      window.setTimeout(() => {
        if (id === gameId) showResult(state, names);
      }, 600);
      return;
    }
    if (settings.com[state.current] === 'none') return;
    window.setTimeout(() => {
      if (id !== gameId || state.over) return;
      const move = chooseMove(state.board, state.current, settings.level, Math.random, nextSeats(state));
      if (!move) return;
      state = applyMove(state, move.q, move.r);
      view.update(state, { showHints: settings.com[state.current] === 'none' });
      afterMove(id);
    }, 450 + Math.random() * 500);
  }
}

function nextSeats(state: GameState): [Seat, Seat] {
  return [
    seatForTurn(state.turn + 1, state.seatOffset, state.seatDirection, state.fixThirdSeat),
    seatForTurn(state.turn + 2, state.seatOffset, state.seatDirection, state.fixThirdSeat),
  ];
}

// ===== オンライン対戦 =====

let session: OnlineSession | null = null;
let mySeat: Seat | null = null;
let onlineView: { view: BoardView; board: Board } | null = null;
let lastOnlineState: GameState | null = null;
let lastVotesKey = '';
let onlineNames: [string, string, string] = ['プレイヤー 1', 'プレイヤー 2', 'プレイヤー 3'];

function teardownOnline(): void {
  session?.close();
  session = null;
  mySeat = null;
  onlineView = null;
  lastOnlineState = null;
  lastVotesKey = '';
}

function teardownOnlineAndShowTitle(): void {
  history.replaceState(null, '', location.pathname);
  teardownOnline();
  showTitle();
}

async function startOnlineCreate(settings: GameSettings): Promise<void> {
  if (settings.com.every((t) => t !== 'none')) {
    window.alert('すべての席を COM にしたルームは作成できません(観戦モードは未対応です)');
    showSetup();
    return;
  }
  setupEl.classList.remove('hidden');
  gameEl.classList.add('hidden');
  renderWaiting(setupEl, '……', null, settings.com, settings.fixThirdSeat, { onQuit: teardownOnlineAndShowTitle });
  try {
    const roomId = await createRoomApi(settings.board, settings.com, settings.fixThirdSeat);
    history.replaceState(null, '', `?room=${roomId}`);
    await connectOnline(roomId, firstHumanSeat(settings.com));
  } catch (e) {
    teardownOnline();
    showSetup();
    alert(e instanceof Error ? e.message : 'ルームの作成に失敗しました');
  }
}

/** 作成者が座る人間席(全席 COM なら観戦席は作らず 0 にフォールバック) */
function firstHumanSeat(com: [ComType, ComType, ComType]): Seat {
  const i = com.findIndex((t) => t === 'none');
  return (i === -1 ? 0 : i) as Seat;
}

function showJoin(roomId: string): void {
  teardownOnline();
  gameEl.classList.add('hidden');
  setupEl.classList.remove('hidden');
  renderJoin(setupEl, roomId, {
    onJoin: (id, seat) => {
      void connectOnline(id, seat);
    },
    onBack: showTitle,
    fetchSnapshot,
  });
}

async function connectOnline(roomId: string, seat: Seat): Promise<void> {
  teardownOnline();
  renderWaiting(setupEl, roomId, null, ['none', 'none', 'none'], false, { onQuit: teardownOnlineAndShowTitle });
  session = new OnlineSession(roomId, seat, {
    onSnapshot: (you, snapshot) => handleOnlineSnapshot(you, snapshot),
    onError: (message) => {
      showOnlineNotice(message);
    },
    onClose: () => {
      showDisconnect();
    },
  });
  try {
    await session.connect();
  } catch (e) {
    teardownOnline();
    renderWaiting(setupEl, roomId, null, ['none', 'none', 'none'], false, { onQuit: teardownOnlineAndShowTitle });
    showOnlineNotice(e instanceof Error ? e.message : '接続に失敗しました');
  }
}

function handleOnlineSnapshot(you: Seat, snapshot: RoomSnapshot): void {
  mySeat = you;
  onlineNames = [0, 1, 2].map((i) => seatName(snapshot.com[i], i)) as [string, string, string];
  if (!snapshot.game) {
    onlineView = null;
    lastOnlineState = null;
    renderWaiting(setupEl, snapshot.roomId, snapshot.seats, snapshot.com, snapshot.fixThirdSeat, { onQuit: teardownOnlineAndShowTitle });
    return;
  }

  const state = deserializeGame(snapshot.game);
  lastOnlineState = state;
  setupEl.classList.add('hidden');
  gameEl.classList.remove('hidden');

  const rebuild = !onlineView || onlineView.board !== state.board || state.turn === 0;
  if (rebuild) {
    removeResultPanel();
    lastVotesKey = '';
    onlineView = {
      board: state.board,
      view: createBoardView(boardHost, state.board, {
        playerNames: onlineNames,
        playerColors: PLAYER_COLORS,
        onQuit: teardownOnlineAndShowTitle,
        onAdvice: () => {
          const s = lastOnlineState;
          if (!s || s.over || s.current !== mySeat) return;
          onlineView!.view.update(s, { showHints: true, comment: '🤔 AI に助言を求めています…' });
          void requestComAdvice(serializeGame(s))
            .then((res) => {
              const cur = lastOnlineState;
              if (!cur || cur.turn !== s.turn || cur.over) return; // 局面が進んでいたら古い助言は捨てる
              onlineView!.view.update(cur, {
                showHints: true,
                comment: `💡 おすすめ: ${res.comment ?? '光っているマスに置いてみてください'}`,
                advice: { q: res.q, r: res.r },
              });
            })
            .catch(() => {
              onlineView!.view.update(lastOnlineState!, {
                showHints: true,
                comment: 'AI に接続できませんでした',
              });
            });
        },
        onCellClick: (q, r) => {
          const s = lastOnlineState;
          if (!s || s.over || s.current !== mySeat) return;
          if (!movesFor(s, s.current).some((m) => m.q === q && m.r === r)) return;
          session?.move(q, r); // 適用はサーバーからの snapshot で行う
        },
      }),
    };
  }

  const comTurn = snapshot.com[state.current] !== 'none';
  const comment = !state.over && comTurn
    ? `🤔 ${onlineNames[state.current]} 思考中…`
    : snapshot.lastComment
      ? `${onlineNames[snapshot.lastComment.seat]}: ${snapshot.lastComment.text}`
      : null;
  onlineView!.view.update(state, {
    showHints: !state.over && state.current === mySeat,
    comment,
  });

  if (state.over) {
    const votes = snapshot.rematchVotes;
    const needed = snapshot.com.filter((t) => t === 'none').length || 1;
    const key = `${votes.length}:${needed}:${votes.includes(you)}`;
    if (key !== lastVotesKey) {
      lastVotesKey = key;
      showResult(state, onlineNames, { votes: votes.length, needed, voted: votes.includes(you) });
    }
  }
}

/** 待機画面への軽い通知(エラー表示は簡易的に alert で代用) */
function showOnlineNotice(message: string): void {
  window.alert(message);
}

function showDisconnect(): void {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal panel">
      <h2>接続が切れました</h2>
      <p class="note">ページを再読み込みすると、同じ席で再接続できます。</p>
      <div class="btn-row">
        <button class="btn primary" id="reconnect">再読み込み</button>
      </div>
    </div>
  `;
  overlay.querySelector('#reconnect')!.addEventListener('click', () => location.reload());
  document.body.appendChild(overlay);
}

// ===== 起動 =====

const bootRoom = new URLSearchParams(location.search).get('room');
if (bootRoom) {
  showJoin(bootRoom);
} else {
  showTitle();
}
