# Phase 0 证据日志

本文件记录 Phase 0 的关键命令与实测输出摘要。完整原始输出可按命令复现。

## 1. 环境

~~~text
$ node --version
v22.22.0
$ npm --version
10.9.4
$ python3 --version
Python 3.9.6
$ sqlite3 --version
3.54.0 2026-04-09 ...
~~~

DSH 桌面版：

~~~text
$ cat "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/runtime.json"
{
  "desktopVersion": "0.2.2-rc.3",
  "platform": "darwin",
  "arch": "arm64",
  "node": "24.21.0",
  "pnpm": "11.28.5"
}
~~~

## 2. Electron / node:sqlite

~~~text
$ ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" -e "..."
{"node":"24.21.0","electron":"44.7.0","modules":"149"}
fts5 rows 1
sqlite version 3.53.4
~~~

node:sqlite 导出：

~~~text
DatabaseSync,Session,StatementSync,backup,constants
~~~

## 3. FTS5 中文/英文行为

测试文本：

- “每周复盘：用户希望把重复劳动沉淀成技能，周五自动生成周报。”
- “Prompt optimizer evaluates system prompts with rubric feedback.”

结果：

~~~text
UNICODE61 VOCAB: ["evaluates","feedback","optimizer","prompt","prompts","rubric","system","with","另一个命名空间的复盘","周五自动生成周报","已删除的复盘内容不应该被搜索到","每周复盘","用户希望把重复劳动沉淀成技能"]
uni 2char []            # unicode61 查“复盘”不命中
uni 4char [{"id":"1"}]  # unicode61 查“每周复盘”命中
tri 2char []            # trigram 查“复盘”不命中（<3 字符）
tri 3char [{"id":"1"}]  # trigram 查“每周复”命中
tri 4char [{"id":"1"}]  # trigram 查“每周复盘”命中
tri english [{"id":"2"}] # trigram 查“optimizer”命中
LIKE fallback 2char: ["1"] # LIKE 查“复盘”命中
~~~

更新触发器：

~~~text
before 重复劳动: [{"id":"a","s":"用户希望把[重复劳动]沉淀成技能，周五自动生成周…"}]
after 重复劳动: []
after 全新的内容: [{"id":"a","s":"[全新的内容]，已经不再包含旧词。"}]
FTS integrity ok
~~~

## 4. SQLite 能力

~~~text
VACUUM INTO ok: true backup rows 4
backup() ok true
rows 1
integrity: {"integrity_check":"ok"}
fts integrity-check ok
~~~

复合外键：

~~~text
composite fk rows 1
cross-ns blocked ERR_SQLITE_ERROR
cascade rows 0
json { v: 1, b: 0 }
~~~

## 5. 插件架构证据

- dsh-app-boot/src/index.ts：
  - boot() 中 const ctx = new Context()
  - ctx.provide('dshHomePath', dshHomePath)
  - await ctx.plugin(Loader)
  - mountRootInclude 加载整棵插件树
- dsh-home-paths/src/index.ts：
  - DSH_HOME 优先，默认 ~/.dsh
  - dshHomePath(...segments)
- dsh-base/cordis.patch.yml：
  - storage-json root: dshHomePath('storages')
  - storage-domain backend: json
- dsh-session-query-sqlite/src/index.ts：
  - class 继承 Service
  - static Config 使用 schemastery
  - Service.init 中 await 打开 SQLite
  - ctx.effect 中 close
  - schema.ts 使用 node:sqlite、application_id、user_version、STRICT、FTS5 unicode61
- dsh-storage-domain/README.md：
  - KV 域，无跨表事务/二级索引；不适合 canonical relational memory

## 6. 包/工具链

~~~text
npm view typescript@5.9 version -> 5.9.3
npm view @types/node@24 version -> 24.19.2
zod 4.4.3 (host)
@deepseek-ai/schemastery 3.18.5 (host)
~~~

npm 默认缓存目录在沙箱下不可写；开发时使用：

~~~bash
export npm_config_cache="$PWD/.tmp/npm-cache"
~~~

## 7. 未验证项（Phase 0 时点）

- ~~自定义插件在真实 DSH profile 中的挂载（Sprint 4）~~：Sprint 4 已在隔离 DSH_HOME 中完成真实挂载；未安装到真实 profile。
- Windows/macOS 以外的平台。
- ~~10k 性能基准（Sprint 3）~~：Sprint 3 已完成 10k 基准。
- 多宿主进程并发写（设计覆盖，Sprint 1/3 测试）。
- 中文分词/双索引（v0.2）。

## 8. Schema DDL 可执行性验证

2026-11-14 将 DATABASE_SCHEMA.md 第 3 节 DDL 抽出，在临时 SQLite 库中执行：

~~~text
DDL ok
insert ok
fts match [{"id":"11111111-1111-4111-8111-111111111111"}]
cross-ns blocked
feedback update blocked
visible after soft delete 0
cascade counts {"versions":0,"links":0,"feedback":0,"fts":0}
fts integrity ok
~~~

验证覆盖：六表/索引/触发器创建、FTS trigram 查询、复合外键跨 namespace 拒绝、feedback append-only UPDATE 拒绝、软删除后检索排除、级联删除（最终语义为 purgeMemory）、FTS integrity-check。