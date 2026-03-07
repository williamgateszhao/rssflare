-- D1 Database Schema for RSS Aggregator
-- Table: articles - As a cache pool for passing large HTML between Workflow steps

CREATE TABLE IF NOT EXISTS articles (
    feed_id TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT,
    author TEXT,
    content TEXT,
    pub_date TEXT,
    fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (feed_id, url)
);

CREATE INDEX IF NOT EXISTS idx_articles_feed_id ON articles(feed_id);
CREATE INDEX IF NOT EXISTS idx_articles_fetched_at ON articles(fetched_at);
