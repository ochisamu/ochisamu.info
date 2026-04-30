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

## Deploy

`npm run build` は `dist` に静的サイトを生成します。

Cloudflare Workers へは `wrangler.jsonc` の static assets 設定でデプロイします。

```sh
npm run deploy:cloudflare
```

Firebase Hosting を使う場合も `firebase.json` は `dist` を公開する設定です。
