import rss from "@astrojs/rss"
import { getCollection } from "astro:content"
import { site } from "../site"
import { byDateDesc, postHref } from "../utils"

export async function GET(context) {
  const posts = (await getCollection("blog")).sort(byDateDesc)

  return rss({
    title: site.title,
    description: site.description,
    site: context.site,
    items: posts.map(post => ({
      title: post.data.title,
      description: post.data.description ?? "",
      pubDate: post.data.date,
      link: postHref(post),
    })),
  })
}
