/**
 * ⚠️ DO NOT DELETE THIS COMMENT ⚠️
 * (AI and users should not remove these configuration instructions)
 *
 * KV Configuration Example (site:apod):
 * {
 *   "url": "https://apod.nasa.gov/apod/archivepix.html",
 *   "rss_name": "NASA Astronomy Picture of the Day",
 *   "parser": "apod",
 *   "max_items": 5,
 *   "img_rewrite": "https://proxy.duckduckgo.com/iu/?u=${href_ue}"
 * }
 *
 * Configuration Guidelines:
 * - REQUIRED: url, parser
 * - OPTIONAL: max_items, rss_name, img_rewrite
 *
 * Customization Rules:
 * - DO NOT CHANGE CASUALLY: "url" and "parser" (these are strictly tied to this parser's current logic)
 * - USER DEFINABLE: "max_items", "rss_name", "img_rewrite"
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

export const apodParser: SiteParser = {
  parseList(html: string, baseUrl: string, config?: any): ListParseResult {
    const $ = cheerio.load(html);
    const items: ListParseResult["items"] = [];

    $("body > b > a").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;

      items.push({
        url: new URL(href, baseUrl).toString(),
        title: $(el).text().trim() || undefined,
      });
    });

    return { items };
  },

  async parseDetail(
    html: string,
    item: ListItem,
    config?: any
  ): Promise<DetailParseResult> {
    // Some APOD pages (e.g. ap260312.html) are saved as UTF-16LE, but the server
    // sends Content-Type: text/html; charset=UTF-8. This causes the initial fetch's
    // .text() to return garbled strings with null bytes. We detect this and refetch.
    if (!html.includes("<center>") || html.includes("\u0000")) {
      try {
        const res = await fetch(item.url, {
          headers: {
            "User-Agent": config?.userAgent || "Mozilla/5.0",
          },
        });
        const buffer = await res.arrayBuffer();
        const decoder = new TextDecoder("utf-16le");
        html = decoder.decode(buffer);
      } catch (e) {
        // Fallback to original html if refetching fails
      }
    }

    const content = cheerio.load(html);

    let description = "";

    // Extract Image
    const mediaP = content("body > center").first().find("p").last();

    mediaP.find("img, iframe, a").each((_, el) => {
      const src = content(el).attr("src");
      if (src) {
        content(el).attr("src", new URL(src, item.url).toString());
      }
      const href = content(el).attr("href");
      if (href) {
        content(el).attr("href", new URL(href, item.url).toString());
      }
    });

    const mediaHtml = mediaP.html();
    if (mediaHtml) {
      description += `${mediaHtml} <br>`;
    }

    // Extract center content and first paragraph
    const centerHtml = content("body > center").eq(1).html();
    if (centerHtml) description += `${centerHtml} <br>`;

    const pHtml = content("body > p").eq(0).html();
    if (pHtml) description += `${pHtml}`;

    // Attempt to extract title
    const title =
      item.title ||
      content("title").text().trim() ||
      content("body > center")
        .first()
        .text()
        .trim()
        .split("\n")
        .pop()
        ?.trim() ||
      "NASA APOD";

    // Extract and format date (e.g., from ap240325.html -> 240325 -> 2024-03-25T00:00:00Z)
    const match = item.url.match(/ap(\d{6})\.html$/);
    let pub_date: string | undefined = item.pub_date;
    if (match) {
      pub_date = dayjs.utc(match[1], "YYMMDD").toISOString();
    }

    return { title, content: description, pub_date };
  },
};
