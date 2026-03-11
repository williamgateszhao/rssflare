/**
 * ⚠️ DO NOT DELETE THIS COMMENT ⚠️
 * (AI and users should not remove these configuration instructions)
 *
 * KV Configuration Example (site:yahoo-tech):
 * {
 *   "url": "https://tw.news.yahoo.com/yahoo_tech_tw_942--所有類別/archive",
 *   "parser": "yahooNewsByProvider",
 *   "max_items": 20,
 *   "img_rewrite": "https://proxy.duckduckgo.com/iu/?u=${href_ue}"
 * }
 *
 * Configuration Guidelines:
 * - REQUIRED: url, parser
 * - OPTIONAL: max_items, img_rewrite
 *
 * Customization Rules:
 * - DO NOT CHANGE CASUALLY: "parser" (must strictly be "yahooNewsByProvider")
 * - USER DEFINABLE: "url", "max_items", "img_rewrite"
 *
 * Specific Notes for yahooNewsByProvider:
 * - url: The domain must be either `tw.news.yahoo.com` or `hk.news.yahoo.com`.
 *        The segment `yahoo_tech_tw_942` corresponds to the provider's name (source).
 *        You can get the full URL directly by navigating to the news source on the Yahoo News website and copying the link.
 */
import * as cheerio from "cheerio";
import dayjs from "dayjs";
import type {
  SiteParser,
  ListParseResult,
  DetailParseResult,
  ListItem,
} from "../../config";

export const yahooNewsByProviderParser: SiteParser = {
  rewriteListUrl(baseUrl: string, config?: any): string {
    const limit = config?.max_items || 10;

    const hostname = new URL(baseUrl).hostname;

    let providerId: string | undefined;

    // e.g. https://tw.news.yahoo.com/yahoo_tech_tw_942--所有類別/archive
    // Extract everything before '--' in the URL path segment
    const match = baseUrl.match(/\/([^\/]+)--/);
    if (match && match[1]) {
      providerId = match[1];
    }

    if (!providerId) {
      throw new Error(
        "yahoo-news parser requires 'providerId' to be present inside the URL"
      );
    }

    return `https://${hostname}/_td-news/api/resource/NCPListService;api=archive;ncpParams=${encodeURIComponent(
      JSON.stringify({
        query: { count: limit, start: 0, providerid: providerId, tag: null },
      })
    )}`;
  },

  async parseList(
    html: string,
    baseUrl: string,
    config?: any
  ): Promise<ListParseResult> {
    let data: any;
    try {
      data = JSON.parse(html);
    } catch (e) {
      throw new Error(
        `Failed to parse Yahoo API response as JSON: ${(e as Error).message}`
      );
    }

    const hostname = new URL(baseUrl).hostname;

    // Default structure: data may be an array immediately depending on response
    // If there's an error it might be under data.items or similar, but old script assumes response is an array
    const items: ListItem[] = (data || []).map((item: any) => {
      let url = item.url;
      if (!url && item.link) {
        url = item.link;
      }
      if (url && !url.startsWith("http")) {
        url = new URL(url, `https://${hostname}`).toString();
      }
      return {
        title: item.title,
        url: url,
        // Using item.summary as description, though our config type uses it differently, we can just pass it if needed,
        // but let's stick to the ListItem interface which expects title, url, pub_date.
        pub_date: item.published_at
          ? dayjs(item.published_at * 1000).toISOString()
          : undefined,
      };
    });

    return { items };
  },

  async parseDetail(
    html: string,
    item: ListItem,
    config?: any
  ): Promise<DetailParseResult> {
    const $ = cheerio.load(html);

    let ldJson: any = {};
    let ldAuthor: string | undefined;

    // Target the first JSON-LD script inside the article tag
    const ldText = $('article script[type="application/ld+json"]')
      .first()
      .text();
    if (ldText) {
      try {
        const parsed = JSON.parse(ldText);
        if (
          parsed["@type"] === "NewsArticle" ||
          parsed["@type"] === "Article"
        ) {
          ldJson = parsed;
          if (parsed.author) {
            if (Array.isArray(parsed.author)) {
              ldAuthor = parsed.author.map((a: any) => a.name || a).join(", ");
            } else if (typeof parsed.author === "object") {
              ldAuthor = parsed.author.name;
            } else if (typeof parsed.author === "string") {
              ldAuthor = parsed.author;
            }
          }
        }
      } catch (e) {
        // ignore JSON parse errors
      }
    }

    let content = "";
    $(".atoms").each((_, ele) => {
      content += $(ele).html() || "";
    });

    return {
      title: item.title || ldJson.headline || $("title").text(),
      content: content,
      author: ldAuthor || item.author,
      pub_date: ldJson.datePublished
        ? dayjs(ldJson.datePublished).toISOString()
        : item.pub_date,
    };
  },
};
