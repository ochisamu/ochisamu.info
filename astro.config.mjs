import { defineConfig } from "astro/config"
import sitemap from "@astrojs/sitemap"
import tailwindcss from "@tailwindcss/vite"
import { remarkAstroBlog } from "./src/remark-blog.mjs"

export default defineConfig({
  site: "https://ochisamu.info",
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
  markdown: {
    remarkPlugins: [remarkAstroBlog],
    shikiConfig: {
      theme: "github-dark",
    },
  },
})
