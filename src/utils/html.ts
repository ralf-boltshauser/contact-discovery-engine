import { JSDOM } from "jsdom";

export function stripHtmlForLLM(html: string): string {
  const dom = new JSDOM(html);
  const document = dom.window.document;

  // Remove unnecessary elements
  const elementsToRemove = [
    "script",
    "style",
    "meta",
    "link",
    "svg",
    "noscript",
    "iframe",
    "object",
    "embed",
    "header",
    "footer",
    "nav",
  ];
  elementsToRemove.forEach((tag) => {
    document.querySelectorAll(tag).forEach((el) => el.remove());
  });

  // Remove attributes from non-anchor elements to reduce token size
  document.querySelectorAll("*").forEach((el) => {
    if (el.tagName.toLowerCase() === "a") {
      // For anchor tags, only keep href attribute
      const href = el.getAttribute("href");
      for (const attr of Array.from(el.attributes)) {
        el.removeAttribute(attr.name);
      }
      if (href) {
        el.setAttribute("href", href);
      }
    } else {
      // For all other elements, remove all attributes
      for (const attr of Array.from(el.attributes)) {
        el.removeAttribute(attr.name);
      }
    }
  });

  // Get HTML content preserving tags
  const htmlContent = document.body?.innerHTML || "";

  // Remove extra whitespace and common noise
  return htmlContent
    .trim()
    .replace(/\s+/g, " ")
    .replace(/<!--[\s\S]*?-->/g, ""); // Remove HTML comments
}
