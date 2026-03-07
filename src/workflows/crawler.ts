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
} from "../config";
import { getParser } from "../utils/parsers";
import { cleanHtml, truncateContent } from "../utils/html-cleaner";
import { rewriteImagesInHtml } from "../utils/img-rewriter";

// Helper function: Array chunking
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
    const {
      id,
      url,
      parser: parserName,
      max_items,
      parser_config,
      rss_name,
      img_rewrite,
    } = event.payload;

    // ========== Step 1: Fetch list (Supports multiple URLs) ==========
    const workflowConfig = getWorkflowConfig(this.env);
    const appConfig = getAppConfig(this.env);

    const listResult = await step.do(
      `fetch-list-${id}`,
      workflowConfig.MASTER_CRAWLER.FETCH_LIST,
      async () => {
        const parser = getParser(parserName);
        const urls = Array.isArray(url) ? url : [url];
        const allItems: ListItem[] = [];

        for (const u of urls) {
          const res = await fetch(u, {
            headers: {
              "User-Agent": appConfig.USER_AGENT,
              Accept: "text/html",
            },
          });
          if (!res.ok)
            throw new Error(`Failed to fetch list: ${res.status} for ${u}`);
          const html = await res.text();
          const { items } = await parser.parseList(html, u, parser_config);
          allItems.push(...items);
        }

        // Deduplicate
        const seen = new Set<string>();
        const uniqueItems = allItems.filter((item) => {
          if (seen.has(item.url)) return false;
          seen.add(item.url);
          return true;
        });
        const finalAllItems = uniqueItems.slice(0, max_items);
        const allUrls = finalAllItems.map((item) => item.url);

        if (finalAllItems.length === 0) {
          return { newItems: [], allItems: [], primaryUrl: urls[0] };
        }

        // Incremental comparison with D1: Find already fetched URLs
        const placeholders = allUrls.map(() => "?").join(",");
        const existing = await this.env.D1.prepare(
          `SELECT url FROM articles WHERE feed_id = ? AND url IN (${placeholders})`
        )
          .bind(id, ...allUrls)
          .all<{ url: string }>();

        const existingSet = new Set(existing.results.map((r) => r.url));
        const newItems = finalAllItems.filter(
          (item) => !existingSet.has(item.url)
        );

        return { newItems, allItems: finalAllItems, primaryUrl: urls[0] };
      }
    );

    // ========== Step 2: Dispatch sub-tasks ==========
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
            feedId: id,
            batch,
            parentId,
            batchIndex: i,
            parserName,
            parserConfig: parser_config,
          } satisfies ChildParams,
        }));

        await this.env.CHILD_WORKFLOW.createBatch(instances);
      });

      // ========== Step 3: Wait for sub-tasks to complete ==========
      for (let i = 0; i < totalBatches; i++) {
        await step.waitForEvent(`wait-child-${i}`, {
          timeout: workflowConfig.MASTER_CRAWLER.WAIT_CHILD
            .timeout as WorkflowSleepDuration,
          type: `child_completed_${i}`,
        });
      }
    }

    // ========== Step 4: Generate XML & Upload to R2 ==========
    await step.do(
      `save-feed-${id}`,
      workflowConfig.MASTER_CRAWLER.SAVE_FEED,
      async () => {
        if (listResult.allItems.length === 0) return true;

        const allUrls = listResult.allItems.map((item) => item.url);

        // Read fragments from D1. Some detail pages might be missing if Sub Workflow fails, handling it gracefully.
        const placeholders = allUrls.map(() => "?").join(",");
        const articles = await this.env.D1.prepare(
          `SELECT * FROM articles WHERE feed_id = ? AND url IN (${placeholders})`
        )
          .bind(id, ...allUrls)
          .all<{
            feed_id: string;
            url: string;
            title: string | null;
            author: string | null;
            content: string | null;
            pub_date: string | null;
            fetched_at: string;
          }>();

        const articleMap = new Map(articles.results.map((a) => [a.url, a]));
        const orderedArticles = allUrls
          .map((u) => articleMap.get(u))
          .filter(Boolean) as typeof articles.results;

        const feed = new Feed({
          title: rss_name || `${id}`,
          description: rss_name || `${id} - Powered by RSSFlare`,
          id: listResult.primaryUrl,
          link: listResult.primaryUrl,
          copyright: "",
          updated: dayjs().toDate(),
          generator: "RSSFlare",
        });

        for (const article of orderedArticles) {
          let content = article.content || "";
          if (img_rewrite && content) {
            content = rewriteImagesInHtml(content, img_rewrite);
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

          feed.addItem({
            title: article.title || "Untitled",
            id: article.url,
            link: article.url,
            author:
              parsedAuthors.length > 0
                ? [
                    {
                      name: "AUTHOR_HINT:" + parsedAuthors.join("|"),
                      email: "dummy@rssflare.local",
                    },
                  ]
                : undefined,
            content,
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

        await this.env.R2.put(`feeds/${id}.xml`, xml, {
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

// === Sub Workflow (Detail Crawler) ===
export class DetailCrawlerWorkflow extends WorkflowEntrypoint<
  Env,
  ChildParams
> {
  async run(event: WorkflowEvent<ChildParams>, step: WorkflowStep) {
    const { feedId, batch, parentId, batchIndex, parserName, parserConfig } =
      event.payload;

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
            const parser = getParser(parserName);
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

            const detail = await parser.parseDetail(
              html,
              articleItem,
              parserConfig
            );

            const mergedTitle = detail.title || articleItem.title;
            const mergedAuthorRaw = detail.author || articleItem.author;
            const mergedPubDate = detail.pub_date || articleItem.pub_date;

            let mergedAuthor: string | null = null;
            if (mergedAuthorRaw) {
              mergedAuthor = Array.isArray(mergedAuthorRaw)
                ? JSON.stringify(mergedAuthorRaw)
                : String(mergedAuthorRaw).trim();
            }

            const cleanedContent = truncateContent(cleanHtml(detail.content));

            await this.env.D1.prepare(
              `
                  INSERT INTO articles (feed_id, url, title, author, content, pub_date)
                  VALUES (?, ?, ?, ?, ?, ?)
                  ON CONFLICT (feed_id, url) DO UPDATE SET
                    title = excluded.title,
                    author = excluded.author,
                    content = excluded.content,
                    pub_date = excluded.pub_date,
                    fetched_at = CURRENT_TIMESTAMP
              `
            )
              .bind(
                feedId,
                articleUrl,
                mergedTitle || null,
                mergedAuthor || null,
                cleanedContent,
                mergedPubDate || null
              )
              .run();

            return true;
          }
        );
      } catch (err) {
        // Swallow error after retries exhausted, wrap logging in a step to comply with rules against external side effects
        await step.do(`handle-failed-item-${batchIndex}-${i}`, async () => {
          console.error(
            `Skipped item ${i} (${articleUrl}) after retries: ${err}`
          );
          return { status: "failed", url: articleUrl, error: String(err) };
        });
      }
    }

    // ========== Notify Completion ==========
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
