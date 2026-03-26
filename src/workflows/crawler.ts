import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { Feed } from "feed";
import dayjs from "dayjs";
import {
  type Env,
  type QueueMessage,
  type ListItem,
  type ChildParams,
  getAppConfig,
  getWorkflowConfig,
  getSiteConfig,
} from "../config";
import { getParser } from "../utils/parsers";
import { cleanHtml, truncateContent } from "../utils/html-cleaner";
import { rewriteImagesInHtml } from "../utils/img-rewriter";

// Helper function: array slice
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// === Master Crawler Workflow ===
export class MasterCrawlerWorkflow extends WorkflowEntrypoint<
  Env,
  QueueMessage
> {
  async run(event: WorkflowEvent<QueueMessage>, step: WorkflowStep) {
    const parentId = event.instanceId;
    const siteConfig = getSiteConfig(event.payload, this.env);

    // ========== Step 1: Process list page URLs ==========
    const workflowConfig = getWorkflowConfig(this.env);
    const appConfig = getAppConfig(this.env);

    const targetUrls = await step.do(
      `rewrite-list-urls-${siteConfig.id}`,
      async () => {
        const parser = getParser(siteConfig.parser);
        const sourceUrls = Array.isArray(siteConfig.url)
          ? siteConfig.url
          : [siteConfig.url];
        const mergedConfig = {
          ...siteConfig,
          userAgent: appConfig.USER_AGENT,
        };
        if (parser.rewriteListUrl) {
          const results = [];
          for (const u of sourceUrls) {
            results.push(await parser.rewriteListUrl(u, mergedConfig));
          }
          return results;
        }
        return sourceUrls;
      }
    );

    // ========== Step 2: Fetch list (supports multiple URLs) ==========
    const listResult = await step.do(
      `fetch-list-${siteConfig.id}`,
      workflowConfig.MASTER_CRAWLER.FETCH_LIST,
      async () => {
        const parser = getParser(siteConfig.parser);
        const sourceUrls = Array.isArray(siteConfig.url)
          ? siteConfig.url
          : [siteConfig.url];
        const allItems: ListItem[] = [];

        for (let i = 0; i < sourceUrls.length; i++) {
          const originalUrl = sourceUrls[i];
          const targetUrl = targetUrls[i];

          const res = await fetch(targetUrl, {
            headers: {
              "User-Agent": appConfig.USER_AGENT,
              Accept: "text/html, application/json, */*",
            },
          });
          if (!res.ok)
            throw new Error(
              `Failed to fetch list: ${res.status} for ${targetUrl}`
            );
          const html = await res.text();
          const mergedConfig = {
            ...siteConfig,
            userAgent: appConfig.USER_AGENT,
          };
          const { items } = await parser.parseList(
            html,
            originalUrl,
            mergedConfig
          );
          allItems.push(...items);
        }

        // Deduplicate
        const seen = new Set<string>();
        const uniqueItems = allItems.filter((item) => {
          if (seen.has(item.url)) return false;
          seen.add(item.url);
          return true;
        });
        const finalAllItems = uniqueItems.slice(0, siteConfig.max_items);
        const allUrls = finalAllItems.map((item) => item.url);

        if (finalAllItems.length === 0) {
          return { newItems: [], allItems: [], primaryUrl: sourceUrls[0] };
        }

        // Incremental comparison with D1: Find already fetched URLs
        const placeholders = allUrls.map(() => "?").join(",");
        const existing = await this.env.D1.prepare(
          `SELECT url FROM articles WHERE feed_id = ? AND url IN (${placeholders})`
        )
          .bind(siteConfig.id, ...allUrls)
          .all<{ url: string }>();

        const existingSet = new Set(existing.results.map((r) => r.url));
        const newItems = finalAllItems.filter(
          (item) => !existingSet.has(item.url)
        );

        return { newItems, allItems: finalAllItems, primaryUrl: sourceUrls[0] };
      }
    );

    // ========== Step 3: Dispatch child tasks ==========
    const batches = chunkArray(
      listResult.newItems,
      workflowConfig.MASTER_CRAWLER.BATCH_SIZE
    );
    const totalBatches = batches.length;

    if (totalBatches > 0) {
      await step.do("dispatch-tasks", async () => {
        const instances = batches.map((batch, i) => ({
          id: `${parentId}-batch-${i}`,
          params: {
            feedId: siteConfig.id,
            batch,
            parentId,
            batchIndex: i,
            siteConfig,
          } satisfies ChildParams,
        }));

        await this.env.CHILD_WORKFLOW.createBatch(instances);
      });

      // ========== Step 4: Wait for child tasks to complete ==========
      for (let i = 0; i < totalBatches; i++) {
        await step.waitForEvent(`wait-child-${i}`, {
          timeout: workflowConfig.MASTER_CRAWLER.WAIT_CHILD
            .timeout as WorkflowSleepDuration,
          type: `child_completed_${i}`,
        });
      }
    }

    // ========== Step 5: Generate XML & Upload to R2 ==========
    await step.do(
      `save-feed-${siteConfig.id}`,
      workflowConfig.MASTER_CRAWLER.SAVE_FEED,
      async () => {
        if (listResult.allItems.length === 0) return true;

        const allUrls = listResult.allItems.map((item) => item.url);

        // Read fragments from D1. Some detail pages might be missing due to child Workflow fetching errors, fallback gracefully
        const placeholders = allUrls.map(() => "?").join(",");
        const articles = await this.env.D1.prepare(
          `SELECT * FROM articles WHERE feed_id = ? AND url IN (${placeholders})`
        )
          .bind(siteConfig.id, ...allUrls)
          .all<{
            feed_id: string;
            url: string;
            title: string | null;
            author: string | null;
            content: string | null;
            pub_date: string | null;
            link: string | null;
            fetched_at: string;
          }>();

        const articleMap = new Map(articles.results.map((a) => [a.url, a]));
        const articlesList = allUrls
          .map((u, index) => ({ article: articleMap.get(u), index }))
          .filter((item) => item.article !== undefined) as {
          article: (typeof articles.results)[0];
          index: number;
        }[];

        if (!siteConfig.sort_by_list_order) {
          articlesList.sort((a, b) => {
            const getSortDate = (article: (typeof articles.results)[0]) => {
              const d = article.pub_date
                ? dayjs(article.pub_date).valueOf()
                : dayjs(article.fetched_at).valueOf();
              return Number.isNaN(d) ? dayjs(article.fetched_at).valueOf() : d;
            };

            const dateA = getSortDate(a.article);
            const dateB = getSortDate(b.article);

            // Ignore differences smaller than 1 minute (60000ms).
            // This ensures that items falling back to fetched_at in the same batch
            // (where timestamps vary by milliseconds) preserve their original list order.
            if (Math.abs(dateB - dateA) > 60000) {
              return dateB - dateA; // latest first
            }
            return a.index - b.index; // fallback to original list order
          });
        }

        const orderedArticles = articlesList.map(
          (item) => item.article
        ) as typeof articles.results;

        const feed = new Feed({
          title: siteConfig.rss_name || `${siteConfig.id}`,
          description:
            siteConfig.rss_name || `${siteConfig.id} - Powered by RSSFlare`,
          id: listResult.primaryUrl,
          link: listResult.primaryUrl,
          copyright: "",
          updated: dayjs().toDate(),
          generator: "RSSFlare",
        });

        for (const article of orderedArticles) {
          let content = article.content || "";
          if (siteConfig.img_rewrite && content) {
            content = rewriteImagesInHtml(content, siteConfig.img_rewrite);
          }

          let parsedAuthors: string[] = [];
          if (article.author) {
            try {
              const parsed = JSON.parse(article.author);
              if (Array.isArray(parsed)) {
                parsedAuthors = parsed;
              } else {
                parsedAuthors = [article.author];
              }
            } catch {
              parsedAuthors = [article.author];
            }
          }

          const displayUrl = article.link || article.url;

          feed.addItem({
            title: article.title || "Untitled",
            id: displayUrl,
            link: displayUrl,
            description: content,
            content: content,
            author:
              parsedAuthors.length > 0
                ? [
                    {
                      name: "AUTHOR_HINT:" + parsedAuthors.join("|"),
                      email: "dummy@rssflare.local",
                    },
                  ]
                : undefined,
            date: article.pub_date
              ? dayjs(article.pub_date).toDate()
              : dayjs(article.fetched_at).toDate(),
          });
        }

        let xml = feed.rss2();

        // Feed library requires an email for RSS2 author tags.
        // And it doesn't support outputting <dc:creator> natively out of the box.
        // We inject a special AUTHOR_HINT with dummy email, and replace it so we output correct dc:creator tags
        // This fully handles single or multiple authors seamlessly, while retaining the <author> tag if desired.
        xml = xml.replace(
          /<author>dummy@rssflare\.local \(AUTHOR_HINT:(.*?)\)<\/author>/g,
          (match, authorsStr) => {
            const authors = authorsStr.split("|");
            const authorTag = `<author>${authors.join(", ")}</author>`;
            const dcCreators = authors
              .map((a: string) => `<dc:creator><![CDATA[${a}]]></dc:creator>`)
              .join("\n            ");
            return `${authorTag}\n            ${dcCreators}`;
          }
        );

        await this.env.R2.put(`feeds/${siteConfig.id}.xml`, xml, {
          httpMetadata: {
            contentType: "application/xml; charset=utf-8",
          },
        });

        return true;
      }
    );

    return { success: true, processedBatches: totalBatches };
  }
}

// === Detail Crawler Workflow ===
export class DetailCrawlerWorkflow extends WorkflowEntrypoint<
  Env,
  ChildParams
> {
  async run(event: WorkflowEvent<ChildParams>, step: WorkflowStep) {
    const { feedId, batch, parentId, batchIndex, siteConfig } = event.payload;

    const workflowConfig = getWorkflowConfig(this.env);
    const appConfig = getAppConfig(this.env);

    for (let i = 0; i < batch.length; i++) {
      const articleItem = batch[i];
      const articleUrl = articleItem.url;

      if (i > 0) {
        await step.sleep(
          `polite-delay-${batchIndex}-${i}`,
          workflowConfig.DETAIL_CRAWLER.POLITE_DELAY
        );
      }

      try {
        await step.do(
          `process-item-${batchIndex}-${i}`,
          workflowConfig.DETAIL_CRAWLER.PROCESS_ITEM,
          async () => {
            const parser = getParser(siteConfig.parser);
            const res = await fetch(articleUrl, {
              headers: {
                "User-Agent": appConfig.USER_AGENT,
                Accept: "text/html",
              },
            });
            if (!res.ok)
              throw new Error(
                `Failed to fetch detail: ${res.status} for ${articleUrl}`
              );
            const html = await res.text();

            const mergedConfig = {
              ...siteConfig,
              userAgent: appConfig.USER_AGENT,
            };
            const detail = await parser.parseDetail(
              html,
              articleItem,
              mergedConfig
            );

            const mergedTitle = detail.title || articleItem.title;
            const mergedAuthorRaw = detail.author || articleItem.author;
            const mergedPubDate = detail.pub_date || articleItem.pub_date;
            // detail.url is the canonical/display URL (e.g. https://sspai.com/post/12345)
            // articleUrl is the original fetch URL (e.g. API endpoint) used as the D1 key
            const canonicalLink =
              detail.url && detail.url !== articleUrl ? detail.url : null;

            let mergedAuthor: string | null = null;
            if (mergedAuthorRaw) {
              mergedAuthor = Array.isArray(mergedAuthorRaw)
                ? JSON.stringify(mergedAuthorRaw)
                : String(mergedAuthorRaw).trim();
            }

            const cleanedContent = truncateContent(
              cleanHtml(detail.content),
              appConfig.MAX_CONTENT_LENGTH
            );

            if (appConfig.DEBUG_SAVE_HTML) {
              await this.env.D1.prepare(
                `INSERT INTO debug_raw_html (feed_id, url, html) VALUES (?, ?, ?)
                   ON CONFLICT (feed_id, url) DO UPDATE SET
                   html = excluded.html, fetched_at = CURRENT_TIMESTAMP`
              )
                .bind(feedId, articleUrl, html)
                .run();
            }

            await this.env.D1.prepare(
              `
                  INSERT INTO articles (feed_id, url, title, author, content, pub_date, link)
                  VALUES (?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT (feed_id, url) DO UPDATE SET
                    title = excluded.title,
                    author = excluded.author,
                    content = excluded.content,
                    pub_date = excluded.pub_date,
                    link = excluded.link,
                    fetched_at = CURRENT_TIMESTAMP
              `
            )
              .bind(
                feedId,
                articleUrl,
                mergedTitle || null,
                mergedAuthor || null,
                cleanedContent,
                mergedPubDate || null,
                canonicalLink
              )
              .run();

            return {
              success: true,
              htmlLength: html.length,
              contentLength: detail.content?.length || 0,
              cleanedContentLength: cleanedContent?.length || 0,
              authorParsed: mergedAuthor,
              canonicalLink,
            };
          }
        );
      } catch (err) {
        // Swallow errors after retries are exhausted, and wrap the logging in a step to comply with no external side-effects rule
        await step.do(`handle-failed-item-${batchIndex}-${i}`, async () => {
          console.error(
            `Skipped item ${i} (${articleUrl}) after retries: ${err}`
          );
          return { status: "failed", url: articleUrl, error: String(err) };
        });
      }
    }

    // ========== Report Completion ==========
    await step.do(
      "notify-parent",
      workflowConfig.DETAIL_CRAWLER.NOTIFY_PARENT,
      async () => {
        const parentInstance = await this.env.MASTER_WORKFLOW.get(parentId);
        await parentInstance.sendEvent({
          type: `child_completed_${batchIndex}`,
          payload: { batchIndex },
        });
      }
    );

    return { success: true, batchIndex };
  }
}
