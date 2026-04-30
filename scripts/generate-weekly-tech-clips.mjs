// scripts/generate-weekly-tech-clips.mjs
import fs from "node:fs/promises"
import path from "node:path"

const ownerRepo = process.env.GITHUB_REPOSITORY ?? "ochisamu/ochisamu.info"
const githubToken = process.env.GITHUB_TOKEN
const openaiApiKey = process.env.OPENAI_API_KEY
const model = process.env.OPENAI_MODEL ?? "gpt-5.4-mini"
const useOpenAIWebSearch = !["0", "false", "no"].includes(
  (process.env.OPENAI_WEB_SEARCH ?? "true").toLowerCase(),
)

const SOURCE_LABEL = "tech-clip"

// 1記事あたりAIに渡す本文テキストの最大文字数
const ARTICLE_TEXT_LIMIT = Number(process.env.ARTICLE_TEXT_LIMIT ?? 6000)

// 全クリップ合計でAIに渡す本文テキストの最大文字数
// 週に大量クリップしたときのトークン爆発を防ぐ
const TOTAL_ARTICLE_TEXT_LIMIT = Number(
  process.env.TOTAL_ARTICLE_TEXT_LIMIT ?? 24000,
)

if (!githubToken) throw new Error("GITHUB_TOKEN is required")
if (!openaiApiKey) throw new Error("OPENAI_API_KEY is required")

function getJstDateParts() {
  const now = new Date()

  const formatter = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })

  const parts = Object.fromEntries(
    formatter.formatToParts(now).map(p => [p.type, p.value]),
  )

  return {
    yyyy: parts.year,
    mm: parts.month,
    dd: parts.day,
    date: `${parts.year}-${parts.month}-${parts.day}`,
  }
}

const { yyyy, date } = getJstDateParts()

async function github(pathname, options = {}) {
  const res = await fetch(`https://api.github.com${pathname}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers ?? {}),
    },
  })

  if (!res.ok) {
    throw new Error(`GitHub API failed: ${res.status} ${await res.text()}`)
  }

  return res.json()
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * GitHub Issue本文からセクションを抜き出す。
 *
 * 対応例:
 *
 * ## URL
 * https://...
 *
 * ## Comment
 * ...
 *
 * ## コメント
 * ...
 */
function extractSection(body, headings) {
  const normalizedBody = body.replace(/\r\n/g, "\n")

  for (const heading of headings) {
    const escaped = escapeRegExp(heading)

    const markdownHeadingRegex = new RegExp(
      `^#{1,6}\\s*${escaped}\\s*\\n+([\\s\\S]*?)(?=\\n#{1,6}\\s+|$)`,
      "im",
    )

    const markdownHeadingMatch = normalizedBody.match(markdownHeadingRegex)
    if (markdownHeadingMatch?.[1]?.trim()) {
      return markdownHeadingMatch[1].trim()
    }
  }

  // 念のため、Markdown見出しではないプレーンな形式も拾う
  for (const heading of headings) {
    const escaped = escapeRegExp(heading)

    const plainHeadingRegex = new RegExp(
      `^${escaped}\\s*\\n+([\\s\\S]*?)(?=\\n(?:URL|Url|url|Comment|コメント|ひとことコメント|一言コメント|CreatedAt|Source)\\s*\\n+|$)`,
      "im",
    )

    const plainHeadingMatch = normalizedBody.match(plainHeadingRegex)
    if (plainHeadingMatch?.[1]?.trim()) {
      return plainHeadingMatch[1].trim()
    }
  }

  return ""
}

function cleanExtractedValue(value) {
  return value
    .replace(/^```[\s\S]*?\n/, "")
    .replace(/```$/, "")
    .trim()
}

function normalizeUrl(value) {
  const text = cleanExtractedValue(value)
  const match = text.match(/https?:\/\/[^\s)>\]]+/)
  return match?.[0]?.trim() ?? ""
}

function extractFirstUrl(body) {
  const normalizedBody = body.replace(/\r\n/g, "\n")
  const match = normalizedBody.match(/https?:\/\/[^\s)>\]]+/)
  return match?.[0]?.trim() ?? ""
}

function escapeMarkdownLinkText(value) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
}

function decodeHtml(value = "") {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#([0-9]+);/g, (_, num) =>
      String.fromCodePoint(Number.parseInt(num, 10)),
    )
}

function getAttributeValue(tag, attrName) {
  const regex = new RegExp(
    `${attrName}\\s*=\\s*["']([^"']*)["']|${attrName}\\s*=\\s*([^\\s>]+)`,
    "i",
  )
  const match = tag.match(regex)
  return decodeHtml(match?.[1] ?? match?.[2] ?? "").trim()
}

function getMetaContent(html, names) {
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? []

  for (const tag of metaTags) {
    const name = getAttributeValue(tag, "name").toLowerCase()
    const property = getAttributeValue(tag, "property").toLowerCase()
    const itemprop = getAttributeValue(tag, "itemprop").toLowerCase()

    const matched = names.some(target => {
      const normalized = target.toLowerCase()
      return (
        name === normalized ||
        property === normalized ||
        itemprop === normalized
      )
    })

    if (matched) {
      const content = getAttributeValue(tag, "content")
      if (content) return content
    }
  }

  return ""
}

function extractTitle(html, fallbackUrl) {
  const ogTitle = getMetaContent(html, [
    "og:title",
    "twitter:title",
    "headline",
  ])

  if (ogTitle) {
    return ogTitle.replace(/\s+/g, " ").trim()
  }

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]

  return decodeHtml(title?.replace(/\s+/g, " ").trim() ?? fallbackUrl)
}

function extractDescription(html) {
  const description = getMetaContent(html, [
    "description",
    "og:description",
    "twitter:description",
  ])

  return description.replace(/\s+/g, " ").trim()
}

function stripHtmlToText(html) {
  const withoutNoise = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")

  const withBreaks = withoutNoise
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(
      /<\/(p|div|section|article|main|header|footer|h[1-6]|li|ul|ol|pre|blockquote|table|tr)>/gi,
      "\n",
    )
    .replace(/<li\b[^>]*>/gi, "- ")

  const text = decodeHtml(withBreaks.replace(/<[^>]+>/g, " "))

  return text
    .split("\n")
    .map(line => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function extractBetweenTag(html, tagName) {
  const regex = new RegExp(
    `<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`,
    "gi",
  )
  const matches = [...html.matchAll(regex)].map(match => match[1])
  return matches
}

function extractArticleLikeBlocks(html) {
  const blocks = []

  // article/main はまず強く見る
  for (const tagName of ["article", "main"]) {
    for (const block of extractBetweenTag(html, tagName)) {
      blocks.push(block)
    }
  }

  // class/idに記事本文っぽい名前が含まれるdiv/sectionも拾う
  const articleClassRegex =
    /<(div|section)\b[^>]*(?:class|id)=["'][^"']*(?:article|entry|post|content|body|markdown|zenn|qiita)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi

  for (const match of html.matchAll(articleClassRegex)) {
    blocks.push(match[2])
  }

  return blocks
}

function extractArticleText(html) {
  const candidates = extractArticleLikeBlocks(html)
    .map(stripHtmlToText)
    .filter(text => text.length >= 200)

  if (candidates.length > 0) {
    candidates.sort((a, b) => b.length - a.length)
    return candidates[0]
  }

  // fallback: body全体から抽出
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html

  return stripHtmlToText(body)
}

function truncateText(text, maxLength) {
  const clean = text.trim()

  if (clean.length <= maxLength) {
    return clean
  }

  const sliced = clean.slice(0, maxLength)
  const boundaries = [
    sliced.lastIndexOf("\n\n"),
    sliced.lastIndexOf("。"),
    sliced.lastIndexOf(". "),
    sliced.lastIndexOf("\n"),
  ]

  const boundary = Math.max(...boundaries)
  const safeCut = boundary > maxLength * 0.6 ? boundary + 1 : maxLength

  return `${sliced.slice(0, safeCut).trim()}\n\n...[本文は長いため途中まで]`
}

async function fetchPageContext(url) {
  try {
    console.log(`Fetching article context: ${url}`)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 12000)

    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "clip-bot/1.0",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    })

    clearTimeout(timeout)

    if (!res.ok) {
      console.log(`Failed to fetch page: ${res.status} ${url}`)
      return {
        resolvedUrl: url,
        title: url,
        description: "",
        articleText: "",
        fetchStatus: `failed:${res.status}`,
      }
    }

    const contentType = res.headers.get("content-type") ?? ""

    if (!contentType.includes("text/html")) {
      console.log(`Skipped non-HTML page: ${contentType} ${url}`)
      return {
        resolvedUrl: res.url,
        title: url,
        description: "",
        articleText: "",
        fetchStatus: `non-html:${contentType}`,
      }
    }

    const html = await res.text()

    const title = extractTitle(html, url)
    const description = extractDescription(html)
    const articleText = truncateText(
      extractArticleText(html),
      ARTICLE_TEXT_LIMIT,
    )

    return {
      resolvedUrl: res.url,
      title,
      description,
      articleText,
      fetchStatus: "ok",
    }
  } catch (error) {
    console.log(`Failed to fetch page: ${url}`)
    console.log(error instanceof Error ? error.message : String(error))

    return {
      resolvedUrl: url,
      title: url,
      description: "",
      articleText: "",
      fetchStatus: "error",
    }
  }
}

function getIssueField(body, headings) {
  return cleanExtractedValue(extractSection(body, headings))
}

function parseIssue(issue) {
  const body = issue.body ?? ""
  const url =
    normalizeUrl(
      extractSection(body, ["URL", "Url", "url", "Link", "リンク"]),
    ) || extractFirstUrl(body)
  const comment = getIssueField(body, [
    "Comment",
    "コメント",
    "ひとことコメント",
    "一言コメント",
    "Memo",
    "メモ",
  ])
  const createdAt =
    getIssueField(body, ["CreatedAt", "Created At", "作成日時", "日時"]) ||
    issue.created_at
  const source = getIssueField(body, ["Source", "ソース", "共有元"])
  const tags = getIssueField(body, ["Tags", "Tag", "タグ"])
  const importance = getIssueField(body, ["Importance", "扱い", "優先度"])

  return {
    url,
    comment,
    createdAt,
    source,
    tags,
    importance,
  }
}

function limitTotalArticleText(clips) {
  let remaining = TOTAL_ARTICLE_TEXT_LIMIT

  return clips.map(clip => {
    const sourceExcerpt =
      remaining > 0
        ? truncateText(
            clip.sourceExcerpt ?? "",
            Math.min(ARTICLE_TEXT_LIMIT, remaining),
          )
        : ""

    remaining -= sourceExcerpt.length

    return {
      ...clip,
      sourceExcerpt,
    }
  })
}

function getOutputDir() {
  return path.join("src", "content", "blog", String(yyyy), "tech-clips", date)
}

function getOpenAIText(responseJson) {
  if (typeof responseJson.output_text === "string") {
    return responseJson.output_text.trim()
  }

  const text = responseJson.output
    ?.flatMap(item => item.content ?? [])
    ?.map(content => {
      if (typeof content.text === "string") return content.text
      if (typeof content.output_text === "string") return content.output_text
      return ""
    })
    ?.join("\n")
    ?.trim()

  return text ?? ""
}

async function main() {
  const issues = await github(
    `/repos/${ownerRepo}/issues?state=open&labels=${encodeURIComponent(
      SOURCE_LABEL,
    )}&per_page=100`,
  )

  console.log(`Fetched issues with label "${SOURCE_LABEL}": ${issues.length}`)

  const clips = []

  for (const issue of issues) {
    if (issue.pull_request) {
      console.log(`#${issue.number} skipped because it is a pull request`)
      continue
    }

    const labels = issue.labels.map(label => label.name).join(", ")

    console.log("----------------------------------------")
    console.log(`#${issue.number}: ${issue.title}`)
    console.log(`labels: ${labels}`)
    console.log(`body preview:\n${(issue.body ?? "").slice(0, 800)}`)

    const { url, comment, createdAt, source, tags, importance } =
      parseIssue(issue)

    if (!url || !comment) {
      console.log(`#${issue.number} skipped`)
      console.log(`url found: ${url ? "yes" : "no"}`)
      console.log(`comment found: ${comment ? "yes" : "no"}`)
      continue
    }

    const page = await fetchPageContext(url)

    console.log(`Fetched page title: ${page.title}`)
    console.log(`Description length: ${page.description.length}`)
    console.log(`Article text length: ${page.articleText.length}`)
    console.log(`Fetch status: ${page.fetchStatus}`)

    clips.push({
      number: issue.number,
      issueUrl: issue.html_url,
      url,
      sourceUrl: page.resolvedUrl ?? url,
      sourceTitle: page.title,
      sourceDescription: page.description,
      sourceExcerpt: page.articleText,
      fetchStatus: page.fetchStatus,
      comment,
      createdAt,
      source,
      tags,
      importance,
    })
  }

  console.log("----------------------------------------")
  console.log(`Valid clips: ${clips.length}`)

  if (clips.length === 0) {
    console.log("No tech clips found.")
    process.exit(0)
  }

  const clipsForPrompt = limitTotalArticleText(clips)

  const prompt = `
あなたは個人技術ブログ「ochisamu.info」の編集者です。
以下の技術記事クリップをもとに、週次まとめ記事をMarkdownで作ってください。

この記事の目的:
- 元記事の完全な要約ではなく、ユーザーが読んだ技術記事への「ひとこと反応ログ」をブログとして自然に整える
- ユーザーのコメントを主役にする
- 記事本文は文脈理解の補助として使う

方針:
- 日本語で書く
- 個人ブログらしい自然な技術メモ調にする
- 各クリップは「元記事」「ひとこと」「考えたこと」の構成にする
- 元記事のURLはMarkdownリンクにする
- sourceTitle/sourceDescription/sourceExcerpt はスクリプトがURLを取得して抽出した内容
- fetchStatusがokではない場合は、本文未取得であることを前提に、ユーザーコメントとURLから分かる範囲だけで書く
- ユーザーコメントの温度感を活かす
- 記事本文に書かれていないことを断定しない
- 断定しづらい場合は「〜そう」「〜かもしれない」「気になった」くらいの表現にする
- 記事本文を長く引用しない
- 原文の文章をそのまま大量に転載しない
- 1クリップあたりの「考えたこと」は短めでよい
- 最後に「今週の所感」を入れる
- frontmatterは不要。本文だけ返す
- Markdown以外の説明文は返さない

クリップ:
${JSON.stringify(clipsForPrompt, null, 2)}
`.trim()

  const requestBody = {
    model,
    input: prompt,
  }

  if (useOpenAIWebSearch) {
    requestBody.tools = [{ type: "web_search" }]
    requestBody.tool_choice = "auto"
    requestBody.include = ["web_search_call.action.sources"]
  }

  const aiRes = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  })

  if (!aiRes.ok) {
    throw new Error(`OpenAI API failed: ${aiRes.status} ${await aiRes.text()}`)
  }

  const aiJson = await aiRes.json()
  const body = getOpenAIText(aiJson)

  if (!body) {
    throw new Error("No text returned from OpenAI API")
  }

  const markdown = `---
title: "今週読んだ技術記事メモ ${date}"
date: "${date}"
description: "スマホから保存した技術記事クリップの週次まとめ。"
tags: ["Tech Clips", "AI", "開発メモ"]
---

\`\`\`toc
\`\`\`

${body}

---

## 参照したクリップ

${clips
  .map(clip => {
    const title = escapeMarkdownLinkText(clip.sourceTitle || clip.url)
    return `- #${clip.number}: [${title}](${clip.sourceUrl}) (${clip.fetchStatus})`
  })
  .join("\n")}
`

  const outDir = getOutputDir()
  await fs.mkdir(outDir, { recursive: true })
  await fs.writeFile(path.join(outDir, "index.md"), markdown)

  console.log(`Generated ${outDir}/index.md`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
