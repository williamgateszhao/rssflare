# RSSFlare

[English](#english) | [中文](#中文)

---

<h2 id="english">RSSFlare</h2>

**A super-minimalist RSSHub alternative built entirely on the Cloudflare Workers ecosystem. It can run completely free of charge for personal use on Cloudflare, achieving zero maintenance and eliminating timeouts.**

_This project is a product of "vibe coding"—built mostly through conversations with AI. While functional and practical, the code might carry that unique "AI-generated" flavor._

### 🌟 Core Advantages

- **Complete Decoupling (Pre-generated vs. On-the-fly)**: Unlike RSSHub, which generates feeds upon user request, RSSFlare is tailored for personal use. It separates "crawling (production)" from "serving (consumption)" by using scheduled cron jobs to pre-generate and store RSS XML in R2. User requests are served instantly from R2 storage. This completely eliminates timeout issues caused by slow scraping, which often lead RSS readers to mark the feed as failed.
- **Bypassing Cloudflare Limits**:
  - **KV Write Limits**: Uses **R2** to store generated XML, bypassing the 1000 writes/day limit of Cloudflare KV.
  - **CPU & Wall Time Limits**: Uses **Workflows** to break down heavy parsing tasks into independent steps.
  - **The 50 Subrequest Limit**: Implements a **Master-Sub Workflows with Event-driven sync** architecture. The Master workflow distributes tasks to Sub-workflows, each enjoying its own 50 subrequest quota, effectively removing the limit for heavy web scraping (e.g., resolving hundreds of image redirects).
  - **Payload Size Limits**: Uses **D1** as a temporary cache pool to pass large HTML strings between workflow steps, avoiding the 1MB payload limit.
- **Configuration as a Service**: Site configurations are stored in KV. You can add, remove, or modify feeds without redeploying the code.

### 🚀 Quick Start Deployment

#### 1. Prepare Infrastructure

First, create the necessary resources using Wrangler or the Cloudflare Dashboard:

```bash
# Create KV Namespace for config
npx wrangler kv:namespace create rssflare-config

# Create R2 Bucket for RSS XML storage
npx wrangler r2 bucket create rssflare

# Create D1 Database for article caching
npx wrangler d1 create rssflare

# Create Queue for task buffering
npx wrangler queues create rssflare1
```

#### 2. Configure `wrangler.toml`

Update your `wrangler.toml` file with the generated IDs from the previous step. (Replace `<YOUR_KV_ID>`, `<YOUR_D1_ID>`, etc.).
You can also customize the routing and default timeout parameters in the `[vars]` section.

#### 3. Initialize Database

Initialize the D1 database schema:

```bash
npm install
npx wrangler d1 execute rssflare --remote --file=./schema.sql
```

#### 4. Deploy

Deploy the Worker, Workflows, and Cron Triggers:

```bash
npx wrangler deploy
```

#### 5. Configure Your First Feed

Tell RSSFlare what to crawl by writing to the KV namespace:

```bash
# 1. Write the active site index
npx wrangler kv:key put --binding=KV "site_index" '["apod"]'

# 2. Write the specific site configuration (e.g., NASA APOD)
# Note: The suffix in the KV key (e.g., "apod" in "site:apod") becomes the unique ID for this feed.
# This ID determines your final RSS access path (e.g., /rss/apod). It is completely user-defined and is NOT bound to the parser's name.
npx wrangler kv:key put --binding=KV "site:apod" '{
  "url": "https://apod.nasa.gov/apod/archivepix.html",
  "parser": "apod",
  "max_items": 5
}'
```

You can now manually trigger a workflow or wait for the Cron to run:

```bash
npx wrangler workflows trigger rssflare-master '{"id":"apod", "url":"https://apod.nasa.gov/apod/archivepix.html", "parser":"apod", "max_items":5}'
```

Your RSS feed will be available at: `https://rssflare.<your-subdomain>.workers.dev/rss/apod`

### ⚙️ KV Configuration Guide

Site configurations are stored in your KV namespace as JSON strings under the key format `site:<id>`.

Here are the supported fields for a feed configuration:

```json
{
  "url": "https://apod.nasa.gov/apod/archivepix.html",
  "parser": "apod",
  "max_items": 5,
  "rss_name": "NASA APOD",
  "img_rewrite": "https://proxy.duckduckgo.com/iu/?u=${href_ue}",
  "sort_by_list_order": false
}
```

| Field                | Type           | Description                                                                                                                                                                                                                                     |
| :------------------- | :------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`                | String / Array | **Required.** The target website URL(s) to scrape. Supports an array to pass multiple URLs.                                                                                                                                                     |
| `parser`             | String         | **Required.** The name of the parser to use (matches the filename in `src/utils/parsers/`).                                                                                                                                                     |
| `max_items`          | Number         | _Optional._ The maximum number of new articles to fetch and process in a single run. Defaults to `10`.                                                                                                                                          |
| `rss_name`           | String         | _Optional._ A custom title for the generated RSS feed.                                                                                                                                                                                          |
| `img_rewrite`        | String         | _Optional._ A template string to proxy image URLs, bypassing hotlink protections. Use `${href_ue}` for the URL-encoded original image link. E.g., `https://proxy.duckduckgo.com/iu/?u=${href_ue}` or `https://images.weserv.nl?url=${href_ue}`. |
| `parser_config`      | Object         | _Optional._ Any custom configuration parameters you want to pass specifically to your parser script.                                                                                                                                            |
| `sort_by_list_order` | Boolean        | _Optional._ If `true`, strictly keeps the original list order during RSS generation. Defaults to `false`, which sorts items by their published date (falling back to fetched date if `pubDate` is missing).                                     |

### 🛠 Developing Custom Parsers

To add support for a new website, create a new TypeScript file in `src/utils/parsers/` and implement the `Parser` interface. Then, run:

```bash
npm run predev # This regenerates src/utils/parsers/index.ts
```

_Note: Because RSSFlare is positioned for personal use, this project does not aim to accumulate a massive collection of parsers or unify parser code and configuration structures. If you have the technical capability to deploy this project to Cloudflare, you certainly have the ability to generate the exact custom parsers you need using "vibe coding" (LLMs). Several parsers are provided as examples, and you can easily use AI to convert existing RSSHub routes into parsers for this project._

---

<h2 id="中文">RSSFlare</h2>

**一个基于 Cloudflare Workers 生态构建的超精简 RSSHub 替代方案。在个人使用环境下，可以完全免费地运行在 Cloudflare 上，实现零维护和抗超时。**

_本项目是 "vibe coding" 的产物——主要通过与 AI 的对话构建而成。虽然功能实用，但代码可能带有那种独特的“AI 生成”风味。_

### 🌟 核心优势

- **彻底解耦 (预生成 vs 即时生成)**: 与 RSSHub 在用户发起请求时才去抓取并生成 RSS 的设计不同，RSSFlare 定位于个人使用。它将“抓取（生产）”与“服务（消费）”完全分离，通过定时任务 (Cron) 自动在后台抓取并预生成 XML 存入 R2。用户请求直接从 R2 读取，秒级响应。这彻底避免了因为抓取时间过长导致的请求超时，从而防止 RSS 阅读器将其视为读取失败的问题。
- **突破 Cloudflare 免费版限制**:
  - **规避 KV 写入限制**: 利用 **R2** 存储最终生成的 RSS XML，绕过 KV 每日 1000 次的写入限制。
  - **突破 CPU 与执行时间限制**: 利用 **Workflows** 将耗时的爬虫任务拆分为多个独立的 Step 执行。
  - **打破 50 次子请求硬限制**: 采用 **主从 Workflow + Event 驱动同步** 架构。主 Workflow 将任务分发给多个子 Workflow，每个子 Workflow 独享 50 次子请求配额，完美解决复杂网页抓取（如大量图片重定向探测）时配额耗尽的问题。
  - **规避 Payload 1MB 限制**: 利用 **D1 数据库** 作为“缓存车间”在 Workflow 步骤间传递大体积的 HTML 数据。
- **配置即服务**: 站点抓取规则和开关状态存储于 KV，无需重新部署代码即可随时增删订阅源。

### 🚀 快速部署指南

#### 1. 准备基础设施环境

使用 Wrangler 命令行或前往 Cloudflare Dashboard 创建以下资源：

```bash
# 创建 KV 命名空间用于存储配置
npx wrangler kv:namespace create rssflare-config

# 创建 R2 Bucket 用于存储 RSS XML 文件
npx wrangler r2 bucket create rssflare

# 创建 D1 数据库作为文章解析缓存
npx wrangler d1 create rssflare

# 创建 Queue 消息队列用于任务削峰
npx wrangler queues create rssflare1
```

#### 2. 配置 `wrangler.toml`

将上述生成的对应 ID 填入项目根目录 `wrangler.toml` 文件中的占位符（如 `<YOUR_KV_ID>`）。
您也可以在 `[vars]` 部分自定义路由域名以及爬虫默认超时等参数。

#### 3. 初始化数据库表结构

```bash
npm install
npx wrangler d1 execute rssflare --remote --file=./schema.sql
```

#### 4. 部署服务

部署将自动注册 Worker、Workflows 以及定时触发器 (Cron)。

```bash
npx wrangler deploy
```

#### 5. 初始化第一个订阅源配置

告知系统您希望抓取哪些站点：

```bash
# 1. 写入活跃站点索引
npx wrangler kv:key put --binding=KV "site_index" '["apod"]'

# 2. 写入具体站点配置 (以 NASA APOD 为例)
# 注意：KV 键名的后缀（例如 "site:apod" 中的 "apod"）将成为该站点的唯一 ID。
# 这个 ID 决定了您最终的 RSS 访问路径（例如 /rss/apod）。它是完全由用户自定义的，并且与 parser（解析器）的名称没有任何绑定关系。
npx wrangler kv:key put --binding=KV "site:apod" '{
  "url": "https://apod.nasa.gov/apod/archivepix.html",
  "parser": "apod",
  "max_items": 5
}'
```

配置完成后，您可以手动触发工作流测试，或者等待定时器运行：

```bash
npx wrangler workflows trigger rssflare-master '{"id":"apod", "url":"https://apod.nasa.gov/apod/archivepix.html", "parser":"apod", "max_items":5}'
```

抓取完成后，您的 RSS 订阅链接将是：`https://rssflare.<your-subdomain>.workers.dev/rss/apod`

### ⚙️ KV 配置说明

站点的抓取规则存储在您的 KV 命名空间中，键名为 `site:<id>`，值为 JSON 字符串。

以下是单站点配置支持的字段：

```json
{
  "url": "https://apod.nasa.gov/apod/archivepix.html",
  "parser": "apod",
  "max_items": 5,
  "rss_name": "NASA 每日一图",
  "img_rewrite": "https://proxy.duckduckgo.com/iu/?u=${href_ue}",
  "sort_by_list_order": false
}
```

| 字段                 | 类型           | 说明                                                                                                                                                                                                                            |
| :------------------- | :------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `url`                | String / Array | **必填。** 需要抓取的目标网站地址，支持数组形式传入多个 URL。                                                                                                                                                                   |
| `parser`             | String         | **必填。** 采用的解析器名称（与 `src/utils/parsers/` 下的文件名对应）。                                                                                                                                                         |
| `max_items`          | Number         | _选填。_ 每次运行最多抓取的新文章数量。默认为 `10`。                                                                                                                                                                            |
| `rss_name`           | String         | _选填。_ 为生成的 RSS 频道自定义标题。                                                                                                                                                                                          |
| `img_rewrite`        | String         | _选填。_ 图片 URL 代理改写模板，用于破解防盗链。利用 `${href_ue}` 变量代表 URL 编码后的原图地址。例如可以使用 DuckDuckGo 的代理：`https://proxy.duckduckgo.com/iu/?u=${href_ue}` 或 `https://images.weserv.nl?url=${href_ue}`。 |
| `parser_config`      | Object         | _选填。_ 透传给解析器脚本的自定义参数对象。                                                                                                                                                                                     |
| `sort_by_list_order` | Boolean        | _选填。_ 是否强制按照原始列表页的顺序输出 RSS。默认为 `false`，即按发布时间排序推断（若缺少发布时间，则退化为按抓取时间排序）。                                                                                                 |

### 🛠 自定义解析器开发

如果需要增加新的网站支持，请在 `src/utils/parsers/` 目录下创建一个新的 TypeScript 文件，并实现 `Parser` 接口。然后运行：

```bash
npm run predev # 该脚本会自动重新生成 src/utils/parsers/index.ts 注册文件
```

_注：正是因为 RSSFlare 定位于个人使用，本项目并不致力于像 RSSHub 那样收录海量的 parser，也不致力于统一 parser 的代码结构和配置方式。对于有能力将本项目部署到 Cloudflare 上的用户，相信您也一定有能力通过 "vibe coding" (利用 AI) 生成自己所需的专属 parser。项目中已提供了数个解析器作为样例，您可以非常方便地利用 AI 将现有的 RSSHub 路由代码转换为适用于本项目的解析器。_
