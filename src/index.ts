/**
 * RSSFlare - Main Entry Point
 *
 * Contains three main modules:
 *   1. Hono Gateway - Provides GET /rss/:id standardized RSS output
 *   2. Producer (Cron) - Periodically reads config from KV and dispatches fetch tasks to Queue
 *   3. Consumer (Queue) - Consumes tasks and starts Workflow instances
 */
import { Hono } from "hono";
import {
  MasterCrawlerWorkflow,
  DetailCrawlerWorkflow,
} from "./workflows/crawler";
import type { Env, SiteConfig, QueueMessage } from "./config";
import { getAppConfig } from "./config";

// ==================== Hono Gateway ====================
const app = new Hono<{ Bindings: Env }>();

// Authentication Middleware
app.use("*", async (c, next) => {
  const env = c.env;
  if (env.API_KEY) {
    const queryKey = c.req.query("key");
    const authHeader = c.req.header("Authorization") || "";
    let headerKey = null;
    if (authHeader.toLowerCase().startsWith("bearer ")) {
      headerKey = authHeader.substring(7).trim();
    }

    if ((queryKey || headerKey) !== env.API_KEY) {
      return c.json({ error: "Unauthorized: Invalid API Key" }, 401);
    }
  }
  await next();
});

app.get("/rss/:id", async (c) => {
  // 1. Try to hit Workers Cache API
  const cache = caches.default;
  const cachedRes = await cache.match(c.req.raw);
  if (cachedRes) return cachedRes;

  // 2. Filter out possible .xml suffix to maintain compatibility with RSS readers
  const id = c.req.param("id").replace(/\.xml$/, "");
  const ifNoneMatch = c.req.header("If-None-Match");

  // 3. Read from R2 with conditional headers (avoids network transfer if not modified)
  const file = await c.env.R2.get(`feeds/${id}.xml`, {
    onlyIf: ifNoneMatch ? { etagDoesNotMatch: ifNoneMatch } : undefined,
  });

  if (!file) return c.text("Feed not found or generating...", 404);

  // 4. Check if we need to return 304 Not Modified
  // If file hasn't changed (ETag matches), R2 returns R2Object without body
  if (!("body" in file) || !file.body) {
    return new Response(null, { status: 304 });
  }

  // 5. Build response
  const appConfig = getAppConfig(c.env);
  const headers = new Headers();
  headers.set("Content-Type", "application/xml; charset=utf-8");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set(
    "Cache-Control",
    `public, max-age=${appConfig.FEED_CACHE_MAX_AGE}`
  );
  file.writeHttpMetadata(headers);
  headers.set("ETag", file.httpEtag);

  const response = new Response(file.body, { headers });

  // 6. Clone generated Response and put it into Workers Cache
  c.executionCtx.waitUntil(cache.put(c.req.raw, response.clone()));
  return response;
});

// Health check endpoint
app.get("/", (c) => c.text("RSSFlare is running."));

// ==================== Export Worker Handlers ====================
export default {
  fetch: app.fetch,

  // Cron Trigger (Producer)
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const indexRaw = (await env.KV.get("site_index", "json")) as
      | string[]
      | null;
    if (!indexRaw || !Array.isArray(indexRaw)) {
      console.log("No site_index found in KV, skipping.");
      return;
    }

    // Concurrently fetch all site configurations
    const sites = await Promise.all(
      indexRaw.map(
        (id) => env.KV.get(`site:${id}`, "json") as Promise<SiteConfig | null>
      )
    );

    // Filter out inactive or invalid sites and wrap into Queue messages
    const tasks = sites
      .filter((s): s is SiteConfig => s !== null && s.active)
      .map((s) => ({
        body: {
          id: s.id,
          url: s.url,
          parser: s.parser,
          max_items: s.max_items,
          parser_config: s.parser_config,
          rss_name: s.rss_name,
          img_rewrite: s.img_rewrite,
        } satisfies QueueMessage,
      }));

    if (tasks.length === 0) {
      console.log("No active sites to process.");
      return;
    }

    await env.QUEUE.sendBatch(tasks);
    console.log(`Dispatched ${tasks.length} tasks to queue.`);
  },

  // Queue Consumer
  async queue(batch: MessageBatch<QueueMessage>, env: Env) {
    for (const msg of batch.messages) {
      try {
        // Combine site ID and Queue message unique ID as the Instance ID
        // This acts as an idempotency key to prevent duplicate submissions
        const instanceId = `${msg.body.id}-${msg.id}`;

        await env.MASTER_WORKFLOW.create({
          id: instanceId, // <--- Use dynamically generated unique ID
          params: msg.body,
        });

        console.log(
          `Workflow started for: ${msg.body.id}, instance: ${instanceId}`
        );
      } catch (err) {
        // Safe to skip if the instance already exists
        console.warn(`Workflow skipped/failed for ${msg.body.id}: ${err}`);
      }

      // Always ack the message if successfully dispatched or skipped
      msg.ack();
    }
  },
};

// Export Workflow classes for wrangler binding
export { MasterCrawlerWorkflow, DetailCrawlerWorkflow };
