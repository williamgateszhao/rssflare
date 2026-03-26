/**
 * HTML Truncator/Cleaner Utility
 *
 * Used to clean up irrelevant elements in article content, reducing storage size,
 * while ensuring RSS readers can correctly render the content.
 */
import * as cheerio from "cheerio";

/** List of tags to remove */
const REMOVE_TAGS = [
  "script",
  "style",
  "iframe",
  "noscript",
  "svg",
  "canvas",
  "form",
  "input",
  "button",
  "select",
  "textarea",
];

/** Class/id patterns to remove */
const REMOVE_PATTERNS = [
  /comment/i,
  /sidebar/i,
  /social/i,
  /share/i,
  /related/i,
  /recommend/i,
  /footer/i,
  /nav/i,
  /menu/i,
  /advertisement/i,
  /ad-/i,
  /popup/i,
  /modal/i,
];

/**
 * Clean HTML content
 * @param html Original HTML string
 * @returns Cleaned HTML string
 */
export function cleanHtml(html: string): string {
  const $ = cheerio.load(html);

  // 1. Remove dangerous/irrelevant tags
  REMOVE_TAGS.forEach((tag) => $(tag).remove());

  // 2. Remove elements matching the patterns
  $("[class], [id]").each((_, el) => {
    const className = $(el).attr("class") || "";
    const id = $(el).attr("id") || "";
    const combined = `${className} ${id}`;

    if (REMOVE_PATTERNS.some((pattern) => pattern.test(combined))) {
      $(el).remove();
    }
  });

  // 3. Remove empty links and tracking pixels
  $("img[src]").each((_, el) => {
    const src = $(el).attr("src") || "";
    // Remove 1x1 tracking pixels
    if ($(el).attr("width") === "1" || $(el).attr("height") === "1") {
      $(el).remove();
    }
    // Remove data URI images (usually placeholders)
    if (src.startsWith("data:") && src.length < 200) {
      $(el).remove();
    }
  });

  // 4. Remove all inline styles and event attributes
  $("*").each((_, el) => {
    const attribs = $(el).attr() || {};
    Object.keys(attribs).forEach((attr) => {
      if (attr === "style" || attr.startsWith("on")) {
        $(el).removeAttr(attr);
      }
    });
  });

  return $("body").html()?.trim() || "";
}

/**
 * Truncate excessively long content
 * @param content HTML content
 * @param maxLength Maximum number of characters (default 300KB)
 * @returns Truncated content
 */
export function truncateContent(content: string, maxLength = 300000): string {
  if (content.length <= maxLength) return content;
  return content.substring(0, maxLength) + "\n<!-- content truncated -->";
}
