/**
 * ⚠️ DO NOT DELETE THIS COMMENT ⚠️
 * (AI and users should not remove these configuration instructions)
 *
 * KV Configuration Example (site:iplaysoft):
 * {
 *   "url": "https://feed.iplaysoft.com",
 *   "rss_name": "异次元软件世界",
 *   "parser": "iplaysoft",
 *   "max_items": 10
 * }
 *
 * Configuration Guidelines:
 * - REQUIRED: url, parser
 * - OPTIONAL: max_items, rss_name
 *
 * Customization Rules:
 * - DO NOT CHANGE CASUALLY: "url" and "parser" (these are strictly tied to this parser's current logic)
 * - USER DEFINABLE: "max_items", "rss_name"
 */
import * as cheerio from "cheerio";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import utc from "dayjs/plugin/utc";

dayjs.extend(customParseFormat);
dayjs.extend(utc);

import type {
  SiteParser,
  ListParseResult,
  DetailParseResult,
  ListItem,
} from "../../config";

export const iplaysoftParser: SiteParser = {
  parseList(html: string, baseUrl: string, config?: any): ListParseResult {
    // The feed returns XML. cheerio can parse it.
    const $ = cheerio.load(html, { xmlMode: true });
    const items: ListParseResult["items"] = [];

    $("item").each((_, el) => {
      const link = $(el).find("link").text();
      const title = $(el).find("title").text();
      const pubDate = $(el).find("pubDate").text();
      const author =
        $(el).find("dc\\:creator").text() || $(el).find("author").text();

      if (!link || !pubDate) return;

      try {
        const urlObj = new URL(link, baseUrl);
        // Match the filtering logic from the original rsshub route
        if (urlObj.hostname.match(/.*\.iplaysoft\.com$/)) {
          items.push({
            url: urlObj.toString(),
            title: title || undefined,
            pub_date: pubDate ? dayjs(pubDate).toISOString() : undefined,
            author: author || undefined,
          });
        }
      } catch (e) {
        // Ignore invalid URLs
      }
    });

    // If no items were found, maybe the input is standard HTML instead of XML.
    // Let's also try to parse from the HTML structure if needed.
    if (items.length === 0) {
      const $html = cheerio.load(html);
      $html(".entry-title a").each((_, el) => {
        const href = $html(el).attr("href");
        if (!href) return;
        try {
          const urlObj = new URL(href, baseUrl);
          if (urlObj.hostname.match(/.*\.iplaysoft\.com$/)) {
            items.push({
              url: urlObj.toString(),
              title: $html(el).text().trim() || undefined,
            });
          }
        } catch (e) {
          // Ignore invalid URLs
        }
      });
    }

    return { items };
  },

  parseDetail(html: string, item: ListItem, config?: any): DetailParseResult {
    const $ = cheerio.load(html);

    const $content = $(".entry-content");

    // Remove the tracking/ad element as per rsshub logic
    $content.find('div[style*="overflow:hidden"]').remove();

    const description = $content.html() || "";

    const title = item.title || $("title").text().trim() || "iplaysoft";

    return { title, content: description };
  },
};
