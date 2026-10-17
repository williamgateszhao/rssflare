/** Reclaim a small batch of obsolete cache rows after a complete feed update. */
export async function cleanupArticleCache(
  db: D1Database,
  feedId: string,
  currentUrls: string[],
  cutoff: string
) {
  const [articles, debugHtml] = await db.batch([
    db
      .prepare(
        `DELETE FROM articles WHERE rowid IN (
          SELECT rowid FROM articles
          WHERE feed_id = ? AND fetched_at < ?
            AND url NOT IN (SELECT value FROM json_each(?))
          ORDER BY fetched_at, url LIMIT 50
        )`
      )
      .bind(feedId, cutoff, JSON.stringify(currentUrls)),
    db
      .prepare(
        `DELETE FROM debug_raw_html WHERE rowid IN (
          SELECT rowid FROM debug_raw_html
          WHERE feed_id = ? AND fetched_at < ?
          ORDER BY fetched_at, url LIMIT 50
        )`
      )
      .bind(feedId, cutoff),
  ]);

  return {
    articles: articles.meta.changes,
    debugHtml: debugHtml.meta.changes,
  };
}
