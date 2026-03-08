/**
 * Default Parser - Universal RSS/Blog site parsing rules
 *
 * Uses cheerio to extract article list and detail content.
 * Suitable for most standard blog sites.
 */
import * as cheerio from "cheerio";
import type {
  SiteParser,
  ListParseResult,
  DetailParseResult,
  ListItem,
} from "../../config";

export const defaultParser: SiteParser = {
  /**
   * Parse list page - extrace article link list
   * Default strategy: find <a> tags inside <article> or common article containers
   */
  parseList(html: string, baseUrl: string, config?: any): ListParseResult {
    const $ = cheerio.load(html);
    const items: ListParseResult["items"] = [];
    const seen = new Set<string>();

    // Strategy 1: Find links inside <article> tags
    $("article a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;

      const absoluteUrl = new URL(href, baseUrl).toString();
      if (seen.has(absoluteUrl)) return;
      seen.add(absoluteUrl);

      items.push({
        url: absoluteUrl,
        title: $(el).text().trim() || undefined,
      });
    });

    // Strategy 2: If no links found in <article>, try common classes like .post, .entry, etc.
    if (items.length === 0) {
      $(
        ".post a[href], .entry a[href], .post-title a[href], h2 a[href], h3 a[href]"
      ).each((_, el) => {
        const href = $(el).attr("href");
        if (!href) return;

        const absoluteUrl = new URL(href, baseUrl).toString();
        if (seen.has(absoluteUrl)) return;
        seen.add(absoluteUrl);

        items.push({
          url: absoluteUrl,
          title: $(el).text().trim() || undefined,
        });
      });
    }

    return { items };
  },

  /**
   * Parse detail page - extract title, body content
   * Default strategy: find HTML content in <article> or .post-content
   */
  parseDetail(html: string, item: ListItem, config?: any): DetailParseResult {
    const $ = cheerio.load(html);

    // Extract title
    const title =
      item.title ||
      $("article h1").first().text().trim() ||
      $("h1.post-title, h1.entry-title").first().text().trim() ||
      $("h1").first().text().trim() ||
      $("title").text().trim();

    // Extract body content
    const contentEl =
      $("article .post-content, article .entry-content").first() ||
      $(".post-content, .entry-content, .article-content").first() ||
      $("article").first();

    // Cleanup: remove scripts, styles, navigation and other irrelevant elements
    contentEl
      .find("script, style, nav, .comments, .sidebar, .social-share")
      .remove();

    const content = contentEl.html()?.trim() || "";

    // Extract publish date
    const pub_date =
      item.pub_date ||
      $("time[datetime]").first().attr("datetime") ||
      $('meta[property="article:published_time"]').attr("content") ||
      undefined;

    return { title, content, pub_date, author: item.author };
  },
};
