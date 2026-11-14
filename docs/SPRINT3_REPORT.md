# Sprint 3 实施报告 — 关键词搜索与用户反馈

- 日期：2026-11-15
- 状态：完成
- 范围：FTS5/LIKE 关键词搜索、confirm/correct/reject/flag 反馈、生命周期与索引一致性、10k 基准、Sprint 3 文档
- 不在范围：Cordis 插件、真实 DSH profile 挂载、归档、关系图、自动巩固、向量检索
- 基线：Sprint 2 的 23 项测试；Sprint 3 后 43 项测试

## 1. 本轮交付

### 搜索

- `src/search/query-builder.ts`
  - 规范化查询：去首尾空白、压缩连续空白、拒绝 NUL、空白查询、>500 Unicode code points。
  - 计划选择：总长度 <3 或任一词 <3 code points -> LIKE；否则 FTS。
  - FTS：每个空白分隔词整体加双引号，内部双引号加倍，词间 AND；用户输入不会成为 FTS 操作符。
  - LIKE：转义 `%`、`_`、`\\`，使用 `ESCAPE '\\'`。
  - snippet：纯文本、按 code point 截断、优先正文，其次标题/标签。
- `src/search/keyword-search.ts`
  - FTS 使用 `memory_fts` 与 `memory_items` 的 `fts_rowid` 连接。
  - BM25 权重：title 5.0、content 1.0、tags 2.0；返回 `score = -bm25`。
  - LIKE 查询参数化，按 `updated_at DESC, id DESC` 排序，`score = null`。
  - 过滤：namespace、status、可选 type、未过期（`expires_at IS NULL OR expires_at > now`）。
  - count 与分页共享过滤条件；limit/offset 均参数化。
  - `rebuildIndex()` 执行 FTS5 `rebuild`。
- `src/core/search-service.ts`：校验后的输入 -> 查询计划 -> 索引查询 -> `Page<SearchHit>`；默认 status 为 `['active']`。

### 反馈

- `src/core/feedback-service.ts`
  - 四种 action：confirm / correct / reject / flag。
  - `requestHash = SHA-256(canonical JSON of {namespaceId, memoryId, action, expectedVersion, comment, patch, metadata, actor})`。
  - 重复 `(namespace, requestId)` **先于**版本/状态检查：
    - 相同 hash -> 返回已有 feedback + 当前 memory，`duplicate=true`，不写库；
    - 不同 hash -> `IDEMPOTENCY_CONFLICT`。
  - confirm：candidate/flagged/rejected -> active；设置 `confirmedAt`；状态或确认时间变化才 version++ 并写版本；已 active 且已确认只追加反馈。
  - correct：patch 必填；应用内容字段；status=active、origin=direct、confirmedAt=now；version++ 并写版本。
  - reject：candidate/active/flagged -> rejected；version++ 并写版本；其他状态拒绝。
  - flag：candidate/active -> flagged；version++ 并写版本；其他状态拒绝。
  - 反馈、状态、版本快照在同一事务；工作记忆仍要求未来 expiresAt。
  - 历史查询允许软删除记忆；purge 级联删除反馈。
- `src/repositories/feedback-repository.ts`：按 requestId 查找、追加、按 memory 分页查询（createdAt DESC, id DESC）。
- `src/core/version-writer.ts`：MemoryManager 与 FeedbackService 共用版本快照写入；Sprint 2 的私有 writeVersion 已移除。
- `src/repositories/rows.ts`、`src/api/errors.ts`、`src/repositories/memory-repository.ts`：FeedbackRow/映射、幂等冲突/非法迁移错误、生命周期与内容 correction 更新。
- `src/api/validation.ts`、`src/api/memory-api.ts`：新增三个输入 schema 与 search/feedback/rebuild 方法；`addMemoryFeedback` 作为 `submitFeedback` 兼容别名。

### 测试与基准

- `tests/unit/query-builder.test.mjs`（8）
- `tests/integration/database.test.mjs`（7）
- `tests/integration/migrations.test.mjs`（6）
- `tests/integration/memory-api.test.mjs`（10）
- `tests/integration/search.test.mjs`（5）
- `tests/integration/feedback.test.mjs`（7）
- `benchmarks/10k.mjs`

测试使用 OS 临时目录和临时数据库；没有读写真实 DSH profile，没有修改现有插件。

## 2. 契约与实现决策

1. **不新增迁移。** 001 schema 已包含 `memory_feedback`、`memory_versions`、`memory_fts` 与触发器；Sprint 3 只使用既有结构。
2. **requestHash 包含 expectedVersion。** 同一 requestId 换 expectedVersion 视为 payload 不同，返回 `IDEMPOTENCY_CONFLICT`，避免旧请求在新版本上被误重放。
3. **幂等重放先于状态检查。** 已成功提交的 feedback 不因记忆后来被更新/软删除而变成错误；返回当前 memory 并标记 duplicate。
4. **FTS 输入不作为语法。** 每个词是完全引号化的 phrase；NEAR、`*`、`^`、`:`、OR 等按普通文本处理。
5. **短中文回退。** trigram 对 2 个 CJK code points 不命中，统一走 LIKE；这是已知取舍，不是静默降级。
6. **snippet 在应用层生成。** 不返回 FTS 标记，长度按 code point 限制，避免切半个 surrogate pair。
7. **版本与反馈原子。** 任何改变状态/正文的反馈都与 feedback 行、版本快照同事务；无变化 confirm 只追加反馈。
8. **兼容别名。** `addMemoryFeedback` 委托给 `submitFeedback`，不产生第二套语义。

## 3. 验证证据

### 测试

~~~bash
npm test
~~~

最终直接运行结果：

~~~text
1..43
# tests 43
# pass 43
# fail 0
# duration_ms 239.475833
~~~

一次把 npm 输出整体重定向到文件的组合命令曾返回 7 且没有测试输出；随后直接运行 `npm test` 以及逐文件运行均通过，未能复现该重定向异常。验收以直接运行的 43/43 为准，不把异常重定向日志当作通过证据。

### 类型检查与构建

~~~bash
npm run typecheck
npm run build
~~~

均 exit 0。

### 覆盖率

~~~bash
npm run test:coverage
~~~

~~~text
all files                |  95.75 |    84.79 |   94.63
feedback-service.js      |  94.35 |    89.66 |  100.00
memory-manager.js        |  90.76 |    85.29 |  100.00
search-service.js        | 100.00 |   100.00 |  100.00
source-service.js        | 100.00 |    86.36 |  100.00
version-writer.js        | 100.00 |   100.00 |  100.00
keyword-search.js        | 100.00 |    95.83 |  100.00
query-builder.js         |  93.88 |    86.05 |  100.00
memory-repository.js     | 100.00 |    93.75 |  100.00
feedback-repository.js   | 100.00 |    85.71 |  100.00
rows.js                  |  88.19 |    72.73 |   81.25
~~~

核心 service 的行/函数覆盖率均 >=85%；整体 branches 84.79%，仍低于 85%，主要来自 storage 的防御分支和 rows 的兼容分支。Sprint 3 的验收目标是核心 service 行/函数 >=85%，已满足。

### 10k 基准

命令：

~~~bash
node benchmarks/10k.mjs
~~~

环境：

| 项 | 值 |
| --- | --- |
| 机器 | Apple M4，10 核，24 GB |
| 系统 | macOS 27.2.0 (darwin arm64) |
| Node | 22.22.0 |
| SQLite | 3.53.0 |
| 运行时 | 单进程、同步 API、WAL、synchronous=NORMAL |

数据：

| 项 | 值 |
| --- | --- |
| 记忆数 | 10,000 |
| active / candidate | 7,999 / 2,001 |
| 类型 | semantic 3,000；episodic 3,000；procedural 2,000；working 2,000 |
| 来源 | 3,334 条 memory_sources |
| 版本更新样本 | 400 |
| 反馈样本 | 200（confirm） |
| 正文 | 约 700–1,420 code points/条，中英混合 |

写入与检索延迟：

| 操作 | 样本 | total | mean | p50 | p95 | p99 | max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| createMemory | 10,000 | 6,910.799 ms | 0.691 ms | 0.346 ms | 1.966 ms | 6.800 ms | 16.979 ms |
| updateMemory（样本） | 400 | 244.182 ms | 0.610 ms | 0.336 ms | 1.699 ms | 6.446 ms | 11.942 ms |
| submitFeedback（样本） | 200 | 54.653 ms | 0.273 ms | 0.179 ms | 0.354 ms | 3.957 ms | 4.508 ms |
| searchMemories（混合） | 200 | 1,910.259 ms | 9.551 ms | 6.121 ms | 23.492 ms | 24.607 ms | 25.964 ms |

搜索分类（每类 25 次，limit=20，snippetChars=160）：

| 用例 | 模式 | total | p50 | p95 |
| --- | --- | ---: | ---: | ---: |
| alpha | FTS | 2,054 | 8.336 ms | 10.133 ms |
| alpha bravo | FTS | 411 | 3.206 ms | 4.473 ms |
| 系统设计 | FTS | 1,173 | 4.313 ms | 6.223 ms |
| 知识管理 | FTS | 1,363 | 6.026 ms | 8.929 ms |
| 记忆（2 字） | LIKE | 2,730 | 19.704 ms | 20.719 ms |
| 模型（2 字） | LIKE | 1,029 | 23.463 ms | 25.586 ms |
| memory core | FTS | 925 | 5.625 ms | 6.624 ms |
| retrieval | FTS | 821 | 4.867 ms | 6.245 ms |

存储（close 后读取）：

| 项 | 字节 | 说明 |
| --- | ---: | --- |
| 数据库文件/页总数 | 118,390,784 | 28,904 × 4,096 |
| 主表+索引 | 60,641,280 | dbstat |
| FTS 相关 | 52,445,184 | memory_fts_data 52,232,192；docsize 126,976；idx 81,920；config 4,096 |
| memory_versions | 34,938,880 | 10,400 个版本快照 |
| memory_items | 24,788,992 | 10,000 行 |
| WAL | 0 | close 后 |
| SHM | 32,768 | close 后仍存在 |
| 健康检查 | ok | integrity ok、FK 0 违规、FTS integrity ok |

基准工作负载是**单进程、单写入者、合成数据**；不代表并发写、真实长文本、备份或十年累计。

## 4. 与容量模型的关系

`docs/CAPACITY_AND_EVOLUTION.md` 的十年数字是情景估算；本次是 10k 条、单版本的实测点。

- 实测约 118.4 MB / 10k 条 ≈ 11.8 KB/条（含主表、版本、FTS、索引；不含备份）。
- 线性外推 100k ≈ 1.18 GB、365k ≈ 4.3 GB；这只是同数据分布的线性外推，不是十年预测。容量模型的高情景是 45–65 GB，差异主要来自正文长度（高情景 3 KB/条）、版本次数（U=3）、备份保留 3 份和 FTS 膨胀。
- 本次 FTS 约 52.4 MB，主表 60.6 MB；FTS 与正文/索引的比例高于“低情景”，说明 trigram 在高标签/多语言数据上仍需按 3–5× 预留。
- 版本表 34.9 MB 已接近 memory_items 的 1.4 倍；版本快照仍是比正文更敏感的增长项。

## 5. 未完成 / 下一阶段

- Cordis Service（`memoryCore`）、`./plugin` 入口、`cordis.patch.yml`。
- 隔离 DSH_HOME 的真实挂载验证与探针路由。
- weekly-retro / prompt-optimizer 示例。
- npm pack 内容检查、许可证决策、发布清单。
- 多进程/并发写、Windows、真实长文本、备份恢复演练。
- 可选：FTS 双索引/中文分词；cursor 分页；归档/关系图/自动巩固（v0.2）。

## 6. 验收结论

- 搜索与反馈的 P0 契约已实现，测试覆盖中文 2/3/4 字、英文、混合、过滤、分页、BM25、注入文本、生命周期同步、幂等、回滚、持久化。
- 43/43 测试通过；核心 service 行/函数覆盖率 >=85%；10k 基准输出真实 JSON。
- 本轮没有修改真实 DSH profile，没有新增迁移，没有引入运行时依赖。
- 可进入 Sprint 4；进入公开发布前仍需完成真实挂载验证、包内容检查、许可证和提交历史审计。
