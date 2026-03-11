/**
 * ⚠️ DO NOT DELETE THIS COMMENT ⚠️
 * (AI and users should not remove these configuration instructions)
 *
 * KV Configuration Example (site:sspai):
 * {
 *   "url": "https://sspai.com/index",
 *   "rss_name": "少数派",
 *   "parser": "sspai",
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
 *
 * Notes:
 * - The "url" field is only used to identify the site; the actual data is fetched
 *   from the SSPAI API via rewriteListUrl.
 * - Article detail content is also fetched from the SSPAI API, not the HTML page.
 */
import type {
  SiteParser,
  ListParseResult,
  DetailParseResult,
  ListItem,
} from "../../config";

export const sspaiParser: SiteParser = {
  rewriteListUrl(baseUrl: string, config?: any): string {
    const limit = config?.max_items ?? 10;
    return `https://sspai.com/api/v1/article/index/page/get?limit=${limit}&offset=0&created_at=0`;
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
        `Failed to parse SSPAI list API response as JSON: ${
          (e as Error).message
        }`
      );
    }

    const rawItems: any[] = data?.data ?? [];

    const items: ListItem[] = rawItems.map((item: any) => {
      // Build the detail API URL (mirrors the RSSHub logic)
      const detailApiUrl = item.slug
        ? `https://sspai.com/api/v1/member/article/single/info/get?slug=${encodeURIComponent(
            item.slug
          )}&view=second&support_webp=true`
        : `https://sspai.com/api/v1/article/info/get?id=${item.id}&view=second&support_webp=true`;

      return {
        url: detailApiUrl,
        title: item.title?.trim(),
        author: item.author?.nickname,
        pub_date: item.released_time
          ? new Date(item.released_time * 1000).toISOString()
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
    let data: any;
    try {
      data = JSON.parse(html);
    } catch (e) {
      throw new Error(
        `Failed to parse SSPAI detail API response as JSON: ${
          (e as Error).message
        }`
      );
    }

    const articleData = data?.data ?? {};

    // Build content HTML, mirroring the RSSHub handler logic
    let content = "";

    const banner = articleData.promote_image;
    if (banner) {
      content += `<img src="${banner}" alt="Article Cover Image" style="display: block; margin: 0 auto;"><br>`;
    }

    if (Array.isArray(articleData.body_extends)) {
      content += articleData.body_extends
        .map((section: any) => `<h2>${section.title}</h2>${section.body ?? ""}`)
        .join("");
    }

    content += articleData.body ?? "";

    // Derive post URL from the original article id embedded in the detail API URL
    // The stored item.url is the API URL; we reconstruct the canonical post URL from articleData if available.
    const postId = articleData.id ?? articleData.article_id;
    const canonicalUrl = postId ? `https://sspai.com/post/${postId}` : item.url;

    const author = articleData.author?.nickname || item.author || undefined;

    const pubDate = articleData.released_time
      ? new Date(articleData.released_time * 1000).toISOString()
      : item.pub_date;

    return {
      url: canonicalUrl,
      title: articleData.title?.trim() || item.title || "少数派",
      content,
      author,
      pub_date: pubDate,
    };
  },
};
