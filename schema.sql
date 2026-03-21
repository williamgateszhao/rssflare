-- D1 Database Schema for RSS Aggregator
-- Table: articles - Acts as a "cache workshop" for passing large HTML between Workflow steps

CREATE TABLE IF NOT EXISTS articles (
    feed_id TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT,
    author TEXT,
    content TEXT,
    pub_date TEXT,
    link TEXT,
    fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (feed_id, url)
);

CREATE INDEX IF NOT EXISTS idx_articles_feed_id ON articles(feed_id);
CREATE INDEX IF NOT EXISTS idx_articles_fetched_at ON articles(fetched_at);

-- Table: debug_raw_html - Used to save raw HTML fetched when DEBUG_SAVE_HTML is enabled for analysis
CREATE TABLE IF NOT EXISTS debug_raw_html (
    feed_id TEXT NOT NULL,
    url TEXT NOT NULL,
    html TEXT,
    fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (feed_id, url)
);
