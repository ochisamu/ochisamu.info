#!/usr/bin/env python3
import base64
import html
import json
import os
import re
import sys
import textwrap
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup
from deepagents import create_deep_agent
from openai import APIStatusError, OpenAI, OpenAIError


OWNER_REPO = os.environ.get("GITHUB_REPOSITORY", "ochisamu/ochisamu.info")
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-5.4-mini")
SOURCE_LABEL = "tech-clip"
ARTICLE_TEXT_LIMIT = int(os.environ.get("ARTICLE_TEXT_LIMIT", "12000"))
TOTAL_ARTICLE_TEXT_LIMIT = int(os.environ.get("TOTAL_ARTICLE_TEXT_LIMIT", "48000"))
OPENAI_WEB_SEARCH = os.environ.get("OPENAI_WEB_SEARCH", "true").lower() not in {
    "0",
    "false",
    "no",
}
GENERATE_COVER_IMAGE = os.environ.get("GENERATE_COVER_IMAGE", "false").lower() in {
    "1",
    "true",
    "yes",
}
OPENAI_IMAGE_MODEL = os.environ.get("OPENAI_IMAGE_MODEL", "gpt-image-2")
OPENAI_IMAGE_SIZE = os.environ.get("OPENAI_IMAGE_SIZE", "1536x1024")
OPENAI_IMAGE_QUALITY = os.environ.get("OPENAI_IMAGE_QUALITY", "high")

AUTHOR_STYLE_GUIDE = """
Author style reference:
- Write like a practical Japanese technical note based on personal implementation experience.
- Start from why the topic mattered or what problem was noticed, then move to concrete details.
- Prefer plain endings such as 「しました」「しています」「思いました」「気になりました」 over polished essay-like wording.
- Use first-person observations naturally: 「今回は」「この記事では」「読んでいて」「実装するなら」.
- Explain constraints and trade-offs explicitly: limits, operational burden, stability, maintainability, cost, or workflow fit.
- When listing points, use short bullet lists only when they help organize implementation details.
- Parenthetical asides are acceptable when they sound like a personal note, but avoid overusing them.
- Avoid marketing copy, dramatic phrasing, and abstract conclusions.
- Do not sound like a generic article summary. The article should read like the author is recording what they tried, noticed, and may want to try next.
- Section headings should be concrete topic labels, similar to 「背景」「進め方」「結果」「最終的な構成」, but adapted to the linked article.
""".strip()


if not GITHUB_TOKEN:
    raise RuntimeError("GITHUB_TOKEN is required")
if not OPENAI_API_KEY:
    raise RuntimeError("OPENAI_API_KEY is required")


@dataclass
class PageContext:
    resolved_url: str
    title: str
    description: str
    text: str
    fetch_status: str


@dataclass
class Clip:
    number: int
    issue_url: str
    url: str
    comment: str
    created_at: str
    source: str
    tags: str
    importance: str
    source_url: str
    source_title: str
    source_description: str
    source_excerpt: str
    fetch_status: str


@dataclass
class CoverImageResult:
    enabled: bool
    path: str | None
    model: str | None
    size: str | None
    quality: str | None
    prompt: str | None
    error: str | None


def deepagents_model_id() -> str:
    if ":" in OPENAI_MODEL:
        return OPENAI_MODEL
    return f"openai:{OPENAI_MODEL}"


def jst_date() -> tuple[str, str]:
    now = datetime.now(ZoneInfo("Asia/Tokyo"))
    return str(now.year), now.strftime("%Y-%m-%d")


def github(pathname: str, method: str = "GET", payload: dict | None = None):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        f"https://api.github.com{pathname}",
        data=data,
        method=method,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {GITHUB_TOKEN}",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GitHub API failed: {error.code} {body}") from error


def extract_section(body: str, headings: list[str]) -> str:
    normalized = body.replace("\r\n", "\n")

    for heading in headings:
        escaped = re.escape(heading)
        match = re.search(
            rf"^#{{1,6}}\s*{escaped}\s*\n+([\s\S]*?)(?=\n#{{1,6}}\s+|$)",
            normalized,
            flags=re.IGNORECASE | re.MULTILINE,
        )
        if match and match.group(1).strip():
            return match.group(1).strip()

    boundary = (
        "URL|Url|url|Link|リンク|Comment|コメント|ひとことコメント|一言コメント|"
        "Memo|メモ|CreatedAt|Created At|作成日時|日時|Source|ソース|共有元|"
        "Tags|Tag|タグ|Importance|扱い|優先度"
    )

    for heading in headings:
        escaped = re.escape(heading)
        match = re.search(
            rf"^{escaped}\s*\n+([\s\S]*?)(?=\n(?:{boundary})\s*\n+|$)",
            normalized,
            flags=re.IGNORECASE | re.MULTILINE,
        )
        if match and match.group(1).strip():
            return match.group(1).strip()

    return ""


def clean_extracted_value(value: str) -> str:
    value = re.sub(r"^```[\s\S]*?\n", "", value)
    value = re.sub(r"```$", "", value)
    return value.strip()


def extract_first_url(value: str) -> str:
    match = re.search(r"https?://[^\s)>\]]+", value)
    return match.group(0).strip() if match else ""


def parse_issue(issue: dict) -> dict:
    body = issue.get("body") or ""
    raw_url = extract_section(body, ["URL", "Url", "url", "Link", "リンク"])
    url = extract_first_url(clean_extracted_value(raw_url)) or extract_first_url(body)
    comment = clean_extracted_value(
        extract_section(
            body,
            ["Comment", "コメント", "ひとことコメント", "一言コメント", "Memo", "メモ"],
        )
    )
    created_at = clean_extracted_value(
        extract_section(body, ["CreatedAt", "Created At", "作成日時", "日時"])
    ) or issue.get("created_at", "")
    source = clean_extracted_value(extract_section(body, ["Source", "ソース", "共有元"]))
    tags = clean_extracted_value(extract_section(body, ["Tags", "Tag", "タグ"]))
    importance = clean_extracted_value(
        extract_section(body, ["Importance", "扱い", "優先度"])
    )

    return {
        "url": url,
        "comment": comment,
        "created_at": created_at,
        "source": source,
        "tags": tags,
        "importance": importance,
    }


def truncate_text(text: str, max_length: int) -> str:
    clean = text.strip()
    if len(clean) <= max_length:
        return clean

    sliced = clean[:max_length]
    boundaries = [
        sliced.rfind("\n\n"),
        sliced.rfind("。"),
        sliced.rfind(". "),
        sliced.rfind("\n"),
    ]
    boundary = max(boundaries)
    end = boundary + 1 if boundary > max_length * 0.6 else max_length
    return f"{sliced[:end].strip()}\n\n...[本文は長いため途中まで]"


def extract_visible_text(soup: BeautifulSoup) -> str:
    for node in soup(["script", "style", "noscript", "svg", "iframe"]):
        node.decompose()

    candidates = []
    for selector in [
        "article",
        "main",
        "[class*=article]",
        "[class*=entry]",
        "[class*=post]",
        "[class*=content]",
        "[class*=body]",
        "[class*=markdown]",
        "[class*=zenn]",
        "[class*=qiita]",
    ]:
        for element in soup.select(selector):
            text = element.get_text("\n", strip=True)
            if len(text) >= 200:
                candidates.append(text)

    if candidates:
        return max(candidates, key=len)

    return soup.get_text("\n", strip=True)


def fetch_page_context(url: str) -> PageContext:
    print(f"Fetching article context: {url}")

    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "clips/1.0",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            resolved_url = response.geturl()
            content_type = response.headers.get("content-type", "")
            if "text/html" not in content_type:
                return PageContext(resolved_url, url, "", "", f"non-html:{content_type}")

            raw = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as error:
        return PageContext(url, url, "", "", f"failed:{error.code}")
    except Exception as error:
        print(f"Failed to fetch page: {url}")
        print(error)
        return PageContext(url, url, "", "", "error")

    soup = BeautifulSoup(raw, "html.parser")
    title = ""
    description = ""

    for key, value in [
        ("property", "og:title"),
        ("name", "twitter:title"),
        ("name", "headline"),
    ]:
        meta = soup.find("meta", attrs={key: value})
        if meta and meta.get("content"):
            title = meta["content"].strip()
            break

    if not title and soup.title and soup.title.string:
        title = soup.title.string.strip()

    for key, value in [
        ("name", "description"),
        ("property", "og:description"),
        ("name", "twitter:description"),
    ]:
        meta = soup.find("meta", attrs={key: value})
        if meta and meta.get("content"):
            description = meta["content"].strip()
            break

    text = html.unescape(extract_visible_text(soup))
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()

    return PageContext(
        resolved_url=resolved_url,
        title=title or url,
        description=description,
        text=truncate_text(text, ARTICLE_TEXT_LIMIT),
        fetch_status="ok",
    )


def fetch_url(url: str) -> str:
    """Fetch a URL and return title, description, resolved URL, and readable text."""
    page = fetch_page_context(url)
    return json.dumps(asdict(page), ensure_ascii=False)


def web_search(query: str, max_results: int = 5) -> str:
    """Search the web for extra context. Use this only when the fetched page is insufficient."""
    if not OPENAI_WEB_SEARCH:
        return "Web search is disabled by OPENAI_WEB_SEARCH=false."

    payload = {
        "model": OPENAI_MODEL,
        "input": (
            "Search the web and return concise Japanese research notes with URLs. "
            f"Limit results to {max_results} sources.\n\nQuery: {query}"
        ),
        "tools": [{"type": "web_search"}],
        "tool_choice": "auto",
    }
    request = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {OPENAI_API_KEY}",
            "Content-Type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        return f"Web search failed: {error.code} {body}"

    if isinstance(data.get("output_text"), str):
        return data["output_text"].strip()

    chunks = []
    for item in data.get("output", []):
        for content in item.get("content", []):
            text = content.get("text") or content.get("output_text")
            if text:
                chunks.append(text)
    return "\n".join(chunks).strip()


def get_agent_text(result: dict) -> str:
    messages = result.get("messages", []) if isinstance(result, dict) else []
    if not messages:
        return str(result).strip()

    for message in reversed(messages):
        content = getattr(message, "content", None)
        if content is None and isinstance(message, dict):
            content = message.get("content")
        if isinstance(content, str) and content.strip():
            return content.strip()
        if isinstance(content, list):
            text = "\n".join(
                part.get("text", "") for part in content if isinstance(part, dict)
            ).strip()
            if text:
                return text

    return ""


def strip_markdown_fence(value: str) -> str:
    value = value.strip()
    match = re.match(r"^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$", value)
    return match.group(1).strip() if match else value


def extract_article_topics(body: str, max_items: int = 6) -> list[str]:
    topics = []
    for line in body.splitlines():
        match = re.match(r"^#{2,3}\s+(.+?)\s*$", line)
        if not match:
            continue
        title = match.group(1).strip()
        if title in {"今週の所感", "参照したクリップ"}:
            continue
        topics.append(title)
        if len(topics) >= max_items:
            break
    return topics


def load_clips() -> list[Clip]:
    issues = github(
        f"/repos/{OWNER_REPO}/issues?state=open&labels={urllib.parse.quote(SOURCE_LABEL)}&per_page=100"
    )
    print(f'Fetched issues with label "{SOURCE_LABEL}": {len(issues)}')

    clips = []
    for issue in issues:
        if issue.get("pull_request"):
            print(f"#{issue['number']} skipped because it is a pull request")
            continue

        labels = ", ".join(label["name"] for label in issue.get("labels", []))
        print("----------------------------------------")
        print(f"#{issue['number']}: {issue['title']}")
        print(f"labels: {labels}")
        print(f"body preview:\n{(issue.get('body') or '')[:800]}")

        parsed = parse_issue(issue)
        if not parsed["url"] or not parsed["comment"]:
            print(f"#{issue['number']} skipped")
            print(f"url found: {'yes' if parsed['url'] else 'no'}")
            print(f"comment found: {'yes' if parsed['comment'] else 'no'}")
            continue

        page = fetch_page_context(parsed["url"])
        print(f"Fetched page title: {page.title}")
        print(f"Description length: {len(page.description)}")
        print(f"Article text length: {len(page.text)}")
        print(f"Fetch status: {page.fetch_status}")

        clips.append(
            Clip(
                number=issue["number"],
                issue_url=issue["html_url"],
                url=parsed["url"],
                comment=parsed["comment"],
                created_at=parsed["created_at"],
                source=parsed["source"],
                tags=parsed["tags"],
                importance=parsed["importance"],
                source_url=page.resolved_url,
                source_title=page.title,
                source_description=page.description,
                source_excerpt=page.text,
                fetch_status=page.fetch_status,
            )
        )

    print("----------------------------------------")
    print(f"Valid clips: {len(clips)}")
    return clips


def limit_total_article_text(clips: list[dict]) -> list[dict]:
    remaining = TOTAL_ARTICLE_TEXT_LIMIT
    limited = []
    for clip in clips:
        clip = dict(clip)
        excerpt = clip.get("source_excerpt", "")
        if remaining > 0:
            excerpt = truncate_text(excerpt, min(ARTICLE_TEXT_LIMIT, remaining))
        else:
            excerpt = ""
        remaining -= len(excerpt)
        clip["source_excerpt"] = excerpt
        limited.append(clip)
    return limited


def build_article_body(clips: list[Clip]) -> str:
    clip_payload = limit_total_article_text([asdict(clip) for clip in clips])
    model = deepagents_model_id()

    article_reader = {
        "name": "article-reader",
        "description": (
            "Reads one clipped technical article deeply, verifies the page content, "
            "and returns concise Japanese research notes with source URLs."
        ),
        "system_prompt": textwrap.dedent(
            """
            You are an article-reading subagent for a Japanese personal tech blog.

            For the single clip you receive:
            - Use fetch_url(url) first, even if an excerpt is already provided.
            - Use web_search only when the fetched page is missing, too short, or unclear.
            - Focus on what the linked article actually says.
            - Do not over-summarize the original article; explain only enough context for the blog author's comment.
            - Do not invent facts that are not in the article or search results.
            - Avoid long quotations.
            - Extract details that help the editor write in the author's style: background, concrete implementation choices, trade-offs, operational concerns, and what might be worth trying next.

            Return concise Japanese research notes. This is internal material only.
            Do not use "Clip #<number>" as a heading. Do not expose fetch status
            unless there is a problem that affects confidence.

            Output format:
            - 元記事: [title](url)
            - 記事の要点: 3 bullets max
            - 実装・運用で気になりそうな点: 3 bullets max
            - コメントとの接続: 2 bullets max
            - 書くときの注意: 1-2 bullets
            """
        ).strip(),
        "tools": [fetch_url, web_search],
        "model": model,
    }

    agent = create_deep_agent(
        model=model,
        subagents=[article_reader],
        system_prompt=textwrap.dedent(
            """
            You are the editor of ochisamu.info, a Japanese personal technical memo site.

            {style_guide}

            Required workflow:
            1. For every clip in the input, call the article-reader subagent exactly once.
            2. Use the returned reader notes as the primary material.
            3. Then write one weekly roundup article in Japanese Markdown.

            Editorial policy:
            - The author's comment is the center of each section.
            - The source article context supports the comment; it is not a generic summary article.
            - Clearly link to the original URL.
            - Write as a personal technical memo: why it caught attention, what implementation or operation point mattered, and what could be tried later.
            - Prefer concrete observations over broad statements about industry trends.
            - Mention uncertainty if a page could not be fetched or only partial context was available.
            - Do not claim anything that was not in reader notes, fetched content, or search results.
            - Do not output frontmatter.
            - Do not wrap the result in a Markdown code fence.

            Article shape:
            - Short opening paragraph.
            - One section per clip.
            - Section headings must be natural topic titles, not "Clip 23", "Clip #23", issue numbers, or internal labels.
            - Each clip section uses: 元記事 / ひとこと / 読んで考えたこと.
            - In 「読んで考えたこと」, include the concrete implementation or operation angle when possible.
            - Close with "今週の所感", written as a short practical note about what the author may want to try or watch next.
            """
        )
        .format(style_guide=AUTHOR_STYLE_GUIDE)
        .strip(),
    )

    prompt = textwrap.dedent(
        f"""
        以下の tech-clip Issue から週次まとめ記事を作ってください。
        必ず各 clip について article-reader subagent を呼び、読解メモを得てから統合してください。

        clips:
        {json.dumps(clip_payload, ensure_ascii=False, indent=2)}
        """
    ).strip()

    result = agent.invoke({"messages": [{"role": "user", "content": prompt}]})
    body = strip_markdown_fence(get_agent_text(result))
    if not body:
        raise RuntimeError("No text returned from DeepAgents")
    return body


def escape_markdown_link_text(value: str) -> str:
    return value.replace("\\", "\\\\").replace("[", "\\[").replace("]", "\\]")


def build_cover_image_prompt(clips: list[Clip], body: str, date: str) -> str:
    topics = extract_article_topics(body)
    source_titles = [clip.source_title for clip in clips if clip.source_title][:6]
    comments = [clip.comment for clip in clips if clip.comment][:4]

    return textwrap.dedent(
        f"""
        Create a landscape editorial cover illustration for a Japanese personal
        technical blog weekly roundup.

        Article date: {date}
        Main topics:
        {json.dumps(topics or source_titles, ensure_ascii=False, indent=2)}

        Author notes:
        {json.dumps(comments, ensure_ascii=False, indent=2)}

        Visual direction:
        - Japanese technical notebook / field note cover.
        - Abstract diagram about saved web articles becoming a reviewed blog post.
        - Use clean Japanese typography as part of the cover design.
        - Include visual motifs such as clipped notes, GitHub issue cards, workflow
          arrows, small terminal panels, browser/article sheets, and AI-assisted
          editing as abstract shapes.
        - Use the site's palette: warm paper, black ink, teal, rust orange, and a
          small yellow accent.
        - Clean editorial composition, subtle grid paper texture, crisp vector-like
          shapes, production-quality blog cover.

        Text to include:
        - Include readable Japanese text intentionally.
        - Use the exact main title: 「今週読んだ技術記事メモ」
        - Include the date: 「{date}」
        - Optionally include 2-4 short Japanese topic labels derived from the main
          topics, only if they fit naturally in the composition.
        - Keep text minimal and legible; do not add filler pseudo text.

        Hard constraints:
        - No English words, no logos, and no brand marks.
        - Do not reproduce screenshots, product UIs, website layouts, or brand marks.
        - Do not include people, faces, mascots, or photorealistic devices.
        - The result should work as an article image, not an advertisement.
        """
    ).strip()


def generate_cover_image(clips: list[Clip], body: str, out_dir: Path, date: str) -> str:
    prompt = build_cover_image_prompt(clips, body, date)
    print("Generating cover image")
    print(f"Image model: {OPENAI_IMAGE_MODEL}")
    print(f"Image size: {OPENAI_IMAGE_SIZE}")
    print(f"Image quality: {OPENAI_IMAGE_QUALITY}")

    client = OpenAI(api_key=OPENAI_API_KEY)
    try:
        result = client.images.generate(
            model=OPENAI_IMAGE_MODEL,
            prompt=prompt,
            size=OPENAI_IMAGE_SIZE,
            quality=OPENAI_IMAGE_QUALITY,
            n=1,
            timeout=180,
        )
    except APIStatusError as error:
        body = getattr(error.response, "text", "") or str(error)
        raise RuntimeError(
            f"OpenAI image generation failed: {error.status_code} {body}"
        ) from error
    except OpenAIError as error:
        raise RuntimeError(
            f"OpenAI image generation failed: {error}"
        ) from error

    image_b64 = result.data[0].b64_json if result.data else None
    if not image_b64:
        raise RuntimeError("Image generation response did not include b64_json")

    cover_path = out_dir / "cover.png"
    cover_path.write_bytes(base64.b64decode(image_b64))
    print(f"Generated {cover_path}")
    return prompt


def output_dir() -> Path:
    year, date = jst_date()
    return Path("src") / "content" / "blog" / year / "tech-clips" / date


def write_outputs(clips: list[Clip], body: str) -> None:
    _, date = jst_date()
    out_dir = output_dir()
    out_dir.mkdir(parents=True, exist_ok=True)
    cover_result = CoverImageResult(
        enabled=GENERATE_COVER_IMAGE,
        path=None,
        model=OPENAI_IMAGE_MODEL if GENERATE_COVER_IMAGE else None,
        size=OPENAI_IMAGE_SIZE if GENERATE_COVER_IMAGE else None,
        quality=OPENAI_IMAGE_QUALITY if GENERATE_COVER_IMAGE else None,
        prompt=None,
        error=None,
    )
    cover_markdown = ""

    if GENERATE_COVER_IMAGE:
        try:
            cover_prompt = generate_cover_image(clips, body, out_dir, date)
            cover_result = CoverImageResult(
                enabled=True,
                path="cover.png",
                model=OPENAI_IMAGE_MODEL,
                size=OPENAI_IMAGE_SIZE,
                quality=OPENAI_IMAGE_QUALITY,
                prompt=cover_prompt,
                error=None,
            )
            cover_markdown = (
                f'![今週読んだ技術記事メモ {date} のカバー画像](./cover.png)\n\n'
            )
        except Exception as error:
            print("Cover image generation failed; continuing without cover image")
            print(error)
            cover_result.error = str(error)

    references = "\n".join(
        (
            f"- [{escape_markdown_link_text(clip.source_title or clip.url)}]"
            f"({clip.source_url})"
        )
        for clip in clips
    )

    markdown = (
        f'---\n'
        f'title: "今週読んだ技術記事メモ {date}"\n'
        f'date: "{date}"\n'
        f'description: "スマホから保存した技術記事クリップの週次まとめ。"\n'
        f'tags: ["Tech Clips", "AI", "開発メモ"]\n'
        f'---\n\n'
        f'```toc\n'
        f'```\n\n'
        f'{cover_markdown}'
        f'{body.strip()}\n\n'
        f'---\n\n'
        f'## 参照したクリップ\n\n'
        f'{references}\n'
    )

    (out_dir / "index.md").write_text(markdown, encoding="utf-8")
    (out_dir / "clips.json").write_text(
        json.dumps(
            {
                "generatedAt": datetime.now(ZoneInfo("Asia/Tokyo")).isoformat(),
                "generator": "deepagents",
                "coverImage": asdict(cover_result),
                "issues": [
                    {
                        "number": clip.number,
                        "issueUrl": clip.issue_url,
                        "sourceUrl": clip.source_url,
                        "fetchStatus": clip.fetch_status,
                    }
                    for clip in clips
                ],
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    print(f"Generated {out_dir / 'index.md'}")
    print(f"Generated {out_dir / 'clips.json'}")


def main() -> int:
    clips = load_clips()
    if not clips:
        print("No tech clips found.")
        return 0

    body = build_article_body(clips)
    write_outputs(clips, body)
    return 0


if __name__ == "__main__":
    sys.exit(main())
