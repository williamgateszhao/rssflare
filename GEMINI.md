## Testing & Scripting Rules

- **Node 工具执行**：如果需要调用 `wrangler` 或其他通过 npm 安装的命令行工具，**请优先尝试通过 `npx` 运行**（例>如 `npx wrangler ...`），确保使用的是项目对应版本。
- 如果确实需要编写临时代码来验证逻辑或处理复杂数据，**优先使用 JavaScript (Node.js) 而不是 Python**。
- 编写 JS 临时测试文件时，**文件后缀必须使用 `.mjs`**，以确保所有 ES Module 的 `import/export` 语法能被正确执行，避免 CommonJS 报错。
- （可选）测试代码运行完毕并获得结果后，请顺手清理/删除这些临时脚本文件，保持工作区整洁。

## Project Specific Context

RSSFlare 是一个基于 **Cloudflare Workers** 生态构建的零维护、抗超时个人 RSS 聚合服务。在为本项目提供代码建议或进行修改时，请牢记以下架构原则：

- **核心技术栈**：Cloudflare Workers, Hono, Workflows, Queues, D1, R2, KV, TypeScript。
- **无 Docker/传统服务器**：本项目完全 Serverless 化，不要假定或引入 Docker 容器相关的依赖或传统的 Node.js 运行时配置。
- **核心组件职责边界**：
  - **KV**: 仅用于存储轻量级的站点元数据和抓取规则配置（如 `site_index` 和 `site:{id}`）。
  - **R2**: 用于存储最终生成的 RSS XML 文件，规避 KV 写入限制，由 Hono 网关读取并结合 Cache API 提供服务。
  - **D1**: 仅作为 Workflow 步骤间传递大体积数据的“缓存车间”（`articles` 表），专门用于彻底规避 Workflow Payload 1MB 限制。
  - **Queues & Workflows (Master-Sub)**: 采用队列缓冲加上主从工作流事件驱动机制，化整为零，以此突破单实例 50 个 Subrequest 及 CPU 时间等硬性限制。
- **命令行工具**：本地运行、调试或资源管理需依赖 `wrangler` CLI。
