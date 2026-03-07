/**
 * Type definitions - Site configuration and environment bindings
 */
import type {
  WorkflowStepConfig,
  WorkflowSleepDuration,
} from "cloudflare:workers";

/** Single site configuration (Stored in KV: site:{id}) */
export interface SiteConfig {
  id: string;
  url: string | string[];
  parser: string; // Corresponding parser function name
  active: boolean; // Active switch
  max_items: number; // Max items to fetch each time
  parser_config?: any; // Specific site parser configuration
  rss_name?: string; // Manually set RSS name
  img_rewrite?: string; // Image URL rewrite template, e.g., "https://images.weserv.nl?url=${href_ue}"
}

/** Queue Message Payload */
export interface QueueMessage {
  id: string;
  url: string | string[];
  parser: string;
  max_items: number;
  parser_config?: any;
  rss_name?: string;
  img_rewrite?: string;
}

/** D1 Article record */
export interface Article {
  feed_id: string;
  url: string;
  title: string | null;
  author: string | null; // Stored as JSON stringified array or plain string in DB
  content: string | null;
  pub_date: string | null;
  fetched_at: string;
}

/** List page parse result */
export interface ListParseResult {
  items: ListItem[];
}

export interface ListItem {
  url: string;
  title?: string;
  author?: string | string[];
  pub_date?: string;
}

/** Detail page parse result */
export interface DetailParseResult {
  title: string;
  author?: string | string[];
  content: string;
  pub_date?: string;
}

/** Parser interface - Parsing rules for each site */
export interface SiteParser {
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
  parserName: string;
  parserConfig?: any;
}

/** Cloudflare Worker environment bindings */
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

export function getAppConfig(env: Env) {
  return {
    USER_AGENT: env.USER_AGENT || "Mozilla/5.0 (compatible; RSSBot/1.0)",
    FEED_CACHE_MAX_AGE: env.FEED_CACHE_MAX_AGE
      ? parseInt(env.FEED_CACHE_MAX_AGE, 10)
      : 600,
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
