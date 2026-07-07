# cloudflare-agent-example 要件定義

Cloudflare Agents SDK を使った学習・実験用のエージェントデモ。
ブラウザ閲覧とワークスペース内ファイルの読み書きができる、Claude Code 風の Web チャットアプリを作る。

## 位置づけ

- **学習・実験用デモ**。自分だけが使う前提。
- 認証なし(workers.dev の URL 非公開運用)。レート制限・課金保護は作り込まない。

## 技術スタック

| 項目           | 決定                                                                             |
| -------------- | -------------------------------------------------------------------------------- |
| 基盤           | Cloudflare Workers + Agents SDK (`agents` パッケージ)                            |
| LLM            | Google Gemini **gemini-2.5-flash**(環境変数でモデル差し替え可能にする)           |
| LLM 接続       | Vercel AI SDK 経由(`@ai-sdk/google`)                                             |
| ブラウザ       | Cloudflare Browser Rendering(`@cloudflare/puppeteer`)                            |
| ファイル実体   | Agent(Durable Object)内蔵 SQLite の仮想ファイルシステム(path / content テーブル) |
| フロントエンド | `cloudflare/agents-starter` ベース(React + Vite + Tailwind、`useAgentChat`)      |
| デプロイ       | wrangler で workers.dev へデプロイまで行う                                       |

## 機能要件

### エージェントのツール

- **ファイル操作**(DO 内蔵 SQLite 上の仮想 FS)
  - `list_files` / `read_file` — 自動実行
  - `write_file` / `delete_file` — **UI での人間承認後に実行**(human-in-the-loop)
- **ブラウザ(閲覧系のみ)**
  - `fetch_page` — URL を開いて本文を Markdown 抽出。結果はファイルに保存も可能
  - `screenshot` — ページのスクリーンショット取得、チャットに表示
  - click / type などのインタラクティブ操作は**スコープ外**

### Web UI

- 2 ペイン構成: 左にストリーミングチャット、右にワークスペースのファイル一覧+内容ビューア
- エージェントがファイルを更新したらパネルに即時反映(Agents SDK の state sync を利用)
- ツール実行の可視化と、更新系ツールの承認/拒否ボタン
- ファイルの手動編集(エディタ機能)は**スコープ外**

### ワークスペース

- URL パス(例: `/w/:name`)でワークスペースを切り替え
- 1 ワークスペース = 1 Agent インスタンス(Durable Object)。会話履歴とファイル一式を保持し、ブラウザを閉じても永続

## スコープ外

- 認証・マルチユーザー対応
- インタラクティブなブラウザ操作(フォーム入力など)
- ファイルの手動編集 UI
- ワークスペースの一覧・管理 UI(URL 直打ちで切替)
