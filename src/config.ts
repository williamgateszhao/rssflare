/**
 * Type Definitions - Site Configuration and Environment Bindings
 */
import type {
  WorkflowStepConfig,
  WorkflowSleepDuration,
} from "cloudflare:workers";

/** Single site config (Stored in KV: site:{id}) */
export interface SiteConfig {
  id: string;
  url: string | string[];
  parser: string; // Corresponds to the parsing strategy function name in the code
  max_items?: number; // Only fetch the latest N articles each time, defaults to 10
  parser_config?: any; // Site-specific parsing configuration (array, object, etc.)
  rss_name?: string; // Manually set RSS name
  img_rewrite?: string; // Image URL rewrite template, e.g. "https://images.weserv.nl?url=${href_ue}"
  sort_by_list_order?: boolean; // If true, strictly keep the original list order. Default false: sort by pubDate.
}

/** Queue Message Payload */
export interface QueueMessage {
  id: string;
  url: string | string[];
  parser: string;
  max_items?: number;
  parser_config?: any;
  rss_name?: string;
  img_rewrite?: string;
  sort_by_list_order?: boolean;
}

/** D1 Article Record */
export interface Article {
  feed_id: string;
  url: string;
  title: string | null;
  author: string | null; // Stored as JSON stringified array or plain string in DB
  content: string | null;
  pub_date: string | null;
  link: string | null; // Canonical display URL (when different from the fetch URL stored in `url`)
  fetched_at: string;
}

/** List Page Parse Result */
export interface ListParseResult {
  items: ListItem[];
}

export interface ListItem {
  url: string;
  title?: string;
  author?: string | string[];
  pub_date?: string;
}

/** Detail Page Parse Result */
export interface DetailParseResult {
  title: string;
  author?: string | string[];
  content: string;
  pub_date?: string;
  url?: string;
}

/** Parser Interface - Parsing rules for each site */
export interface SiteParser {
  rewriteListUrl?(baseUrl: string, config?: any): string | Promise<string>;
  parseList(
    html: string,
    baseUrl: string,
    config?: any
  ): ListParseResult | Promise<ListParseResult>;
  parseDetail(
    html: string,
    item: ListItem,
    config?: any
  ): DetailParseResult | Promise<DetailParseResult>;
}

export interface ChildParams {
  feedId: string;
  batch: ListItem[];
  parentId: string;
  batchIndex: number;
  siteConfig: SiteConfig;
}

/** Cloudflare Worker Environment Bindings */
export interface Env {
  KV: KVNamespace;
  R2: R2Bucket;
  D1: D1Database;
  QUEUE: Queue<QueueMessage>;
  MASTER_WORKFLOW: Workflow;
  CHILD_WORKFLOW: Workflow;
  API_KEY?: string;

  // --- Environment Variables (wrangler.toml [vars]) ---
  USER_AGENT?: string;
  FEED_CACHE_MAX_AGE?: string; // e.g. "600"
  DEBUG_SAVE_HTML?: string; // e.g. "true"
  MAX_CONTENT_LENGTH?: string; // e.g. "300000"

  MASTER_BATCH_SIZE?: string; // e.g. "5"
  MASTER_FETCH_TIMEOUT?: string; // e.g. "30 seconds"
  MASTER_FETCH_RETRIES?: string; // e.g. "2"
  MASTER_FETCH_RETRY_DELAY?: string; // e.g. "5 seconds"

  MASTER_WAIT_CHILD_TIMEOUT?: string; // e.g. "30 minutes"

  MASTER_SAVE_FEED_TIMEOUT?: string; // e.g. "30 seconds"
  MASTER_SAVE_FEED_RETRIES?: string; // e.g. "1"
  MASTER_SAVE_FEED_RETRY_DELAY?: string; // e.g. "5 seconds"

  DETAIL_POLITE_DELAY?: string; // e.g. "1 second"
  DETAIL_PROCESS_TIMEOUT?: string; // e.g. "30 seconds"
  DETAIL_PROCESS_RETRIES?: string; // e.g. "2"
  DETAIL_PROCESS_RETRY_DELAY?: string; // e.g. "10 seconds"

  DETAIL_NOTIFY_RETRIES?: string; // e.g. "3"
  DETAIL_NOTIFY_RETRY_DELAY?: string; // e.g. "5 seconds"
}

// ==================== Configuration Getters ====================

/**
 * Merge partial site config with defaults
 */
export function getSiteConfig(
  config: Partial<SiteConfig>,
  env?: Env
): SiteConfig {
  return {
    id: config.id || "",
    url: config.url || "",
    parser: config.parser || "default",
    max_items: config.max_items ?? 10,
    parser_config: config.parser_config,
    rss_name: config.rss_name,
    img_rewrite: config.img_rewrite,
    sort_by_list_order: config.sort_by_list_order,
  };
}

export function getAppConfig(env: Env) {
  return {
    USER_AGENT: env.USER_AGENT || "Mozilla/5.0 (compatible; RSSBot/1.0)",
    FEED_CACHE_MAX_AGE: env.FEED_CACHE_MAX_AGE
      ? parseInt(env.FEED_CACHE_MAX_AGE, 10)
      : 600,
    DEBUG_SAVE_HTML:
      env.DEBUG_SAVE_HTML === "true" || env.DEBUG_SAVE_HTML === "1",
    MAX_CONTENT_LENGTH: env.MAX_CONTENT_LENGTH
      ? parseInt(env.MAX_CONTENT_LENGTH, 10)
      : 300000,
  };
}

export function getWorkflowConfig(env: Env) {
  return {
    MASTER_CRAWLER: {
      BATCH_SIZE: env.MASTER_BATCH_SIZE
        ? parseInt(env.MASTER_BATCH_SIZE, 10)
        : 5,
      FETCH_LIST: {
        retries: {
          limit: env.MASTER_FETCH_RETRIES
            ? parseInt(env.MASTER_FETCH_RETRIES, 10)
            : 2,
          delay: (env.MASTER_FETCH_RETRY_DELAY ||
            "5 seconds") as WorkflowSleepDuration,
        },
        timeout: env.MASTER_FETCH_TIMEOUT || "30 seconds",
      } as WorkflowStepConfig,
      WAIT_CHILD: {
        timeout: env.MASTER_WAIT_CHILD_TIMEOUT || "30 minutes",
      },
      SAVE_FEED: {
        retries: {
          limit: env.MASTER_SAVE_FEED_RETRIES
            ? parseInt(env.MASTER_SAVE_FEED_RETRIES, 10)
            : 1,
          delay: (env.MASTER_SAVE_FEED_RETRY_DELAY ||
            "5 seconds") as WorkflowSleepDuration,
        },
        timeout: env.MASTER_SAVE_FEED_TIMEOUT || "30 seconds",
      } as WorkflowStepConfig,
    },

    DETAIL_CRAWLER: {
      POLITE_DELAY: (env.DETAIL_POLITE_DELAY ||
        "1 second") as WorkflowSleepDuration,
      PROCESS_ITEM: {
        retries: {
          limit: env.DETAIL_PROCESS_RETRIES
            ? parseInt(env.DETAIL_PROCESS_RETRIES, 10)
            : 2,
          delay: (env.DETAIL_PROCESS_RETRY_DELAY ||
            "10 seconds") as WorkflowSleepDuration,
        },
        timeout: env.DETAIL_PROCESS_TIMEOUT || "30 seconds",
      } as WorkflowStepConfig,
      NOTIFY_PARENT: {
        retries: {
          limit: env.DETAIL_NOTIFY_RETRIES
            ? parseInt(env.DETAIL_NOTIFY_RETRIES, 10)
            : 3,
          delay: (env.DETAIL_NOTIFY_RETRY_DELAY ||
            "5 seconds") as WorkflowSleepDuration,
        },
      } as WorkflowStepConfig,
    },
  };
}
