import type { CollectionEntry } from "astro:content"

export type BlogPost = CollectionEntry<"blog">

export const byDateDesc = (a: BlogPost, b: BlogPost) =>
  b.data.date.valueOf() - a.data.date.valueOf()

export const byDateAsc = (a: BlogPost, b: BlogPost) =>
  a.data.date.valueOf() - b.data.date.valueOf()

export const formatDate = (date: Date) =>
  new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)

export const tagSlug = (tag: string) =>
  tag
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\p{Letter}\p{Number}-]+/gu, "")
    .replace(/-+/g, "-")

export const postSlug = (post: BlogPost) =>
  post.id.replace(/\/index\.md$/, "").replace(/\.md$/, "")

export const postHref = (post: BlogPost) => `/${postSlug(post)}/`

export const allTags = (posts: BlogPost[]) =>
  Array.from(new Set(posts.flatMap(post => post.data.tags))).sort((a, b) =>
    a.localeCompare(b, "ja"),
  )
