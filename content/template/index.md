---
title: mermaid.js のテスト
date: "2021-01-19"
tags: ["Gatsby", "mermaid-js", "test"]
---

## 目次

```toc
```

## mermaid.jsのテスト1

### LR

```mermaid
graph LR
install[Install Plugin]
install --> configure[Configure Plugin]
configure --> draw[Draw Fancy Diagrams]
user[fas:fa-users user] -- edit --> folder[てすとtest]
```

## mermaid.jsのテスト2

### sequenceDiagram

```mermaid
sequenceDiagram
    ほげ ->> ふが: test
    ふが ->> ふが: 
    alt 実行成功
        ふが ->> ほげ: success
    else 失敗
        ふが ->> ほげ: failure
    end
```

## sandbox

[google](https://google.com)

```python{1}:title=test.py
import pandas as pd
df =  pd.read_csv('test.csv')
```

## 貼り付け

Ctrl + Shift + PrtSC でキャプチャ
Ctrl + Alt + V で貼り付け