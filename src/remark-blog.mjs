const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const textFrom = (node) => {
  if (!node) return "";
  if (node.type === "text" || node.type === "inlineCode") return node.value;
  if (!node.children) return "";
  return node.children.map(textFrom).join("");
};

const slugify = (value) =>
  value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\p{Letter}\p{Number}-]+/gu, "")
    .replace(/-+/g, "-");

const visit = (node, callback, parent = null) => {
  callback(node, parent);
  if (node.children) {
    for (const child of node.children) visit(child, callback, node);
  }
};

export function remarkAstroBlog() {
  return (tree) => {
    const headings = [];

    visit(tree, (node) => {
      if (node.type !== "heading" || node.depth > 2) return;
      const text = textFrom(node);
      if (!text || text === "目次") return;
      const id = slugify(text);
      node.data ||= {};
      node.data.hProperties ||= {};
      node.data.hProperties.id = id;
      headings.push({ depth: node.depth, text, id });
    });

    const transformChildren = (node) => {
      if (!node.children) return;

      for (let index = 0; index < node.children.length; index += 1) {
        const child = node.children[index];

        if (
          child.type === "heading" &&
          textFrom(child) === "目次" &&
          node.children[index + 1]?.type === "code" &&
          node.children[index + 1]?.lang === "toc"
        ) {
          node.children.splice(index, 1);
          index -= 1;
          continue;
        }

        if (child.type === "code" && child.lang === "toc") {
          const items = headings
            .map(
              (heading) =>
                `<li class="toc-depth-${heading.depth}"><a href="#${heading.id}">${escapeHtml(
                  heading.text,
                )}</a></li>`,
            )
            .join("");
          node.children[index] = {
            type: "html",
            value: `<nav class="toc" aria-label="目次"><ol>${items}</ol></nav>`,
          };
          continue;
        }

        if (child.type === "code" && child.lang === "mermaid") {
          node.children[index] = {
            type: "html",
            value: `<pre class="mermaid">${escapeHtml(child.value)}</pre>`,
          };
          continue;
        }

        if (child.type === "code" && child.lang?.includes(":title=")) {
          const [langAndMeta, title] = child.lang.split(":title=");
          const lang = langAndMeta.split("{")[0];
          child.lang = lang;
          node.children.splice(index, 0, {
            type: "html",
            value: `<div class="code-title">${escapeHtml(title)}</div>`,
          });
          index += 1;
        }

        transformChildren(child);
      }
    };

    transformChildren(tree);
  };
}
