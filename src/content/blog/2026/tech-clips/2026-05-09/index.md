---
title: "今週読んだ技術記事メモ 2026-05-09"
date: "2026-05-09"
description: "スマホから保存した技術記事クリップの週次まとめ。"
tags: ["Tech Clips", "AI", "開発メモ"]
---

```toc
```

今週は、Claude Code の WebFetch の読み方と、Codex の App Server / SDK の役割分担が特に気になりました。どちらも「LLM をどう使うか」ではなく、「実際に何を読んで、どこまでを UI や自動化に出すか」という運用の話だったので、メモとして残しておきます。

## WebFetch は「全文を読んだつもり」になりやすい

### 元記事
[あなたのClaude CodeのWebFetch、実はWebをちゃんと読んでいない](https://zenn.dev/zhizhiarv/articles/claude-code-webfetch-haiku-summary)

### ひとこと
WebFetch が常に原文を読んでいるわけではなく、かなりの場面で要約経由になっている、という指摘でした。

### 読んで考えたこと
ここは実装よりも運用の怖さが大きいと感じました。`Received 204.4KB` のように見えても、実際には上位モデルに要約だけ渡っていることがあるので、「読めた前提」で実装判断すると危ないです。

特に気になったのは、長文の後半が静かに落ちる点と、信頼済みドメインでは Markdown をそのまま返す場合がある点でした。つまり、同じ WebFetch でもページによって中身の扱いが変わるので、一次情報が必要な場面ではそのまま信用しない方がよさそうです。

実務では、必要に応じて `curl` や `defuddle parse URL --md`、MCP ツールに切り替える、という逃げ道を持っておくのが大事だと思いました。便利さはあるけど、正確さと安全性は別問題でした。

## Codex は「自動化」と「UI」で使い分ける

### 元記事
[「Codex App Server」を試す](https://zenn.dev/kun432/scraps/9fe862943fb00e)

### ひとこと
Codex SDK と Codex App Server の役割が整理されていて、何を選ぶべきかがかなり分かりやすかったです。

### 読んで考えたこと
この記事を読んで、App Server は「Codex を動かすもの」というより「Codex のクライアント UI を作るためのもの」だと捉えると分かりやすいと思いました。会話履歴、承認、イベントストリーミングまで含めて扱いたいなら App Server、CI/CD やバッチ処理なら SDK や `codex exec` の方が自然です。

個人用途なら、ChatGPT アカウントのサブスク範囲で自作アプリから呼びたい、という動機がかなり強そうでした。逆に公開アプリのバックエンドでそのまま使うのは、認証や課金、権限制御をちゃんと考えないといけないので、軽く触るのと本番運用は別物だと感じます。

自分ならまずは、手で触る UI は Codex App、軽い自動化は `codex exec`、アプリに組み込む段階で SDK か App Server を検討する、という順で考えます。役割を分けないと、低水準なものを無理に全部に使ってしまいそうでした。

## 今週の所感

今週は「LLM が読んでいるものを、こちらが勝手に理想化しない」ことが大事だと思いました。WebFetch も Codex も、便利さの裏で中身の層が分かれているので、次は実際に使うときに「原文なのか、要約なのか」「自動化なのか、UI なのか」を先に確認してから触りたいです。

---

## 参照したクリップ

- [あなたのClaude CodeのWebFetch、実はWebをちゃんと読んでいない](https://zenn.dev/zhizhiarv/articles/claude-code-webfetch-haiku-summary)
- [「Codex App Server」を試す](https://zenn.dev/kun432/scraps/9fe862943fb00e)
