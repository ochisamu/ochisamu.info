// scripts/generate-weekly-tech-clips.mjs
import fs from "node:fs/promises";
import path from "node:path";

const ownerRepo = process.env.GITHUB_REPOSITORY ?? "ochisamu/ochisamu.info";
const githubToken = process.env.GITHUB_TOKEN;
const openaiApiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL ?? "gpt-5.2-mini";

if (!githubToken) throw new Error("GITHUB_TOKEN is required");
if (!openaiApiKey) throw new Error("OPENAI_API_KEY is required");

const today = new Date();
const yyyy = today.getFullYear();
const mm = String(today.getMonth() + 1).padStart(2, "0");
const dd = String(today.getDate()).padStart(2, "0");
const date = `${yyyy}-${mm}-${dd}`;

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

function extractSection(body, heading) {
  const regex = new RegExp(`## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, "i");
  return body.match(regex)?.[1]?.trim() ?? "";
}

async function fetchTitle(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "ochisamu-info-tech-clip-bot",
      },
    });
    const html = await res.text();
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    return title?.replace(/\s+/g, " ").trim() ?? url;
  } catch {
    return url;
  }
}

const issues = await github(
  `/repos/${ownerRepo}/issues?state=open&labels=tech-clip&per_page=100`
);

const clips = [];

for (const issue of issues) {
  if (issue.pull_request) continue;

  const url = extractSection(issue.body ?? "", "URL");
  const comment = extractSection(issue.body ?? "", "Comment");

  if (!url || !comment) continue;

  clips.push({
    number: issue.number,
    issueUrl: issue.html_url,
    url,
    title: await fetchTitle(url),
    comment,
  });
}

if (clips.length === 0) {
  console.log("No tech clips found.");
  process.exit(0);
}

const prompt = `
あなたは個人技術ブログ「ochisamu.info」の編集者です。
以下の技術記事クリップをもとに、週次まとめ記事をMarkdownで作ってください。

方針:
- 日本語
- 個人ブログらしく、自然な技術メモ調
- 事実の断定を盛りすぎない
- ユーザーのコメントを主役にする
- 各クリップは「元記事」「ひとこと」「考えたこと」の構成
- 最後に「今週の所感」を入れる
- frontmatterは不要。本文だけ返す。
- Markdown以外の説明文は返さない。

クリップ:
${JSON.stringify(clips, null, 2)}
`;

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

const body =
  aiJson.output_text ??
  aiJson.output
    ?.flatMap((item) => item.content ?? [])
    ?.map((content) => content.text ?? "")
    ?.join("\n")
    ?.trim();

if (!body) throw new Error("No text returned from OpenAI API");

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

const outDir = path.join(
  "src",
  "content",
  "blog",
  String(yyyy),
  "tech-clips",
  date
);

await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, "index.md"), markdown);

console.log(`Generated ${outDir}/index.md`);