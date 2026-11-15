# Sprint 2 实施报告 — CRUD 与来源追踪

- 状态：完成（Sprint 2 验收通过）
- 日期：2026-11-14
- 范围：contracts、validation、errors、repositories、MemoryManager、MemoryApi、版本快照、namespace 隔离、软删除/purge、来源追踪
- 未做：searchMemories、feedback API、Cordis 插件接线、examples；未接入真实 DSH profile；未修改现有插件

## 1. 实际新增/修改文件

~~~text
src/api/contracts.ts
src/api/errors.ts
src/api/validation.ts
src/api/memory-api.ts
src/core/memory-manager.ts
src/core/source-service.ts
src/repositories/rows.ts
src/repositories/memory-repository.ts
src/repositories/source-repository.ts
src/utils/ids.ts
src/utils/json.ts
src/index.ts
src/storage/sqlite-errors.ts
tests/integration/memory-api.test.mjs
package.json / package-lock.json（zod 4.4.3 + 测试脚本）
API_REFERENCE.md / IMPLEMENTATION_PLAN.md / README.md / ARCHITECTURE.md / docs/SPRINT2_REPORT.md
~~~

生成但未提交：lib/（tsc 输出）、node_modules/（本地依赖）、.tmp/（临时脚本与缓存）。

## 2. 已实现行为

- 身份：所有读写按 (namespaceId, id) 复合定位；同一 id 可存在于不同 namespace。
- 创建：UUID 可由调用方提供；同 namespace 重复 -> DUPLICATE_ID；working 必须有未来 expiresAt；默认 candidate。
- 读取：getMemory 不存在/跨 namespace 返回 null，不泄露存在性；includeDeleted 可读软删除审计视图。
- 列表：namespace 过滤，status 默认 ['active']；支持 type/origin/source/expiry/分页；includeExpired 显式读取过期项。
- 更新：expectedVersion 乐观并发；只允许 content 字段（type/title/content/tags/confidence/metadata/expiresAt）；不允许改 status/confirmedAt/deletedAt/origin/id/version；保存版本快照。
- 删除：deleteMemory 只软删除，status=deleted、deleted_at、version++、快照；已删除 -> MEMORY_DELETED。
- 永久删除：purgeMemory 需 expectedVersion + confirmationToken=PURGE:<namespaceId>:<memoryId>；级联删除 versions/sources 关联；共享 source 保留，autoCreated 孤儿清理。
- 来源：sources 按 (namespace, type, externalRef) 去重；memory_sources 记录 origin/corroborates/contradicts；已关联幂等返回。
- 错误：MemoryError 稳定 code；toMemoryError 不透传 SQL/驱动 message；输入校验错误 details 只含 field/reason。
- 校验：zod 严格对象；metadata 深度/循环/危险键（__proto__/constructor/prototype）在解析前拒绝；SQL 全部参数化。

## 3. 真实测试结果

命令：

~~~bash
npm run typecheck
npm run build
npm test
npm run test:coverage
~~~

结果（2026-11-14）：

~~~text
typecheck: exit 0
build: exit 0
node --test:
  tests 23
  pass 23
  fail 0
  duration_ms ~171
~~~

测试矩阵：

| 需求 | 用例 |
| --- | --- |
| 初始化 | Sprint 1 database.test.mjs：表/索引/触发器/pragmas |
| CRUD | creates/reads/lists/updates/versions |
| 外键完整性 | Sprint 1 + source 复合关联 |
| 关键词搜索 | Sprint 3（未实现，FTS 表已在 Sprint 1 建立） |
| 重复 ID | 同 namespace DUPLICATE_ID；跨 namespace 可复用 |
| 状态迁移 | candidate/active 创建、软删除、MEMORY_DELETED、purge |
| 用户反馈 | Sprint 3（表与约束已就绪，API 未实现） |
| 重启持久化 | close/reopen 后 memory/version/source 可读 |
| 迁移 | Sprint 1 六项迁移测试 |
| 非法输入/SQL 注入 | 严格校验、危险键、注入字符串入库后表结构完好 |
| 删除清理 | 软删除保留审计；purge 清理 memory/versions/memory_sources/sources |
| 事务回滚 | 约束失败时无半条 memory/version/source |

边界用例还包括：working 缺 expiresAt、过期过滤、版本冲突、跨 namespace get/update/delete/purge、来源去重与孤儿清理、错误映射不泄漏驱动文本。

## 4. 覆盖率

~~~text
all files: lines 93.84%, branches 80.86%, funcs 93.20%
lib/api/errors.js:        lines 88.10%, funcs 84.62%
lib/api/memory-api.js:    lines 92.25%, funcs 93.75%
lib/api/validation.js:    lines 93.56%, funcs 92.31%
lib/core/memory-manager.js: lines 91.25%, funcs 100.00%
lib/core/source-service.js: lines 100.00%, funcs 100.00%
lib/repositories/memory-repository.js: lines 100.00%, funcs 100.00%
lib/repositories/source-repository.js: lines 94.34%, funcs 90.91%
~~~

核心服务行/函数覆盖率 >= 80% 达标。分支覆盖率仍偏低的是 storage（sqlite-store 53.23%、sqlite-errors 70.00%）与 api/validation 78.13%；Sprint 3 补搜索/反馈时一并提升。

## 5. 决策与契约修正

- getMemory 对不存在/跨 namespace 返回 null（API_REFERENCE 3.2 既定行为），避免通过错误差异泄露存在性；update/delete/purge 仍返回 NOT_FOUND。IMPLEMENTATION_PLAN 的旧表述已同步修正。
- updateMemory 不接受 status 等生命周期字段，状态只由创建初始值、feedback（Sprint 3）、delete/purge 改变（ADR 0009）。
- tags 的 tags_text 实际存 JSON 数组字符串，DTO 解析回数组；API_REFERENCE 已修正。
- 输入校验在 zod 解析前做危险键扫描，因为 z.record 会静默丢弃 __proto__，仅靠 zod 无法拒绝该类 payload。

## 6. 已知限制与风险

- searchMemories 与 feedback API 未实现，Sprint 3 交付；当前 FTS 表/触发器已在 Schema 中。
- Cordis Service（ctx.memoryCore）尚未接线，Sprint 4 做真实 mount 验证；当前仅库工厂可用。
- node:sqlite 仍标记 Experimental；Node 22.22 本机测试通过，Electron 宿主未在本 Sprint 重新跑 mount。
- npm 安装曾受网络阻塞；当前 node_modules、package-lock 已就绪，但换机首次 npm install 仍有网络风险。
- Windows 路径/权限未实测；备份加密与保留策略仍待产品确认。
- 覆盖率分支偏低（storage/validation），不代表当前验收失败，但 Sprint 3 需补。

## 7. 下一步

Sprint 3：FTS5 trigram + <3 字符 LIKE 回退、searchMemories、submitFeedback/getFeedbackHistory、反馈幂等、过期/删除清理、10k 基准；目标核心行/函数 >=85%。之后 Sprint 4：Cordis 插件接线、真实 mount、示例与发布检查。
