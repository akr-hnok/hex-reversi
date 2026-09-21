# Hex Reversi (3人対戦ヘクス・リバーシ)

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

3人対戦専用にゲームバランスと幾何学的対称性を徹底設計した、Webベースのヘクス（六角形）リバーシです。多人数リバーシ特有の「角の不公平」「全滅時の詰み」「手番の絶対的有利」といった構造的欠陥を幾何学設計・独自ルール・数理シミュレーションによって解決しています。

---

## 主な特徴

- **幾何学的に完全公平なヘクス盤面**
  - 四角い盤の「4つの角」を廃し、6つの角を持つ六角形（ヘクス）盤面を採用。全プレイヤー（3人）が平等に確定石（角）を狙える完全対称性を実現。
  - 盤面サイズは「一辺5マス（全61マス）」と「一辺6マス（全91マス）」から選択可能。
- **シミュレーション検証に基づく手番ローテーション**
  - 多人数リバーシで問題となる「最終手番が毎ラウンドの石を総取りして100%勝利する」致命的構造バイアスを解消。
  - 3手を1ラウンドとして開始席を順繰りにずらす「手番ローテーション」と「開始席・回転方向のランダム化」により、席順による不公平を排除。
  - 初心者・子供向けに有利な最終手番を固定できる「ハンデ機能」も搭載。
- **詰み・全滅を防止する「自由配置」システム**
  - 通常の挟み手が存在しない場合や、盤上の石が全滅した場合でも、任意の空きマスに石を1つ打って盤上に復帰可能。
  - 1,000局のシミュレーションにより「わざと全滅して隅を取る戦術」が悪用できない（全滅プレイヤーの勝率0%）ことも数理検証済み。
- **設定可能な拡張ギミック**
  - **倍点マス（×2 / ×3）:** 最終スコア集計時に石の得点が倍加。
  - **ブラックホール:** 石を配置できず、直線挟み判定もここで遮断。
  - **地雷（ボム）:** 空きマスであれば挟み判定不要で着手可能。周囲の石を自色に変える「反転モード」と、爆心地をブラックホール化して周囲を吹き飛ばす「破壊モード」を選択可能。
  - すべてのギミックは120°回転対称（オービット単位）で自動配置され、3人間の対称性を損ないません。
- **Workers AI による「💡 AI助言」**
  - Cloudflare Workers AI（`@cf/meta/llama-3.2-3b-instruct`）と連携。
  - 対局中に助言ボタンを押すと、LLMが局面を分析して最善の一手と日本語の一言解説を提案。
  - 回答はサーバー側で厳格に合法手を検証（フォールバック付き）。
- **高速な古典探索 COM エンジン**
  - 評価関数（石数＋位置重み＋着手可能手数）に基づくCOMを搭載。
  - 「かんたん（ランダム）」「ふつう（1手読み）」「つよい（2手先読み）」の3段階から難易度選択が可能。
- **リアルタイムオンライン対戦 ＆ 観戦**
  - Cloudflare Workers + Durable Objects + WebSocket によるサーバー権威型マルチプレイヤーアーキテクチャ。
  - ルーム作成・URL共有による途中参加・切断復帰・再戦投票（Rematch）に対応。全員COMによる自動観戦も可能。

---

## ルール概要

1. **基本の挟み込み:** 直線6方向のいずれかで、自分の石と新しく置く石で「自分以外の色」を挟むと、その間の石がすべて自色に反転します（他2色の混色挟みにも対応）。
2. **自由配置:** 盤面に挟める場所が1つもない（または全滅している）場合、任意の空きマス（ブラックホール以外）に石を1つ置くことができます（この着手では裏返しは発生しません）。
3. **地雷（ボム）:** 空きマスであれば挟み判定に関係なく着手可能。効果に応じて周囲6マスを強制反転、または爆心地をブラックホール化して周囲石を破壊します。
4. **終了条件:** 盤面が石で埋まる（ブラックホール除く）か、全員が連続してパスした時点で終了し、獲得石数（倍点マス含む）が最も多いプレイヤーの勝利となります（同点時は共勝）。

---

## 技術スタック

- **フロントエンド:** TypeScript, Vite, SVG（盤面描画）, Web Audio API（効果音生成）
- **バックエンド:** Cloudflare Workers, Durable Objects（ルームステート永続化・WebSocketハブ）
- **AI / 機械学習:** Cloudflare Workers AI (`@cf/meta/llama-3.2-3b-instruct`)
- **テスト:** Vitest（単体テスト、モンテカルロシミュレーション）

---

## ディレクトリ構成

```text
├── src/
│   ├── core/           # ゲームコアロジック（環境非依存）
│   │   ├── board.ts    # 盤面生成・ギミックオービット配置
│   │   ├── engine.ts   # ヒューリスティックCOM評価関数・探索
│   │   ├── game.ts     # ゲーム進行・手番ローテーション・勝敗判定
│   │   ├── hex.ts      # Axial座標系(q, r)計算・回転対称性
│   │   ├── rules.ts    # 合法手判定・石反転・ボム爆発
│   │   ├── serde.ts    # 状態シリアライズ／デシリアライズ
│   │   └── types.ts    # 共通定数・色・ギミック等の型定義
│   ├── server/         # Cloudflare Workers / Durable Objects 実装
│   │   ├── com.ts      # Workers AI プロンプト構築・助言抽出
│   │   ├── index.ts    # エントリーポイント・APIルーティング
│   │   ├── room-core.ts# ルーム状態遷移マシン（サーバー権威）
│   │   └── room.ts     # Durable Object 実装（WebSocket接続管理）
│   ├── client/         # ブラウザクライアント UI
│   │   ├── boardView.ts# ヘクス盤面 SVG 描画・アニメーション
│   │   ├── main.ts     # アプリケーション初期化・画面遷移
│   │   ├── net.ts      # WebSocket 通信・API クライアント
│   │   ├── sound.ts    # Web Audio API シンセサイザー効果音
│   │   ├── styles.css  # UI デザインシステム・レスポンシブスタイル
│   │   └── ui.ts       # メニュー・対局情報・設定・ダイアログ
│   └── shared/         # クライアント・サーバー共有型定義
│       └── protocol.ts # WebSocket 通信プロトコル・メッセージ
├── tests/              # テストコード
│   ├── core/           # コアルール・盤面・シミュレーションテスト
│   ├── server/         # ルームロジック・Workers AI テスト
│   └── client/         # クライアント単体テスト
├── wrangler.toml       # Cloudflare Workers / Durable Objects / AI 設定
└── vite.config.ts      # Vite ビルド設定
```

---

## 開発環境のセットアップ

### 前提条件

- Node.js (v20以上推奨)
- npm

### インストール

```bash
git clone https://github.com/akr-hnok/hex-reversi.git
cd hex-reversi
npm install
```

### ローカル開発サーバーの起動

#### 1. フロントエンド単体（Vite Dev Server）
ローカル対戦や探索エンジンCOM対戦、盤面UIの検証を高速に行う場合：

```bash
npm run dev
```
（ブラウザで `http://localhost:5173` にアクセス）

#### 2. フルスタック（Cloudflare Workers + Durable Objects + Workers AI）
WebSocketオンライン対戦やAI助言APIを含めて本番同等環境をローカル検証する場合：

```bash
npm run dev:server
```
（ビルド後に Wrangler が起動し、`http://localhost:8787` でエミュレーションが動作）

---

## テストおよび型チェック

### 型チェック
```bash
npm run typecheck
```

### 単体テスト実行
```bash
npm test
```

### ゲームバランス・モンテカルロシミュレーション
ルールごとの勝率・全滅率・着手分布を検証するシミュレーションテストを実行できます。

```bash
# 通常ルールと各種ギミックルールの比較シミュレーション
npx vitest run tests/core/compare-simulation.test.ts

# 1,000局の大規模対戦シミュレーションによるバランス回帰テスト
SIM_GAMES=1000 npx vitest run tests/core/balance-simulation.test.ts
```

---

## デプロイ

Cloudflare Workers へのデプロイは以下の手順で行います。

```bash
# Cloudflare アカウントにログイン
npx wrangler login

# アセットのビルドおよび Workers へのデプロイ
npm run deploy
```

> [!NOTE]
> Durable Objects を Free プランでも動作させるため、`wrangler.toml` では SQLite バックエンドマイグレーション（`new_sqlite_classes`）を採用しています。

---

## ライセンス

本プロジェクトは Apache License 2.0 の下で公開されています。

```text
Copyright 2026

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```
