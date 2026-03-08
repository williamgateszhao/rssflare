/**
 * Image URL Rewrite Tool
 *
 * Replaces the src of all <img> in an article with a proxy URL according to a template, used to bypass hotlink protection.
 * The template uses JS variable syntax ${property}, supporting all standard attributes of URL,
 * appending _ue will URL-encode the attribute value.
 *
 * Example templates:
 *   ${protocol}//${host}${pathname}
 *   https://i3.wp.com/${host}${pathname}
 *   https://images.weserv.nl?url=${href_ue}
 */
import * as cheerio from "cheerio";

/** List of URL property names */
const URL_PROPS = [
  "protocol",
  "host",
  "hostname",
  "port",
  "pathname",
  "search",
  "hash",
  "href",
  "origin",
] as const;

/**
 * Rewrite a single image URL based on a template
 * @param originalSrc Original image src
 * @param template Rewrite template, e.g. "https://images.weserv.nl?url=${href_ue}"
 * @returns Rewritten URL
 */
export function rewriteImageUrl(originalSrc: string, template: string): string {
  try {
    const url = new URL(originalSrc);

    // Build variable map: original value + _ue encoded version
    const vars: Record<string, string> = {};
    for (const prop of URL_PROPS) {
      // @ts-ignore
      vars[prop] = url[prop];
      // @ts-ignore
      vars[`${prop}_ue`] = encodeURIComponent(url[prop]);
    }

    // Replace ${...} variables in the template
    return template.replace(/\$\{(\w+)\}/g, (match, key) => {
      return key in vars ? vars[key] : match;
    });
  } catch {
    // Return original if originalSrc is not a valid URL (e.g. relative path)
    return originalSrc;
  }
}

/**
 * Rewrite the src of all <img> tags in HTML content
 * @param html Original HTML content
 * @param template Rewrite template
 * @returns Replaced HTML
 */
export function rewriteImagesInHtml(html: string, template: string): string {
  const $ = cheerio.load(html, { xmlMode: false });

  $("img[src]").each((_, el) => {
    const src = $(el).attr("src");
    if (src) {
      $(el).attr("src", rewriteImageUrl(src, template));
    }
  });

  return $("body").html() || html;
}
