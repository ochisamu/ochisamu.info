# ochisamu.info

Astro で構築した技術メモサイトです。

## Commands

```sh
npm install
npm run dev
npm run build
npm run preview
npm run deploy:cloudflare
```

## Content

記事は `src/content/blog` に Markdown で追加します。

```md
---
title: 記事タイトル
date: "2026-04-30"
tags: ["tag"]
---
```

` ```toc ` は記事内の見出しから目次へ変換されます。` ```mermaid ` は Mermaid diagram として表示されます。

## Weekly Tech Clips

`tech-clip` ラベル付きの Issue から週次まとめ記事を生成します。

```sh
GITHUB_TOKEN=... OPENAI_API_KEY=... node scripts/generate-weekly-tech-clips.mjs
```

スクリプト側で Issue 内の URL を取得し、タイトル・説明・本文抜粋を LLM に渡します。OpenAI の Web search tool はデフォルトで有効です。無効にする場合は `OPENAI_WEB_SEARCH=false` を指定します。

## Deploy

`npm run build` は `dist` に静的サイトを生成します。

Cloudflare Workers へは `wrangler.jsonc` の static assets 設定でデプロイします。

```sh
npm run deploy:cloudflare
```

Firebase Hosting を使う場合も `firebase.json` は `dist` を公開する設定です。
