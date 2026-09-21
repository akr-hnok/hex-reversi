import { Board } from '../core/board';
import { hexKey } from '../core/hex';
import { GameState, movesFor, scores } from '../core/game';
import { soundPlayer, type SoundPlayer } from './sound';

export interface BoardViewOptions {
  playerNames: readonly [string, string, string];
  playerColors: readonly [string, string, string];
  onCellClick: (q: number, r: number) => void;
  /** 効果音。省略時は共有インスタンス。 */
  sound?: SoundPlayer;
  /** 対局中断ボタン(設定画面へ戻る)。省略時は非表示。 */
  onQuit?: () => void;
  /** AI 助言ボタン。省略時は非表示。 */
  onAdvice?: () => void;
}

export interface BoardView {
  /**
   * showHints: false の場合、合法手ヒントを表示しない(COM の番など)。
   * comment: 盤面下に表示するメッセージ(COM 思考中・解説など)。null で消去。
   * advice: 助言マーカーを表示するマス。null で消去。
   */
  update(
    state: GameState,
    opts?: { showHints?: boolean; comment?: string | null; advice?: { q: number; r: number } | null },
  ): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const SQRT3 = Math.sqrt(3);

export function hexToPixel(q: number, r: number, size: number): { x: number; y: number } {
  return { x: size * SQRT3 * (q + r / 2), y: size * 1.5 * r };
}

function hexPoints(cx: number, cy: number, size: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${cx + size * Math.cos(angle)},${cy + size * Math.sin(angle)}`);
  }
  return pts.join(' ');
}

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/**
 * 対局画面(ステータス + SVG 盤面)を生成する。
 * マスは初回に固定で生成し、update() で石・ヒント・ステータスを同期する。
 */
export function createBoardView(
  container: HTMLElement,
  board: Board,
  opts: BoardViewOptions,
): BoardView {
  container.replaceChildren();

  const sound = opts.sound ?? soundPlayer;

  const size = board.radius >= 5 ? 27 : 34;
  const positions = new Map<string, { x: number; y: number }>();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const cell of board.cells.values()) {
    const p = hexToPixel(cell.q, cell.r, size);
    positions.set(hexKey(cell.q, cell.r), p);
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const pad = size + 8;
  const viewBox = `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`;

  const root = document.createElement('div');
  root.className = 'game-screen';

  // ヘッダー: プレイヤースコアカードとアクションバー
  const header = document.createElement('div');
  header.className = 'game-header';

  const playerCardsWrap = document.createElement('div');
  playerCardsWrap.className = 'player-cards';

  const playerCardEls = [0, 1, 2].map((i) => {
    const card = document.createElement('div');
    card.className = `player-card p-${i}`;
    card.style.setProperty('--player-color', opts.playerColors[i]);
    card.innerHTML = `
      <div class="pcard-glow"></div>
      <div class="pcard-header">
        <span class="pcard-dot" style="background:${opts.playerColors[i]}"></span>
        <span class="pcard-name">${opts.playerNames[i]}</span>
        <span class="pcard-badge">TURN</span>
      </div>
      <div class="pcard-score">0</div>
    `;
    playerCardsWrap.appendChild(card);
    return card;
  });

  const actions = document.createElement('div');
  actions.className = 'game-actions';

  if (opts.onAdvice) {
    const adviceBtn = document.createElement('button');
    adviceBtn.className = 'action-btn advice-btn';
    adviceBtn.id = 'advice-btn';
    adviceBtn.innerHTML = '<span class="btn-icon">💡</span><span>AI助言</span>';
    adviceBtn.title = 'AI(Workers AI)におすすめの一手を聞く';
    adviceBtn.addEventListener('click', opts.onAdvice);
    actions.appendChild(adviceBtn);
  }

  const soundBtn = document.createElement('button');
  soundBtn.className = 'action-btn sound-btn';
  const syncSoundLabel = () => {
    soundBtn.innerHTML = sound.isEnabled()
      ? '<span class="btn-icon">🔊</span>'
      : '<span class="btn-icon">🔇</span>';
    soundBtn.title = sound.isEnabled() ? '効果音をオフ' : '効果音をオン';
  };
  syncSoundLabel();
  soundBtn.addEventListener('click', () => {
    sound.toggle();
    syncSoundLabel();
  });
  actions.appendChild(soundBtn);

  if (opts.onQuit) {
    const quitBtn = document.createElement('button');
    quitBtn.className = 'action-btn quit-btn';
    quitBtn.innerHTML = '<span class="btn-icon">🏠</span><span>メニューに戻る</span>';
    quitBtn.title = '対局を終了してメニューに戻る';
    quitBtn.addEventListener('click', opts.onQuit);
    actions.appendChild(quitBtn);
  }

  header.appendChild(playerCardsWrap);
  header.appendChild(actions);

  const reviveBanner = document.createElement('div');
  reviveBanner.className = 'revive-banner hidden';
  reviveBanner.innerHTML = '✨ 石が0個のため、盤内の空いている好きな場所に置いて復活できます！';

  const svg = el('svg', { viewBox, class: 'board' });
  const hintLayer = el('g', { class: 'hint-layer' });
  const adviceLayer = el('g', { class: 'advice-layer' });
  const stoneLayer = el('g', { class: 'stone-layer' });
  const effectsLayer = el('g', { class: 'effects-layer' });

  const stones = new Map<string, SVGCircleElement>();
  const hexes = new Map<string, SVGPolygonElement>();
  const blackholeCores = new Map<string, SVGCircleElement>();

  for (const cell of board.cells.values()) {
    const p = positions.get(hexKey(cell.q, cell.r))!;
    const hex = el('polygon', {
      points: hexPoints(p.x, p.y, size - 1.5),
      class: cell.type === 'bomb' ? 'hex hex-normal' : `hex hex-${cell.type}`,
      'data-q': String(cell.q),
      'data-r': String(cell.r),
    });
    hex.addEventListener('click', () => opts.onCellClick(cell.q, cell.r));
    svg.appendChild(hex);
    hexes.set(hexKey(cell.q, cell.r), hex);

    if (cell.type === 'blackhole') {
      const core = el('circle', { cx: String(p.x), cy: String(p.y), r: String(size * 0.4), class: 'blackhole-core' });
      svg.appendChild(core);
      blackholeCores.set(hexKey(cell.q, cell.r), core);
    }
    if (cell.type === 'double' || cell.type === 'triple') {
      const badge = el('text', {
        x: String(p.x + size * 0.32),
        y: String(p.y - size * 0.3),
        class: 'badge',
      });
      badge.textContent = cell.type === 'double' ? '×2' : '×3';
      svg.appendChild(badge);
    }

    const stone = el('circle', {
      cx: String(p.x),
      cy: String(p.y),
      r: String(size * 0.44),
      class: 'stone',
      fill: 'none',
      'data-stone': '',
    });
    stones.set(hexKey(cell.q, cell.r), stone);
    stoneLayer.appendChild(stone);
  }

  svg.appendChild(hintLayer);
  svg.appendChild(adviceLayer);
  svg.appendChild(stoneLayer);
  svg.appendChild(effectsLayer);

  const boardWrap = document.createElement('div');
  boardWrap.className = 'board-wrap';
  boardWrap.appendChild(svg);

  // AI助言カード（フローティングトースト風）
  const adviceCard = document.createElement('div');
  adviceCard.className = 'advice-card hidden';
  adviceCard.innerHTML = `
    <div class="advice-card-inner">
      <span class="advice-card-icon">🤖</span>
      <div class="advice-card-text"></div>
    </div>
  `;

  root.appendChild(header);
  root.appendChild(reviveBanner);
  root.appendChild(boardWrap);
  root.appendChild(adviceCard);
  container.appendChild(root);

  let prevOver = true;
  let prevTurn = 0;

  function update(
    state: GameState,
    viewOpts?: { showHints?: boolean; comment?: string | null; advice?: { q: number; r: number } | null },
  ): void {
    let placed = 0;
    let flipped = 0;
    let bombCoord: { x: number; y: number } | null = null;

    for (const cell of state.board.cells.values()) {
      const key = hexKey(cell.q, cell.r);
      const stone = stones.get(key)!;
      const prev = stone.getAttribute('data-stone');
      const now = String(cell.stone);
      if (prev !== now) {
        if ((prev === '' || prev === '-1') && cell.stone !== -1) {
          placed++;
          // 今回の着手で新たに石が置かれたマスがボムだった場合
          if (cell.type === 'bomb' && prevTurn < state.turn) {
            bombCoord = positions.get(key) ?? null;
          }
          stone.setAttribute('fill', opts.playerColors[cell.stone]);
          stone.setAttribute('data-stone', now);
          stone.classList.remove('pop', 'flip');
          void stone.getBoundingClientRect();
          stone.classList.add('pop');
        } else if (cell.stone !== -1) {
          flipped++;
          stone.setAttribute('fill', opts.playerColors[cell.stone]);
          stone.setAttribute('data-stone', now);
          stone.classList.remove('pop', 'flip');
          void stone.getBoundingClientRect();
          stone.classList.add('flip');
        } else {
          stone.setAttribute('fill', 'none');
          stone.setAttribute('data-stone', '-1');
        }
      }

      // 破壊モードで新しくブラックホール化したマスの反映
      const hex = hexes.get(key);
      if (cell.type === 'blackhole' && hex && !hex.classList.contains('hex-blackhole')) {
        hex.setAttribute('class', 'hex hex-blackhole');
        if (!blackholeCores.has(key)) {
          const p = positions.get(key)!;
          const core = el('circle', {
            cx: String(p.x),
            cy: String(p.y),
            r: String(size * 0.4),
            class: 'blackhole-core',
          });
          svg.insertBefore(core, hintLayer);
          blackholeCores.set(key, core);
        }
        if (prevTurn < state.turn) {
          bombCoord = positions.get(key) ?? null;
        }
      }
    }

    // ボム爆発時の画面シェイク ＆ 起爆点ショックウェーブ演出
    if (bombCoord) {
      boardWrap.classList.remove('shake');
      void boardWrap.getBoundingClientRect();
      boardWrap.classList.add('shake');

      const wave = el('circle', {
        cx: String(bombCoord.x),
        cy: String(bombCoord.y),
        r: String(size * 0.4),
        class: 'bomb-shockwave',
      });
      effectsLayer.appendChild(wave);
      window.setTimeout(() => wave.remove(), 700);
    }

    // ヒントレイヤー
    hintLayer.replaceChildren();
    if (!state.over && viewOpts?.showHints !== false) {
      const color = state.current;
      for (const m of movesFor(state, color)) {
        const p = positions.get(hexKey(m.q, m.r))!;
        const r = 5 + Math.min(m.gained, 9);
        // 外側のパルスリング
        const pulseRing = el('circle', {
          cx: String(p.x),
          cy: String(p.y),
          r: String(r + 3),
          class: m.free ? 'hint-ring hint-free' : 'hint-ring',
          stroke: opts.playerColors[color],
        });
        // 内側のコア
        const hintCore = el('circle', {
          cx: String(p.x),
          cy: String(p.y),
          r: String(r),
          class: m.free ? 'hint-core hint-free' : 'hint-core',
          fill: opts.playerColors[color],
          'data-q': String(m.q),
          'data-r': String(m.r),
        });
        hintLayer.appendChild(pulseRing);
        hintLayer.appendChild(hintCore);
      }
    }

    // スコアとプレイヤーカード同期
    const s = scores(state.board);
    playerCardEls.forEach((card, i) => {
      const scoreEl = card.querySelector<HTMLElement>('.pcard-score')!;
      scoreEl.textContent = String(s[i]);
      if (!state.over && state.current === i) {
        card.classList.add('active');
      } else {
        card.classList.remove('active');
      }
    });

    // 復活案内
    if (!state.over && s[state.current] === 0) {
      reviveBanner.classList.remove('hidden');
    } else {
      reviveBanner.classList.add('hidden');
    }

    root.style.setProperty(
      '--turn-color',
      state.over ? 'transparent' : opts.playerColors[state.current],
    );

    // 効果音
    if (bombCoord) {
      sound.play('bomb');
    } else {
      if (placed > 0) sound.play('place');
      if (flipped > 0) sound.play('flip', flipped);
      if (placed === 0 && state.turn > prevTurn && !state.over) sound.play('pass');
    }
    if (!prevOver && state.over) sound.play('win');
    prevOver = state.over;
    prevTurn = state.turn;

    // AI助言カードの更新
    const comment = viewOpts?.comment;
    if (comment) {
      adviceCard.querySelector('.advice-card-text')!.textContent = comment;
      adviceCard.classList.remove('hidden');
    } else {
      adviceCard.classList.add('hidden');
    }

    // 助言ボタンの有効/無効
    const adviceBtn = actions.querySelector<HTMLButtonElement>('#advice-btn');
    if (adviceBtn) {
      adviceBtn.disabled = state.over || viewOpts?.showHints === false;
    }

    // 助言マーカー
    adviceLayer.replaceChildren();
    if (viewOpts?.advice) {
      const p = positions.get(hexKey(viewOpts.advice.q, viewOpts.advice.r));
      if (p) {
        adviceLayer.appendChild(
          el('circle', {
            cx: String(p.x),
            cy: String(p.y),
            r: String(size * 0.58),
            class: 'advice-ring',
          }),
        );
      }
    }
  }

  return { update };
}

