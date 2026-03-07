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

  parseDetail(html: string, item: ListItem, config?: any): DetailParseResult {
    const content = cheerio.load(html);

    let description = "";

    // Extract Image
    const imgSrc = content("img").attr("src");
    if (imgSrc) {
      const absImgSrc = new URL(imgSrc, item.url).toString();
      description += `<img src="${absImgSrc}"> <br>`;
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
