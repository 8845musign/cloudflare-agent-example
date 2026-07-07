# cloudflare-agent-example

[Cloudflare Agents](https://agents.cloudflare.com/) を使った学習用デモ。
ヘッドレスブラウザでの Web 閲覧と、永続ワークスペース上のファイル読み書きができる Claude Code 風のチャットエージェント。

要件の詳細は [REQUIREMENTS.md](./REQUIREMENTS.md) を参照。

## 構成

- **Worker + Agents SDK** — `ChatAgent`(Durable Object)が会話・ファイル・ツール実行を担当
- **仮想ファイルシステム** — DO 内蔵 SQLite の `files` テーブル。メタデータは state sync で UI に即時反映
- **Browser Rendering** — `@cloudflare/puppeteer` で `fetch_page`(本文抽出)と `screenshot`(PNG 保存)
- **LLM** — OpenAI `gpt-5-mini`(`wrangler.jsonc` の `OPENAI_MODEL` で変更可)
- **UI** — React + Vite + kumo。左チャット / 右ファイルパネルの 2 ペイン
- **承認フロー** — `write_file` / `delete_file` は UI で Approve してから実行(`needsApproval`)
- **ワークスペース** — `/w/:name` で切替。1 ワークスペース = 1 DO インスタンス

## セットアップ

```sh
npm install
cp .dev.vars.example .dev.vars   # OPENAI_API_KEY を記入
npx wrangler login               # Browser Rendering はローカル dev でもリモート実行のため必須
npm run dev
```

## デプロイ

```sh
npx wrangler secret put OPENAI_API_KEY
npm run deploy
```

## エージェントのツール

| ツール        | 内容                                      | 承認     |
| ------------- | ----------------------------------------- | -------- |
| `list_files`  | ワークスペースのファイル一覧              | 不要     |
| `read_file`   | テキストファイルの読み取り                | 不要     |
| `write_file`  | ファイル作成・上書き                      | **必要** |
| `delete_file` | ファイル削除                              | **必要** |
| `fetch_page`  | URL を開いて本文テキスト抽出              | 不要     |
| `screenshot`  | ページの PNG を撮ってワークスペースに保存 | 不要     |
