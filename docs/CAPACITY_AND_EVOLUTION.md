# DSH Memory Core — 容量、压缩与长期演进设计

- 状态：设计稿（v0.1 不实现自动巩固/关系图/归档/向量）
- 日期：2026-11-14
- 关联：DATABASE_SCHEMA.md、IMPLEMENTATION_PLAN.md、ADR 0008/0009
- 重要：本文所有容量数字都是**情景估算**，不是实测；实测基准在 Sprint 3 单独报告。

## 1. 估算假设与公式

### 1.1 参数

| 参数 | 含义 | 低 | 中 | 高 |
| --- | --- | --- | --- | --- |
| D | 每天新增记忆数 | 5 | 30 | 100 |
| C | 平均正文大小（KB，UTF-8） | 0.8 | 1.5 | 3.0 |
| M | 标题/标签/行元数据平均开销（KB） | 0.3 | 0.3 | 0.3 |
| U | 每条记忆的平均版本变更次数（不含 v1） | 1 | 2 | 3 |
| S | 每条记忆平均关联来源数 | 1 | 2 | 3 |
| F | 每条记忆平均反馈事件数 | 0.2 | 0.4 | 1.0 |
| f | FTS trigram 相对正文的膨胀系数 | 2–3 | 2–4 | 3–5 |
| o | SQLite/索引/页开销系数 | 1.25 | 1.30 | 1.35 |
| B | 备份保留份数 | 3 | 3 | 3 |
| W | WAL 峰值（MB，非累计） | 64–128 | 128–256 | 256–512 |

来源元数据按 0.5 KB/条、链接按 0.08 KB/条；反馈按 0.5 KB/条；每个版本快照按 (C+M) 计。年份按 3650 天/10 年。

### 1.2 公式

~~~text
N            = D × 3650
S_current    = N × (C + M)
S_versions   = N × (1 + U) × (C + M)
S_sources    = N × S × (0.5 + 0.08) KB
S_feedback   = N × F × 0.5 KB
S_db         = (S_current + S_versions + S_sources + S_feedback) × o
S_fts        = S_current × f
S_backups    = B × (S_db + S_fts)
S_total      = S_db + S_fts + S_backups + W_peak
~~~

说明：

- 版本快照是最大的隐藏乘数；U 从 1 升到 3，基础库接近翻倍。
- 备份按未压缩副本计；若外部压缩，乘以 0.25–0.5（文本），但恢复更慢。
- WAL 是瞬态/高水位，不是十年累计；不要把 W 加到长期趋势里重复计算。
- 未计入原始证据文件（音频/PDF/长对话）；如果把它们塞进 DB，容量会被正文外的数据主导。

## 2. 十年容量区间（估算）

### 2.1 分类拆解

| 情景 | 当前正文+元数据 | 版本快照 | 来源 | 反馈 | 基础 DB（含索引） | FTS | 3 份备份 | WAL 峰值 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 低 | ~0.02 GB | ~0.04 GB | ~0.01 GB | ~0.002 GB | ~0.09 GB | 0.04–0.06 GB | ~0.4 GB | 0.06–0.13 GB |
| 中 | ~0.20 GB | ~0.59 GB | ~0.13 GB | ~0.02 GB | ~1.2 GB | 0.4–0.8 GB | ~5.0–5.5 GB | 0.13–0.26 GB |
| 高 | ~1.2 GB | ~4.8 GB | ~0.64 GB | ~0.18 GB | ~9.2 GB | 3.6–6.0 GB | ~40–42 GB | 0.25–0.51 GB |

### 2.2 合计区间

| 情景 | N（10 年） | 基础 DB | FTS 索引 | 3 份备份 | WAL 峰值 | 合计区间 |
| --- | --- | --- | --- | --- | --- | --- |
| 低 | 18,250 | ~0.09 GB | ~0.04–0.06 GB | ~0.4 GB | 0.06–0.13 GB | **0.4–0.8 GB** |
| 中 | 109,500 | ~1.2 GB | ~0.4–0.8 GB | ~5.0–5.5 GB | 0.13–0.26 GB | **5–10 GB** |
| 高 | 365,000 | ~9.2 GB | ~3.6–6.0 GB | ~40–42 GB | 0.25–0.51 GB | **45–65 GB** |

结论：

- 低/中情景对本地 SQLite 很轻松；高情景的主要成本不是主库，而是 **3 份未压缩备份** 和 **版本快照**。
- 最敏感参数排序：U（版本）> B（备份份数）> f（FTS）> C（正文）> D（日增）。
- 若高情景启用 zstd 压缩备份 + 版本 delta，合计可降到约 20–35 GB；这是估算，需 Sprint 3 用真实数据验证。
- metadata 上限 16 KB/条在极端情况下会显著放大：高情景若每条都用满，会额外增加数 GB；默认应保持小 metadata。
- 原始证据（excerpt/file）不进主库；只存引用、定位符、哈希和有界摘要。

## 3. 原始证据、情景事件、派生知识

### 3.1 三层

| 层 | 例子 | 存储策略 | 检索 |
| --- | --- | --- | --- |
| 原始证据 | 会话原文、文件片段、URL、消息 | 外部/内容寻址；DB 只存 sources 元数据、locator、hash、可选有界 excerpt | 默认不直接检索；通过派生记忆的来源跳转 |
| 情景事件 | 一次周报、一次任务、一次对话摘要 | episodic memory；引用原始证据 | 可检索；可归档 |
| 派生知识 | 重复模式、技能规则、语义结论 | semantic/procedural memory；引用一条或多条情景/原始证据 | 默认优先检索；必须带来源 |

### 3.2 可追溯规则

1. 派生记忆必须至少有一个来源或 derived_from 端点；没有来源的派生知识只能是 candidate，不能自动 active。
2. 来源链：derived memory → source memory/source row → external_ref/locator/hash。任何一层被归档/删除，检索结果必须标记 provenance incomplete。
3. 版本快照保存“当时”的来源与内容；后续来源变化不篡改历史。
4. 不允许用摘要覆盖原始证据；摘要/巩固只新增记忆和关系。
5. 人类记忆的“巩固/选择性遗忘”只作为设计启发：巩固 = 生成派生知识；遗忘 = 降权/归档/显式删除，不是自动物理清除。

## 4. 压缩与节省对象

| 技术 | 节省磁盘 | 节省上下文 token | 有损 | 关键风险 |
| --- | --- | --- | --- | --- |
| zstd/gzip 快照/来源 excerpt | 是 | 否 | 否 | CPU/恢复延迟；不能直接 FTS |
| 内容哈希去重/版本 delta | 是 | 否 | 否（精确） | 哈希碰撞可忽略；delta 链复杂 |
| 语义巩固（多条→一条派生） | 可能（仅当原记忆归档） | 是 | 是 | 丢细节；必须保留来源与确认 |
| 时间摘要（周/月 rollup） | 可能 | 是 | 是 | 摘要漂移；需引用原事件 |
| 检索上下文压缩（snippet/预算选择） | 否 | 是 | 是（对上下文） | 引用/证据可能被截断 |
| 归档时移出 FTS | 是（索引） | 可能 | 否（数据仍在） | 恢复需重建索引 |
| 原始证据外置 | 是（DB） | 否 | 否 | 总存储不一定下降 |

原则：

- **节省磁盘**和**节省 token**是两条独立目标；不要用“压缩率”单独决定巩固策略。
- 任何有损派生必须保留原始证据指针、版本和用户确认；否则只能 candidate。
- 检索上下文压缩只影响本次 prompt，不改变持久化数据。

## 5. 检索状态：默认不检索 / 可恢复归档 / 永久删除

| 状态 | DB 数据 | FTS | 版本 | 来源/反馈 | 默认检索 | 备份 | 恢复 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 默认可检索 | active 且未过期 | 是 | 保留 | 保留 | 是 | 可能含 | 直接 |
| 降权/抑制 | active 但低优先级 | 是（排序降权） | 保留 | 保留 | 可配置 | 可能含 | 直接 |
| 候选/待确认 | candidate | 是（默认过滤） | 保留 | 保留 | 否 | 可能含 | confirm |
| 软删除 | deleted | 是（默认过滤） | 保留 | 保留 | 否（特权可查） | 可能含 | v0.2 restore |
| 可恢复归档 | 压缩/外置 | 否（移出） | 保留/压缩 | 保留 | 否 | 可能含 | 解压+重建索引 |
| 永久删除 | 无 | 否 | 删除 | 删除/清理 | 否 | 可能仍含 | 不可恢复 |

规则：

- **不得仅因记忆久未使用就自动永久删除。** 年龄只能触发降权/候选归档；purge 必须显式授权。
- 软删除/归档不影响备份；备份保留策略必须单独说明。
- 归档不是删除：来源、版本、审计仍保留；恢复需要重建 FTS。
- purge 是唯一物理删除路径；级联 versions/links/feedback；auto-created 孤儿 source 清理；共享 source 保留。

## 6. 未来关系：derived_from / related_to / supersedes / supports

### 6.1 不在 v0.1 预建

v0.1 只有 memory_sources（source role: origin/corroborates/contradicts），没有 memory-to-memory 关系表。不要在 Sprint 1 预建空关系表；等有真实用例再加。

### 6.2 v0.2 加法迁移

~~~sql
CREATE TABLE memory_relations (
  namespace_id   TEXT NOT NULL,
  from_memory_id TEXT NOT NULL,
  to_memory_id   TEXT NOT NULL,
  relation       TEXT NOT NULL CHECK (relation IN
                   ('derived_from','related_to','supersedes','supports')),
  confidence     REAL CHECK (confidence IS NULL OR (confidence BETWEEN 0 AND 1)),
  created_at     INTEGER NOT NULL,
  created_by     TEXT,
  metadata_json  TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  PRIMARY KEY (namespace_id, from_memory_id, to_memory_id, relation),
  FOREIGN KEY (namespace_id, from_memory_id)
    REFERENCES memory_items (namespace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (namespace_id, to_memory_id)
    REFERENCES memory_items (namespace_id, id) ON DELETE CASCADE
) STRICT;
~~~

- 同 namespace 关系先落地；跨 namespace 关系需要额外 from_namespace_id/to_namespace_id 或 global_uid，另做迁移。
- derived_from：派生 → 证据/来源记忆；要求 DAG（禁止环）；用于 provenance coverage。
- related_to：对称关系；存储时规范化端点顺序，避免重复。
- supersedes：新 → 旧；检索优先新记忆；旧记忆应归档/降权，不自动 purge。
- supports：证据 → 结论；可带 confidence；与 feedback 的 confirm 不同（后者是用户动作）。
- 所有关系写入必须显式；自动抽取/自动巩固 v0.2 只生成 candidate，需用户确认。

### 6.3 迁移与回填

1. v0.2 加表 + 索引；不改动 v0.1 表。
2. 从 memory_sources/metadata 中人工/半自动回填 derived_from；无法确认的留空。
3. supersedes 只能由显式用户/管理操作创建；不从时间顺序推断。
4. related_to 先由人工/规则创建；向量相似度只能作为候选，不直接写入。
5. 每次回填记录 created_by 与 metadata.source；可审计、可回滚。

### 6.4 评测指标

| 指标 | 目标 |
| --- | --- |
| provenance coverage | 派生 active 记忆中带 >=1 条有效来源/derived_from 的比例 |
| citation precision / recall | 检索结果引用是否真的支持结论 |
| retrieval nDCG@k / Recall@k | 关系/巩固前后检索质量不下降 |
| answer groundedness | 基于返回上下文的回答是否有证据支撑 |
| token efficiency | 相同任务下上下文 token 与延迟 |
| storage bytes / backup bytes | 巩固/压缩后的真实磁盘节省 |
| conflict/cycle/orphan rate | supersedes 冲突、derived_from 环、悬空关系比例 |
| confirmation rate | 候选派生被用户 confirm/reject 的比例 |
| archive restore success | 归档恢复后检索/版本/来源完整 |

验收原则：同一数据集 A/B 比较；不以压缩率单独作为通过标准；检索质量下降超过阈值则回滚策略。

## 7. 分阶段演进建议

| 阶段 | 只做什么 | 不做什么 |
| --- | --- | --- |
| v0.1 | SQLite/FTS5、CRUD、来源、反馈、软删除、backup、容量基线 | 自动巩固、关系图、归档、向量 |
| v0.1.x | 存储统计、备份压缩实验、内容哈希去重评估 | 不改检索语义 |
| v0.2 | 可恢复归档、derived_from/supersedes 关系、候选巩固 | 不自动 purge、不自动 active |
| v0.3 | 时间摘要、上下文预算、关系检索 | 不引入向量作为唯一检索 |
| 未来 | 多 agent/多机同步、global_uid、加密/安全擦除 | 不在没有审计的情况下自动遗忘 |

## 8. 结论

- 低/中情景十年容量可控；高情景的瓶颈是版本快照与 3 份备份，不是 SQLite 单库。
- 先做无损压缩/去重/归档，再做有损巩固；有损必须有来源、版本、确认。
- 默认不检索、可恢复归档、永久删除是三种不同状态；年龄不是 purge 理由。
- 关系表 v0.2 再加；先用 memory_sources 保证来源可追溯，不预建空图。
