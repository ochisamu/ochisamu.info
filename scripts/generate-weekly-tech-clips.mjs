// scripts/generate-weekly-tech-clips.mjs
import fs from "node:fs/promises";
import path from "node:path";

const ownerRepo = process.env.GITHUB_REPOSITORY ?? "ochisamu/ochisamu.info";
const githubToken = process.env.GITHUB_TOKEN;
const openaiApiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL ?? "gpt-5.4-mini";

const SOURCE_LABEL = "tech-clip";

if (!githubToken) throw new Error("GITHUB_TOKEN is required");
if (!openaiApiKey) throw new Error("OPENAI_API_KEY is required");

function getJstDateParts() {
  const now = new Date();

  const formatter = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(now).map((p) => [p.type, p.value])
  );

  return {
    yyyy: parts.year,
    mm: parts.month,
    dd: parts.day,
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

const { yyyy, mm, dd, date } = getJstDateParts();

async function github(pathname, options = {}) {
  const res = await fetch(`https://api.github.com${pathname}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    throw new Error(`GitHub API failed: ${res.status} ${await res.text()}`);
  }

  return res.json();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
 *
 * ### ひとことコメント
 * ...
 */
function extractSection(body, headings) {
  const normalizedBody = body.replace(/\r\n/g, "\n");

  for (const heading of headings) {
    const escaped = escapeRegExp(heading);

    const markdownHeadingRegex = new RegExp(
      `^#{1,6}\\s*${escaped}\\s*\\n+([\\s\\S]*?)(?=\\n#{1,6}\\s+|$)`,
      "im"
    );

    const markdownHeadingMatch = normalizedBody.match(markdownHeadingRegex);
    if (markdownHeadingMatch?.[1]?.trim()) {
      return markdownHeadingMatch[1].trim();
    }
  }

  /**
   * 念のため、Markdown見出しになっていない場合も拾う。
   *
   * URL
   * https://...
   *
   * コメント
   * ...
   */
  for (const heading of headings) {
    const escaped = escapeRegExp(heading);

    const plainHeadingRegex = new RegExp(
      `^${escaped}\\s*\\n+([\\s\\S]*?)(?=\\n(?:URL|Url|url|Comment|コメント|ひとことコメント|一言コメント|CreatedAt|Source)\\s*\\n+|$)`,
      "im"
    );

    const plainHeadingMatch = normalizedBody.match(plainHeadingRegex);
    if (plainHeadingMatch?.[1]?.trim()) {
      return plainHeadingMatch[1].trim();
    }
  }

  return "";
}

function cleanExtractedValue(value) {
  return value
    .replace(/^```[\s\S]*?\n/, "")
    .replace(/```$/, "")
    .trim();
}

function normalizeUrl(value) {
  const text = cleanExtractedValue(value);

  const match = text.match(/https?:\/\/[^\s)>\]]+/);
  return match?.[0]?.trim() ?? "";
}

async function fetchTitle(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "ochisamu-info-tech-clip-bot/1.0",
      },
    });

    clearTimeout(timeout);

    if (!res.ok) {
      console.log(`Failed to fetch title: ${res.status} ${url}`);
      return url;
    }

    const html = await res.text();

    const ogTitle =
      html.match(
        /<meta\s+(?:property|name)=["']og:title["']\s+content=["']([^"']+)["'][^>]*>/i
      )?.[1] ??
      html.match(
        /<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:title["'][^>]*>/i
      )?.[1];

    const title =
      ogTitle ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];

    return decodeHtml(title?.replace(/\s+/g, " ").trim() ?? url);
  } catch (error) {
    console.log(`Failed to fetch title: ${url}`);
    console.log(error instanceof Error ? error.message : String(error));
    return url;
  }
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function slugify(value) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function getOutputDir() {
  return path.join(
    "src",
    "content",
    "blog",
    String(yyyy),
    "tech-clips",
    date
  );
}

function getOpenAIText(responseJson) {
  if (typeof responseJson.output_text === "string") {
    return responseJson.output_text.trim();
  }

  const text = responseJson.output
    ?.flatMap((item) => item.content ?? [])
    ?.map((content) => content.text ?? "")
    ?.join("\n")
    ?.trim();

  return text ?? "";
}

async function main() {
  const issues = await github(
    `/repos/${ownerRepo}/issues?state=open&labels=${encodeURIComponent(
      SOURCE_LABEL
    )}&per_page=100`
  );

  console.log(`Fetched issues with label "${SOURCE_LABEL}": ${issues.length}`);

  const clips = [];

  for (const issue of issues) {
    if (issue.pull_request) {
      console.log(`#${issue.number} skipped because it is a pull request`);
      continue;
    }

    const labels = issue.labels.map((label) => label.name).join(", ");

    console.log("----------------------------------------");
    console.log(`#${issue.number}: ${issue.title}`);
    console.log(`labels: ${labels}`);
    console.log(`body preview:\n${(issue.body ?? "").slice(0, 800)}`);

    const rawUrl = extractSection(issue.body ?? "", ["URL", "Url", "url"]);
    const rawComment = extractSection(issue.body ?? "", [
      "Comment",
      "コメント",
      "ひとことコメント",
      "一言コメント",
    ]);
    const rawCreatedAt = extractSection(issue.body ?? "", [
      "CreatedAt",
      "Created At",
      "作成日時",
      "日時",
    ]);

    const url = normalizeUrl(rawUrl);
    const comment = cleanExtractedValue(rawComment);
    const createdAt = cleanExtractedValue(rawCreatedAt);

    if (!url || !comment) {
      console.log(`#${issue.number} skipped`);
      console.log(`url found: ${url ? "yes" : "no"}`);
      console.log(`comment found: ${comment ? "yes" : "no"}`);
      continue;
    }

    const title = await fetchTitle(url);

    clips.push({
      number: issue.number,
      issueUrl: issue.html_url,
      url,
      title,
      comment,
      createdAt,
    });
  }

  console.log("----------------------------------------");
  console.log(`Valid clips: ${clips.length}`);

  if (clips.length === 0) {
    console.log("No tech clips found.");
    process.exit(0);
  }

  const prompt = `
あなたは個人技術ブログ「ochisamu.info」の編集者です。
以下の技術記事クリップをもとに、週次まとめ記事をMarkdownで作ってください。

方針:
- 日本語で書く
- 個人ブログらしい自然な技術メモ調にする
- ユーザーの「コメント」を主役にする
- 各クリップは「元記事」「ひとこと」「考えたこと」の構成にする
- 元記事のURLはMarkdownリンクにする
- 事実の断定を盛りすぎない
- 記事タイトルから推測できる範囲を超えて、内容を勝手に詳述しすぎない
- 「気になった」「試してみたい」くらいの温度感はそのまま活かす
- 最後に「今週の所感」を入れる
- frontmatterは不要。本文だけ返す
- Markdown以外の説明文は返さない

クリップ:
${JSON.stringify(clips, null, 2)}
`.trim();

  const aiRes = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: prompt,
    }),
  });

  if (!aiRes.ok) {
    throw new Error(`OpenAI API failed: ${aiRes.status} ${await aiRes.text()}`);
  }

  const aiJson = await aiRes.json();
  const body = getOpenAIText(aiJson);

  if (!body) {
    throw new Error("No text returned from OpenAI API");
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

${clips.map((clip) => `- #${clip.number}: ${clip.url}`).join("\n")}
`;

  const outDir = getOutputDir();
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "index.md"), markdown);

  console.log(`Generated ${outDir}/index.md`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});