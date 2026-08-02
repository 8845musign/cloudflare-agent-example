# Cloudflare Think Agent

`@cloudflare/think` を使ったチャットエージェントです。会話履歴とコンテキストメモリを Durable Object に永続化し、AI Gateway 経由でモデルを呼び出します。

## 前提

- Node.js と npm
- Cloudflare アカウント
- Workers AI と AI Gateway を利用できる権限

ローカル開発でも `wrangler.jsonc` の `remote: true` により Workers AI をリモートで利用するため、先にログインします。

```sh
npx wrangler login
```

## ローカルで起動

コマンドはリポジトリのルートから実行してください。

```sh
cd memory
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

起動後、ブラウザで [http://localhost:5173/](http://localhost:5173/) を開きます。

`.dev.vars` の `AI_GATEWAY_ID` はローカル開発時だけ `wrangler.jsonc` の値を上書きします。カスタム AI Gateway を使う場合は、利用する Gateway の名前または ID に変更してください。

```dotenv
AI_GATEWAY_ID=your-gateway-id
```

モデルを一時的に変更する場合は、同じファイルに `MODEL` を追加します。通常は `wrangler.jsonc` の `openai/gpt-5.6-luna` が使われ、推論 effort はサーバー側で `none` に固定されています。

## Binding と設定

Bindingだけを手動で作成する必要はありません。必要な設定は `memory/wrangler.jsonc` に定義済みです。

| 設定            | 役割                                                                                  |
| --------------- | ------------------------------------------------------------------------------------- |
| `AI`            | Workers AI のリモート Binding。AI Gateway Provider の接続に使います。                 |
| `ThinkAgent`    | Think を実行する Durable Object。会話、Session context、SQLite の永続化を担当します。 |
| `MODEL`         | 使用モデル。既定値は `openai/gpt-5.6-luna` です。                                     |
| `AI_GATEWAY_ID` | 使用する AI Gateway の名前または ID。既定値は `default` です。                        |

今回のメモリは Think の Session context と Durable Object 内蔵 SQLite を使うため、Agent Memory 用の外部 Binding は追加しません。`soul` はコード固定、`memory` は AI が更新でき、`knowledge` は検索可能な永続コンテキストとして動作します。

## 動作確認

次のような会話を行うと、メモリの永続化を確認できます。

1. 「私への回答は今後簡潔にして」と伝える。
2. ページを再読み込みし、回答の長さに設定が反映されることを確認する。
3. プロジェクト固有の事実を伝え、別の質問でも検索可能な知識として参照されることを確認する。

同じ `default` エージェントに接続する会話では、保存されたコンテキストが共有されます。

## デプロイ

```sh
npm run deploy
```

`npm run deploy` は Vite のビルド後に Wrangler で Worker と Durable Object をデプロイします。`.dev.vars` はローカル専用で、デプロイ先には反映されません。デプロイ先でカスタム Gateway を使う場合は、対象環境の `wrangler.jsonc` の `vars.AI_GATEWAY_ID` を設定してください。

API キーをこのプロジェクトに追加する必要はありません。AI 呼び出しは Workers AI Binding と AI Gateway を使います。秘密情報を追加する場合は `wrangler.jsonc` の `vars` ではなく Wrangler Secret を利用してください。

設定や Binding を変更した後は、型定義を更新できます。

```sh
npm run types
npm run check
```

参考:

- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Local development and environment variables](https://developers.cloudflare.com/workers/local-development/environment-variables/)
