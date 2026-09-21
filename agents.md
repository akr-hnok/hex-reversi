### Cloudflare Workers 開発スキル・ルール
- このプロジェクトは Cloudflare Workers 上で動作するブラウザゲームです。
- UIの検証や動作テストを行う際は、`npx wrangler dev` を使用してローカル開発サーバー（デフォルト: http://localhost:8787）を起動・確認してください。
- 修正完了後、ユーザーから明示的なデプロイ指示があった場合のみ `npx wrangler deploy` を実行してください。
- 設定変更が必要な場合は `wrangler.toml` を確認・編集してください。

