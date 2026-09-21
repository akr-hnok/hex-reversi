import { BoardConfig, GimmickCounts } from '../core/board';
import { GameState, scores } from '../core/game';
import type { EngineLevel } from '../core/engine';
import type { ComType, BombEffect } from '../core/types';
import type { RoomSnapshot, Seat } from '../shared/protocol';

export interface Theme {
  playerNames: readonly [string, string, string];
  playerColors: readonly [string, string, string];
}

/** 対局設定(盤面設定 + 各席の担当 + ハンデ)。 */
export interface GameSettings {
  board: BoardConfig;
  com: [ComType, ComType, ComType];
  level: EngineLevel;
  /** ハンデ: プレイヤー 3 を常に 3番手に固定する。 */
  fixThirdSeat: boolean;
}

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  board: {
    radius: 4,
    gimmicks: true,
    gimmickCounts: {
      double: 1,
      triple: 0,
      blackhole: 1,
      bomb: 1,
    },
    bombEffect: 'destroy',
  },
  com: ['none', 'engine', 'engine'],
  level: 'easy',
  fixThirdSeat: false,
};


export function createQuickSettings(humanCount: 1 | 2 | 3): GameSettings {
  const com: [ComType, ComType, ComType] =
    humanCount === 1
      ? ['none', 'engine', 'engine']
      : humanCount === 2
        ? ['none', 'none', 'engine']
        : ['none', 'none', 'none'];

  return {
    ...DEFAULT_GAME_SETTINGS,
    board: {
      ...DEFAULT_GAME_SETTINGS.board,
      seed: Math.floor(Math.random() * 2 ** 31),
    },
    com,
  };
}

export interface TitleHandlers {
  onQuickStart(humanCount: 1 | 2 | 3): void;
  onOpenSettings(): void;
  onJoin(roomId: string): void;
}

export function renderTitle(root: HTMLElement, handlers: TitleHandlers): void {
  root.replaceChildren();
  const wrap = document.createElement('div');
  wrap.className = 'panel title-screen';
  wrap.innerHTML = `
    <div class="title-header">
      <h1 class="game-logo">Hex Reversi</h1>
      <p class="subtitle">3人対戦ヘクス・リバーシ</p>
      <div class="title-rule-chip">
        <span class="chip-dot"></span>フルギミック対局 (倍点×2 / BH / 地雷破壊)
      </div>
    </div>

    <div class="menu-quick-section">
      <button class="menu-card-btn primary-glow" id="play-1">
        <div class="menu-card-icon">👤</div>
        <div class="menu-card-info">
          <span class="menu-card-title">1人プレイ</span>
          <span class="menu-card-desc">COM 2人と対戦 (すぐ遊ぶ)</span>
        </div>
        <span class="menu-card-action">開始 ▶</span>
      </button>

      <button class="menu-card-btn" id="play-2">
        <div class="menu-card-icon">👥</div>
        <div class="menu-card-info">
          <span class="menu-card-title">2人プレイ</span>
          <span class="menu-card-desc">人間 2人 ＋ COM 1人</span>
        </div>
        <span class="menu-card-action">開始 ▶</span>
      </button>

      <button class="menu-card-btn" id="play-3">
        <div class="menu-card-icon">👥👤</div>
        <div class="menu-card-info">
          <span class="menu-card-title">3人プレイ</span>
          <span class="menu-card-desc">人間 3人でローカル対戦</span>
        </div>
        <span class="menu-card-action">開始 ▶</span>
      </button>
    </div>

    <div class="menu-footer-grid">
      <button class="menu-sub-card" id="open-settings">
        <span class="sub-card-icon">⚙️</span>
        <div class="sub-card-text">
          <span class="sub-card-title">設定</span>
          <span class="sub-card-desc">ルール・盤面変更・ルーム作成</span>
        </div>
      </button>

      <div class="menu-join-card">
        <span class="join-card-title">ルームID でオンライン参加</span>
        <div class="join-row">
          <input type="text" id="join-id" placeholder="ルームID" maxlength="12" class="styled-input join-input" />
          <button class="btn join-btn" id="join-btn">参加 ▶</button>
        </div>
        <p class="error" id="join-error"></p>
      </div>
    </div>
  `;

  wrap.querySelector('#play-1')!.addEventListener('click', () => handlers.onQuickStart(1));
  wrap.querySelector('#play-2')!.addEventListener('click', () => handlers.onQuickStart(2));
  wrap.querySelector('#play-3')!.addEventListener('click', () => handlers.onQuickStart(3));
  wrap.querySelector('#open-settings')!.addEventListener('click', handlers.onOpenSettings);

  const joinInput = wrap.querySelector<HTMLInputElement>('#join-id')!;
  const doJoin = () => {
    const id = joinInput.value.trim();
    wrap.querySelector('#join-error')!.textContent = id ? '' : 'ルームIDを入力してください';
    if (id) handlers.onJoin(id);
  };
  wrap.querySelector('#join-btn')!.addEventListener('click', doJoin);
  joinInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doJoin();
  });

  root.appendChild(wrap);
}

export interface WaitingHandlers {
  onQuit(): void;
}

const COM_LABEL: Record<ComType, string> = {
  none: '',
  engine: '(COM)',
  llm: '(COM・AI)',
};

/** ルーム作成後・参加後の待機画面。スナップショットごとに再描画する。 */
export function renderWaiting(
  root: HTMLElement,
  roomId: string,
  seats: RoomSnapshot['seats'] | null,
  com: [ComType, ComType, ComType],
  fixThirdSeat: boolean,
  handlers: WaitingHandlers,
): void {
  root.replaceChildren();
  gameElSafeHide();
  const wrap = document.createElement('div');
  wrap.className = 'panel waiting-screen';
  const url = `${location.origin}/?room=${roomId}`;
  const seatItems = seats
    ? seats
        .map((s, i) => {
          const tag = COM_LABEL[com[i]];
          const status =
            com[i] !== 'none'
              ? com[i] === 'llm'
                ? 'COM(Workers AI)'
                : 'COM(エンジン)'
              : !s.occupied
                ? '参加待ち'
                : s.connected
                  ? '参加済み'
                  : '切断中';
          return `<li><span class="dot" style="background:${DEFAULT_COLORS[i]}"></span>プレイヤー ${i + 1}${tag}: ${status}</li>`;
        })
        .join('')
    : '<li>読み込み中…</li>';
  wrap.innerHTML = `
    <h2>ルーム: ${roomId}${fixThirdSeat ? ' <span class="handicap-badge">ハンデあり</span>' : ''}</h2>
    <p class="note">このURLを相手に共有してください。人間席が埋まると自動で対局開始します:</p>
    <p class="room-url">${url}</p>
    <div class="btn-row">
      <button class="btn" id="copy">リンクをコピー</button>
    </div>
    <ul class="seat-list">${seatItems}</ul>
    <p class="note">COM 席は人の参加なしで自動的に対局します。この画面のままお待ちください。</p>
    <div class="btn-row">
      <button class="btn" id="quit">キャンセル</button>
    </div>
  `;
  wrap.querySelector('#copy')!.addEventListener('click', (e) => {
    void navigator.clipboard?.writeText(url);
    (e.target as HTMLButtonElement).textContent = 'コピーしました';
  });
  wrap.querySelector('#quit')!.addEventListener('click', handlers.onQuit);
  root.appendChild(wrap);
}

// 待機画面は setup コンテナに表示し、game 画面は隠す(モジュール外の要素に依存しないよう遅延参照)
function gameElSafeHide(): void {
  document.querySelector('#game-screen')?.classList.add('hidden');
  document.querySelector('#setup-screen')?.classList.remove('hidden');
}

const DEFAULT_COLORS = ['#e9e9f2', '#e63946', '#4ea5d9'];

export interface JoinHandlers {
  onJoin(roomId: string, seat: Seat): void;
  onBack(): void;
  fetchSnapshot(roomId: string): Promise<RoomSnapshot>;
}

/** ルーム参加画面: ルームID入力 → 席の状態を取得 → 空き席を選択して参加。 */
export function renderJoin(root: HTMLElement, defaultRoomId: string, handlers: JoinHandlers): void {
  root.replaceChildren();
  gameElSafeHide();
  const wrap = document.createElement('div');
  wrap.className = 'panel join-screen';
  wrap.innerHTML = `
    <h2>ルームに参加</h2>
    <label class="field">
      ルームID
      <div class="join-row">
        <input type="text" id="room-id" value="${defaultRoomId}" maxlength="12" />
        <button class="btn" id="check">席を確認</button>
      </div>
    </label>
    <div id="seat-list" class="seat-picker"></div>
    <p class="error" id="error"></p>
    <div class="btn-row">
      <button class="btn" id="back">戻る</button>
    </div>
  `;
  const idInput = wrap.querySelector<HTMLInputElement>('#room-id')!;
  const seatList = wrap.querySelector<HTMLElement>('#seat-list')!;
  const error = wrap.querySelector<HTMLElement>('#error')!;
  const onSnapshot = (snap: RoomSnapshot) => {
    seatList.replaceChildren();
    snap.seats.forEach((s, i) => {
      const btn = document.createElement('button');
      btn.className = 'btn seat-btn';
      const comTag = snap.com[i] === 'none' ? '' : snap.com[i] === 'llm' ? '(COM・AI)' : '(COM)';
      const label = !s.occupied
        ? `プレイヤー ${i + 1}${comTag} の席に参加`
        : s.connected
          ? `プレイヤー ${i + 1}(参加済み)`
          : `プレイヤー ${i + 1}(再接続)`;
      btn.textContent = label;
      btn.disabled = (s.occupied && s.connected) || snap.com[i] !== 'none';
      btn.addEventListener('click', () => handlers.onJoin(idInput.value.trim(), i as Seat));
      seatList.appendChild(btn);
    });
    if (snap.game) {
      error.textContent = 'このルームは対局中です。切断中の席のみ再接続できます。';
    } else {
      error.textContent = '';
    }
  };
  const check = () => {
    error.textContent = '';
    seatList.replaceChildren();
    const id = idInput.value.trim();
    if (!id) {
      error.textContent = 'ルームIDを入力してください';
      return;
    }
    handlers.fetchSnapshot(id).then(onSnapshot).catch((e: Error) => {
      error.textContent = e.message;
    });
  };
  wrap.querySelector('#check')!.addEventListener('click', check);
  idInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') check();
  });
  wrap.querySelector('#back')!.addEventListener('click', handlers.onBack);
  root.appendChild(wrap);
  if (defaultRoomId) check();
}

export type PlayMode = 'local' | 'online';

export interface SetupHandlers {
  onStart(settings: GameSettings, mode: PlayMode): void;
  onBack(): void;
}

function maxOrbits(radius: number): number {
  const cellCount = 3 * radius * (radius + 1) + 1;
  return (cellCount - 10) / 3; // 中心 + 初期配置9マスを除いたオービット数
}

export function renderSetup(root: HTMLElement, handlers: SetupHandlers): void {
  root.replaceChildren();
  const wrap = document.createElement('div');
  wrap.className = 'panel setup-screen';
  wrap.innerHTML = `
    <div class="setup-header">
      <h2>対局設定</h2>
      <p class="subtitle">ルールや対戦相手、特殊マスを設定できます</p>
    </div>

    <div class="setup-grid">
      <!-- 左カラム: 基本設定 & プレイヤー担当 -->
      <div class="setup-col">
        <section class="setup-card">
          <h3 class="setup-card-title"><span class="card-icon">⚙️</span> 基本設定</h3>
          <label class="field">
            <span class="field-label">対戦モード</span>
            <select id="mode" class="styled-select">
              <option value="local">ローカル (この端末で交代)</option>
              <option value="online">オンライン (ルームを作成)</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">盤面サイズ</span>
            <select id="size" class="styled-select">
              <option value="4">標準: 一辺5マス (61マス)</option>
              <option value="5">広め: 一辺6マス (91マス)</option>
            </select>
          </label>
        </section>

        <section class="setup-card">
          <h3 class="setup-card-title"><span class="card-icon">👥</span> プレイヤー担当</h3>
          <div class="player-select-list">
            <div class="player-select-row">
              <span class="player-tag" style="--p-color: #e9e9f2"><span class="tag-dot"></span> P1</span>
              <select id="com-0" class="styled-select">
                <option value="none" selected>人間</option>
                <option value="engine">COM (エンジン)</option>
              </select>
            </div>
            <div class="player-select-row">
              <span class="player-tag" style="--p-color: #e63946"><span class="tag-dot"></span> P2</span>
              <select id="com-1" class="styled-select">
                <option value="none">人間</option>
                <option value="engine" selected>COM (エンジン)</option>
              </select>
            </div>
            <div class="player-select-row">
              <span class="player-tag" style="--p-color: #4ea5d9"><span class="tag-dot"></span> P3</span>
              <select id="com-2" class="styled-select">
                <option value="none" selected>人間</option>
                <option value="engine">COM (エンジン)</option>
              </select>
            </div>
          </div>
          <label class="field">
            <span class="field-label">COM の強さ</span>
            <select id="level" class="styled-select">
              <option value="easy" selected>かんたん (ランダム)</option>
              <option value="normal">ふつう (1手読み)</option>
              <option value="hard">つよい (2手読み)</option>
            </select>
          </label>

          <div class="info-tip">
            <span class="tip-icon">💡</span>
            <span>対局中の「AI助言」でWorkers AIの推薦手を聞けます。全員COMで観戦も可能です。</span>
          </div>
        </section>
      </div>

      <!-- 右カラム: 特殊マス & ハンデ・シード -->
      <div class="setup-col">
        <section class="setup-card">
          <div class="card-title-row">
            <h3 class="setup-card-title"><span class="card-icon">✨</span> 特殊マス (ギミック)</h3>
            <label class="toggle-wrap">
              <input type="checkbox" id="gimmicks" class="toggle-checkbox" checked />
              <span class="toggle-switch"></span>
            </label>
          </div>
          <div class="gimmick-fields-container" id="gimmick-container">
            <div class="slider-field">
              <div class="slider-head">
                <span class="slider-label">倍点マス (×2)</span>
                <span class="slider-val" id="double-val"></span>
              </div>
              <input type="range" id="double" min="0" max="17" value="1" class="styled-slider" />
            </div>
            <div class="slider-field">
              <div class="slider-head">
                <span class="slider-label">倍点マス (×3)</span>
                <span class="slider-val" id="triple-val"></span>
              </div>
              <input type="range" id="triple" min="0" max="17" value="0" class="styled-slider" />
            </div>
            <div class="slider-field">
              <div class="slider-head">
                <span class="slider-label">ブラックホール</span>
                <span class="slider-val" id="blackhole-val"></span>
              </div>
              <input type="range" id="blackhole" min="0" max="17" value="1" class="styled-slider" />
            </div>
            <div class="slider-field">
              <div class="slider-head">
                <span class="slider-label">地雷 (完全不可視)</span>
                <span class="slider-val" id="bomb-val"></span>
              </div>
              <input type="range" id="bomb" min="0" max="17" value="1" class="styled-slider" />
            </div>
            <label class="field mt-8" id="bomb-effect-field">
              <span class="field-label">地雷の起爆効果</span>
              <select id="bomb-effect" class="styled-select">
                <option value="destroy" selected>破壊 (爆心地がブラックホール化・1手損)</option>
                <option value="flip">反転 (周囲の石を自分の色に反転)</option>
              </select>
            </label>
            <p class="note" id="orbit-note"></p>
          </div>
        </section>

        <section class="setup-card">
          <div class="card-title-row">
            <h3 class="setup-card-title"><span class="card-icon">⚖️</span> ハンデ</h3>
            <label class="toggle-wrap">
              <input type="checkbox" id="fix-third" class="toggle-checkbox" />
              <span class="toggle-switch"></span>
            </label>
          </div>
          <p class="field-sublabel">プレイヤー 3 を毎ラウンド 3番手(有利な最終手番)に固定</p>
          <div class="info-tip">
            <span class="tip-icon">ℹ️</span>
            <span>子供や初心者と遊ぶ際におすすめ。1番手と2番手はラウンドごとに交代します。</span>
          </div>

          <label class="field mt-8">
            <span class="field-label">シード値 <span class="subtext">(任意)</span></span>
            <input type="number" id="seed" placeholder="空欄でランダム生成" class="styled-input" />
          </label>
        </section>
      </div>
    </div>

    <p class="error" id="error"></p>
    <div class="btn-row setup-footer">
      <button class="btn" id="back">← 戻る</button>
      <button class="btn primary" id="start">対局開始 ▶</button>
    </div>
  `;
  root.appendChild(wrap);

  const size = wrap.querySelector<HTMLSelectElement>('#size')!;
  const mode = wrap.querySelector<HTMLSelectElement>('#mode')!;
  const gimmicks = wrap.querySelector<HTMLInputElement>('#gimmicks')!;
  const gimmickContainer = wrap.querySelector<HTMLElement>('#gimmick-container')!;
  const note = wrap.querySelector<HTMLElement>('#orbit-note')!;
  const error = wrap.querySelector<HTMLElement>('#error')!;
  const inputs = {
    double: wrap.querySelector<HTMLInputElement>('#double')!,
    triple: wrap.querySelector<HTMLInputElement>('#triple')!,
    blackhole: wrap.querySelector<HTMLInputElement>('#blackhole')!,
    bomb: wrap.querySelector<HTMLInputElement>('#bomb')!,
  };
  const valLabels = {
    double: wrap.querySelector<HTMLElement>('#double-val')!,
    triple: wrap.querySelector<HTMLElement>('#triple-val')!,
    blackhole: wrap.querySelector<HTMLElement>('#blackhole-val')!,
    bomb: wrap.querySelector<HTMLElement>('#bomb-val')!,
  };
  const readCounts = (): GimmickCounts => ({
    double: Number(inputs.double.value),
    triple: Number(inputs.triple.value),
    blackhole: Number(inputs.blackhole.value),
    bomb: Number(inputs.bomb.value),
  });
  const syncSliders = () => {
    const max = maxOrbits(Number(size.value));
    for (const key of Object.keys(inputs) as Array<keyof typeof inputs>) {
      inputs[key].max = String(max);
      const v = Number(inputs[key].value);
      valLabels[key].textContent = v === 0 ? 'なし' : `${v}組 = ${v * 3}マス`;
    }
    const total =
      Number(inputs.double.value) +
      Number(inputs.triple.value) +
      Number(inputs.blackhole.value) +
      Number(inputs.bomb.value);
    return { max, total };
  };

  const bombEffectSelect = wrap.querySelector<HTMLSelectElement>('#bomb-effect')!;

  const syncFields = () => {
    const enabled = gimmicks.checked;
    gimmickContainer.classList.toggle('disabled', !enabled);
    for (const input of Object.values(inputs)) {
      input.disabled = !enabled;
    }
    bombEffectSelect.disabled = !enabled || Number(inputs.bomb.value) === 0;
    const { max, total } = syncSliders();
    note.textContent = enabled
      ? `合計: ${total}組 (${total * 3}マス) / 上限 ${max}組 (1組 = 120°対称の3マス)`
      : '';
  };
  gimmicks.addEventListener('change', syncFields);
  size.addEventListener('change', syncFields);
  mode.addEventListener('change', syncFields);
  for (const input of Object.values(inputs)) {
    input.addEventListener('input', syncFields);
  }
  syncFields();

  wrap.querySelector('#back')!.addEventListener('click', handlers.onBack);
  wrap.querySelector('#start')!.addEventListener('click', () => {
    error.textContent = '';
    const radius = Number(size.value);
    const playMode = mode.value as PlayMode;
    const useGimmicks = gimmicks.checked;
    const gimmickCounts = readCounts();
    if (useGimmicks) {
      const { max, total } = syncSliders();
      if (total > max) {
        error.textContent = `特殊マスの組数の合計は ${max} 組以下にしてください。`;
        return;
      }
    }
    const seedInput = wrap.querySelector<HTMLInputElement>('#seed')!;
    const seed = seedInput.value === '' ? Math.floor(Math.random() * 2 ** 31) : Number(seedInput.value);
    const bombEffect = bombEffectSelect.value as BombEffect;
    handlers.onStart(
      {
        board: {
          radius,
          gimmicks: useGimmicks,
          gimmickCounts: useGimmicks ? gimmickCounts : undefined,
          bombEffect: useGimmicks ? bombEffect : undefined,
          seed,
        },
        com: [
          wrap.querySelector<HTMLSelectElement>('#com-0')!.value,
          wrap.querySelector<HTMLSelectElement>('#com-1')!.value,
          wrap.querySelector<HTMLSelectElement>('#com-2')!.value,
        ] as [ComType, ComType, ComType],
        level: wrap.querySelector<HTMLSelectElement>('#level')!.value as EngineLevel,
        fixThirdSeat: wrap.querySelector<HTMLInputElement>('#fix-third')!.checked,
      },
      playMode,
    );
  });
}

export interface ResultPanelHandlers {
  onRematch(): void;
  onSetup(): void;
}

/** オンライン対戦の再戦投票状態。 */
export interface OnlineVotes {
  votes: number;
  /** 再戦に必要な票数(=人間の席数)。 */
  needed: number;
  voted: boolean;
}

/**
 * 結果パネルを盤面の下に常設表示する。
 * 終了局面を見ながらその場でリトライできる(モーダルでは隠さない)。
 */
export function renderResultPanel(
  parent: HTMLElement,
  state: GameState,
  theme: Theme,
  handlers: ResultPanelHandlers,
  online?: OnlineVotes,
): HTMLElement {
  const s = scores(state.board);
  const max = Math.max(...s);
  const winners = s.flatMap((v, i) => (v === max ? [i] : []));

  const panel = document.createElement('div');
  panel.className = 'panel result-panel';
  const title =
    winners.length === 1
      ? `<span class="result-title" style="color:${theme.playerColors[winners[0]]}">${theme.playerNames[winners[0]]} の勝利!</span>`
      : `<span class="result-title">${winners.map((i) => theme.playerNames[i]).join('・')} の共勝!</span>`;
  const chips = s
    .map(
      (v, i) =>
        `<span class="chip" style="--c:${theme.playerColors[i]}">${theme.playerNames[i]}: ${v}${winners.includes(i) ? ' 👑' : ''}</span>`,
    )
    .join('');
  const voteLine = online
    ? `<p class="note">再戦の準備: ${online.votes}/${online.needed}${online.voted ? '(投票済み)' : ''}</p>`
    : '';
  const rematchLabel = online ? (online.voted ? '再戦の準備中…' : 'もう一度') : 'もう一度';
  panel.innerHTML = `
    <div class="result-head">
      ${title}
      <span class="note">総手数: ${state.turn}</span>
    </div>
    <div class="chips">${chips}</div>
    ${voteLine}
    <div class="btn-row">
      <button class="btn" data-act="setup">メニューに戻る</button>
      <button class="btn primary" data-act="rematch"${online?.voted ? ' disabled' : ''}>${rematchLabel}</button>
    </div>
  `;
  panel.querySelector('[data-act="setup"]')!.addEventListener('click', handlers.onSetup);
  panel.querySelector('[data-act="rematch"]')!.addEventListener('click', handlers.onRematch);
  parent.appendChild(panel);
  return panel;
}
