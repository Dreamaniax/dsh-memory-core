# Sprint 1 实施报告 — SQLite Foundation

- 状态：完成（Sprint 1 验收通过）
- 日期：2026-11-14
- 范围：SqliteStore、迁移 runner、001 Schema、备份、健康检查、基础测试
- 未做：CRUD API、搜索、反馈、Cordis 插件、examples；未接入真实 DSH profile；未修改现有插件

## 1. 实际新增/修改文件

~~~text
package.json
package-lock.json
tsconfig.json
tsconfig.build.json
.gitignore
src/index.ts
src/storage/constants.ts
src/storage/sqlite-errors.ts
src/storage/migrations.ts
src/storage/sqlite-store.ts
src/utils/clock.ts
src/utils/fs.ts
migrations/001_initial.sql
tests/helpers/temp-dir.mjs
tests/integration/database.test.mjs
tests/integration/migrations.test.mjs
~~~

生成但未提交：lib/（tsc 输出）、node_modules/（本地依赖）、.tmp/（调查/缓存）。

## 2. 构建与测试命令

~~~bash
export npm_config_cache="$PWD/.tmp/npm-cache"
npm run typecheck
npm test
npm run test:coverage
~~~

## 3. 真实结果

### typecheck

~~~text
> dsh-memory-core@0.1.0 typecheck
> tsc -p tsconfig.json --noEmit
exit 0
~~~

### npm test

~~~text
build: tsc -p tsconfig.build.json（exit 0）
node --test tests/integration/database.test.mjs tests/integration/migrations.test.mjs
tests 13
pass 13
fail 0
duration_ms ~105
~~~

测试覆盖：

- 初始化：表/索引/触发器/application_id/user_version/foreign_keys/WAL。
- 身份：同一 id 在 ns1/ns2 可共存；同 ns 重复 id 被拒绝。
- 约束：working 缺 expires_at 被 CHECK 拒绝；跨 namespace memory_sources 被复合外键拒绝。
- 事务：失败回滚；嵌套事务拒绝。
- FTS：中文 trigram 查询；VACUUM 后仍可查询；更新后旧词消失/新词命中。
- 备份：backup() 生成可读副本；副本查询成功。
- 关闭：幂等；关闭后调用返回 CLOSED。
- 迁移：0->2 应用；checksum 不一致拒绝；失败迁移回滚到 v1；未来版本拒绝；外来 application_id 拒绝；升级前自动备份。

### 覆盖率

~~~text
all files: lines 91.96%, branches 75.25%, funcs 92.55%
lib/storage/migrations.js: lines 87.42%, branches 77.42%, funcs 100%
lib/storage/sqlite-store.js: lines 82.89%, branches 52.46%, funcs 86.36%
lib/storage/sqlite-errors.js: lines 66.67%, branches 66.67%, funcs 75.00%
~~~

说明：这是 Sprint 1 foundation 的覆盖率，不是最终核心服务覆盖率；Sprint 2/3 会增加 API/错误分支测试，Sprint 4 再按 >=85% 的目标复核。当前 core storage 的 line 覆盖接近但未全部达到 85%（sqlite-store 82.89%），不把它说成已达标。

## 4. 依赖安装异常与处理

- npm 解析器在 @types/node 请求上多次 ETIMEDOUT（直接源与镜像均出现）；HTTP 对 registry 正常。
- 处理：手动下载 npm tarball 并解包 typescript 5.9.3、@types/node 24.19.2、undici-types 7.24.6 到 node_modules；用 node_modules/.bin/tsc 构建。
- 影响：本次本地构建/测试可复现；package.json 仍锁定精确版本。package-lock.json 已生成（lockfileVersion 3，含 typescript/@types/node/undici-types）；正常网络下仍建议执行一次 npm ci 复验。
- 未把 node_modules 或 tarball 写入仓库。

## 5. 验收结论

- SQLite Store 可初始化、持久化、关闭/重开。
- 迁移 runner 可升级、校验 checksum、失败回滚、拒绝未来版本/外来库。
- 001 Schema 的六表/索引/触发器/FTS 可用；fts_rowid 在 VACUUM 后稳定。
- 备份可在线生成并验证。
- 所有测试数据库位于系统临时目录；未触碰真实 DSH profile。
- 剩余风险：node:sqlite experimental；npm 网络/锁文件；覆盖率分支尚未达标；Windows 未实测。

## 6. 下一阶段建议

进入 Sprint 2：contracts/validation/errors、repositories、MemoryManager、create/get/list/update/delete/purge、来源服务；继续使用临时 DB；在 Sprint 2 结束前把核心覆盖率补到 >=85%，并补 npm install/lockfile 验证。