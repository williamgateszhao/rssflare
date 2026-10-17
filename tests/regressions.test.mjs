import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import * as cheerio from "cheerio";
import worker from "../src/index.ts";
import { getAppConfig } from "../src/config.ts";
import { MasterCrawlerWorkflow } from "../src/workflows/crawler.ts";
import { cleanupArticleCache } from "../src/utils/article-cache.ts";
import { cleanHtml } from "../src/utils/html-cleaner.ts";
import { defaultParser } from "../src/utils/parsers/default.ts";
import { apodParser } from "../src/utils/parsers/apod.ts";

function database(t) {
  const sql = new DatabaseSync(":memory:");
  t.after(() => sql.close());
  sql.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  const binding = {
    prepare(query) {
      return {
        bind(...params) {
          assert.ok(
            params.length <= 100,
            "D1 binding parameter limit exceeded"
          );
          return {
            async all() {
              return { results: sql.prepare(query).all(...params) };
            },
            async run() {
              return {
                meta: { changes: sql.prepare(query).run(...params).changes },
              };
            },
          };
        },
      };
    },
    async batch(statements) {
      sql.exec("BEGIN");
      try {
        const result = [];
        for (const statement of statements) result.push(await statement.run());
        sql.exec("COMMIT");
        return result;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { sql, binding };
}

function seed(
  sql,
  url,
  {
    feed = "feed",
    date = "2020-01-01 00:00:00",
    content = "Body",
    author = "Alice",
  } = {}
) {
  sql
    .prepare(
      "INSERT INTO articles (feed_id, url, title, content, author, fetched_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(feed, url, url, content, author, date);
}

test("Cron preserves sorting configuration and uses the indexed feed ID", async () => {
  let sent;
  await worker.scheduled(
    {},
    {
      KV: {
        get: async (key) =>
          key === "site_index"
            ? ["correct"]
            : {
                id: "stale",
                url: "https://example.com",
                parser: "default",
                sort_by_list_order: true,
              },
      },
      QUEUE: {
        sendBatch: async (tasks) => {
          sent = tasks;
        },
      },
    },
    {}
  );
  assert.equal(sent[0].body.id, "correct");
  assert.equal(sent[0].body.sort_by_list_order, true);
});

test("Queue acknowledges created/existing instances and retries other failures", async () => {
  const outcomes = [
    undefined,
    new Error("instance exists (instance.already_exists)"),
    new Error("temporary service failure"),
    new Error("unrelated resource already exists"),
  ];
  const messages = outcomes.map((_, i) => ({
    id: String(i),
    body: { id: "feed" },
    acked: 0,
    retried: 0,
    ack() {
      this.acked++;
    },
    retry() {
      this.retried++;
    },
  }));
  const ids = [];
  await worker.queue(
    { messages },
    {
      MASTER_WORKFLOW: {
        async create(options) {
          ids.push(options.id);
          const error = outcomes[Number(options.id.split("-").at(-1))];
          if (error) throw error;
        },
      },
    }
  );
  assert.deepEqual(
    messages.map((m) => [m.acked, m.retried]),
    [
      [1, 0],
      [1, 0],
      [0, 1],
      [0, 1],
    ]
  );
  assert.deepEqual(ids, ["feed-0", "feed-1", "feed-2", "feed-3"]);
});

test("Default parser falls back while preserving selector priority", () => {
  const item = { url: "https://example.com/post" };
  for (const html of [
    '<div class="post-content">Body</div>',
    "<article>Body</article>",
  ]) {
    assert.equal(defaultParser.parseDetail(html, item).content, "Body");
  }
  assert.equal(
    defaultParser.parseDetail(
      '<div class="post-content">Wrong</div><article><div class="entry-content">Right</div></article>',
      item
    ).content,
    "Right"
  );
});

test("Cleaning preserves ordinary classes and still removes ad nodes", () => {
  const ordinary = [
    "lazyload-img",
    "read-more",
    "upload-box",
    "download-link",
    "thread-body",
    "head-content",
  ];
  const html =
    ordinary.map((name) => `<p class="${name}">${name}</p>`).join("") +
    '<p class="ad-banner">Ad one</p><p id="box_ad-banner">Ad two</p>';
  const text = cheerio.load(cleanHtml(html)).text();
  for (const name of ordinary) assert.ok(text.includes(name));
  assert.ok(!text.includes("Ad one") && !text.includes("Ad two"));
});

test("APOD video remains accessible after global cleaning", async () => {
  const result = await apodParser.parseDetail(
    '<center><p><iframe src="//www.youtube.com/embed/video?id=1&amp;start=2"></iframe></p></center><center>Title</center><p>Explanation</p>',
    { url: "https://apod.nasa.gov/apod/ap260101.html" }
  );
  const $ = cheerio.load(cleanHtml(result.content));
  assert.equal($("iframe").length, 0);
  assert.equal(
    $("a").attr("href"),
    "https://www.youtube.com/embed/video?id=1&start=2"
  );
  assert.equal($("a").text(), "Watch video");
  assert.ok($.text().includes("Explanation"));
});

test("Cleanup is opt-in and invalid retention settings disable it", (t) => {
  t.mock.method(console, "warn", () => {});
  for (const value of [
    undefined,
    "0",
    "-1",
    "1.5",
    "30days",
    "Infinity",
    "9007199254740991",
  ]) {
    assert.equal(
      getAppConfig({ ARTICLE_RETENTION_DAYS: value }).ARTICLE_RETENTION_DAYS,
      0
    );
  }
  assert.equal(
    getAppConfig({ ARTICLE_RETENTION_DAYS: "30" }).ARTICLE_RETENTION_DAYS,
    30
  );
});

test("Cleanup protects the full URL list, recent rows and other feeds, and limits each batch", async (t) => {
  const { sql, binding } = database(t);
  const protectedUrls = Array.from(
    { length: 150 },
    (_, i) => `https://example.com/current-${i}`
  );
  for (const url of protectedUrls) seed(sql, url);
  for (let i = 0; i < 60; i++) {
    seed(sql, `old-${i}`);
    sql
      .prepare(
        "INSERT INTO debug_raw_html (feed_id,url,fetched_at) VALUES ('feed',?,'2020-01-01')"
      )
      .run(`debug-${i}`);
  }
  seed(sql, "recent", { date: "2026-10-10 00:00:00" });
  seed(sql, "other", { feed: "other" });
  sql.exec(
    "INSERT INTO debug_raw_html(feed_id,url,fetched_at) VALUES ('feed','recent','2026-10-10'), ('other','old','2020-01-01')"
  );
  assert.deepEqual(
    await cleanupArticleCache(
      binding,
      "feed",
      protectedUrls,
      "2026-09-17 00:00:00"
    ),
    { articles: 50, debugHtml: 50 }
  );
  assert.equal(
    sql
      .prepare(
        "SELECT count(*) AS n FROM articles WHERE url LIKE 'https://example.com/current-%'"
      )
      .get().n,
    150
  );
  assert.equal(
    sql
      .prepare(
        "SELECT count(*) AS n FROM articles WHERE url IN ('recent','other')"
      )
      .get().n,
    2
  );
  assert.equal(
    sql
      .prepare(
        "SELECT count(*) AS n FROM debug_raw_html WHERE url IN ('recent','old')"
      )
      .get().n,
    2
  );
  assert.deepEqual(
    await cleanupArticleCache(
      binding,
      "feed",
      protectedUrls,
      "2026-09-17 00:00:00"
    ),
    { articles: 10, debugHtml: 10 }
  );
});

async function runFeed(
  t,
  {
    content = "Body",
    author = "Alice",
    retention = "30",
    missing = false,
    empty = false,
    failList = false,
    failPublish = false,
    failCleanup = false,
  } = {}
) {
  const { sql, binding } = database(t);
  const currentUrl = "https://example.com/current";
  seed(sql, currentUrl, { content, author });
  seed(sql, "old-unused");
  const effects = [];
  const env = {
    ARTICLE_RETENTION_DAYS: retention,
    D1: {
      ...binding,
      async batch(statements) {
        effects.push("cleanup");
        if (failCleanup) throw new Error("cleanup unavailable");
        return binding.batch(statements);
      },
    },
    R2: {
      async put(key, xml) {
        effects.push("publish");
        if (failPublish) throw new Error("R2 unavailable");
        env.xml = xml;
      },
    },
    CHILD_WORKFLOW: { async createBatch() {} },
  };
  t.mock.method(globalThis, "fetch", async () => {
    if (failList) throw new Error("list unavailable");
    return new Response(
      empty
        ? ""
        : `<article><a href="${currentUrl}">Current</a>${missing ? '<a href="/missing">Missing</a>' : ""}</article>`
    );
  });
  const steps = {
    async do(name, ...args) {
      return args.at(-1)();
    },
    async waitForEvent() {},
  };
  const workflow = new MasterCrawlerWorkflow({}, env);
  const promise = workflow.run(
    {
      instanceId: "test",
      timestamp: new Date("2026-10-17T00:00:00Z"),
      payload: {
        id: "feed",
        parser: "default",
        url: "https://example.com/list",
        sort_by_list_order: true,
      },
    },
    steps
  );
  if (failList || failPublish) await assert.rejects(promise, /unavailable/);
  else await promise;
  return { sql, env, effects };
}

test("XML declares dc exactly once with authors, including an entirely empty body", async (t) => {
  for (const content of ["", "Body"]) {
    await t.test(content || "empty body", async (t) => {
      const { env, effects } = await runFeed(t, { content });
      const $ = cheerio.load(env.xml, { xml: true });
      assert.equal(
        $("rss").attr("xmlns:dc"),
        "http://purl.org/dc/elements/1.1/"
      );
      assert.equal((env.xml.match(/xmlns:dc=/g) || []).length, 1);
      assert.ok(env.xml.includes("<dc:creator>"));
      assert.deepEqual(effects, ["publish", "cleanup"]);
    });
  }
});

test("Cleanup follows publication and skips disabled, empty, incomplete and failed updates", async (t) => {
  const cases = [
    [{}, ["publish", "cleanup"]],
    [{ retention: "" }, ["publish"]],
    [{ retention: "0" }, ["publish"]],
    [{ retention: "invalid" }, ["publish"]],
    [{ empty: true }, []],
    [{ missing: true }, ["publish"]],
    [{ failList: true }, []],
    [{ failPublish: true }, ["publish"]],
    [{ failCleanup: true }, ["publish", "cleanup"]],
  ];
  for (const [options, expected] of cases) {
    await t.test(JSON.stringify(options), async (t) => {
      t.mock.method(console, "warn", () => {});
      const { sql, effects } = await runFeed(t, options);
      assert.deepEqual(effects, expected);
      const old = sql
        .prepare("SELECT count(*) AS n FROM articles WHERE url='old-unused'")
        .get().n;
      assert.equal(
        old,
        effects.includes("cleanup") && !options.failCleanup ? 0 : 1
      );
    });
  }
});
