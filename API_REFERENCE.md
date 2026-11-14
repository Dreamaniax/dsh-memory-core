# DSH Memory Core v0.1 — API Reference / 契约

- 状态：Phase 1 契约收口；Sprint 1 已实现 SQLite/Schema；公共 API 待 Sprint 2
- 传输：进程内 TypeScript API（无 HTTP）；Cordis 服务名 memoryCore
- 身份：**namespace-scoped identity**；一条记忆的身份是 (namespaceId, id)
- 错误：抛出 MemoryError（稳定 code），不使用模糊 null 表示失败
- 关联决策：ADR 0008（身份作用域）、ADR 0009（状态/删除）

## 1. 类型定义

~~~ts
export type MemoryType = 'working' | 'semantic' | 'episodic' | 'procedural'
export type MemoryStatus = 'candidate' | 'active' | 'flagged' | 'rejected' | 'deleted'
export type ExtractionOrigin = 'direct' | 'inferred' | 'imported'
export type SourceType = 'session' | 'file' | 'url' | 'manual' | 'plugin' | 'import' | 'other'
export type SourceRelation = 'origin' | 'corroborates' | 'contradicts'
export type FeedbackAction = 'confirm' | 'correct' | 'reject' | 'flag'
export type SearchMode = 'fts' | 'like'

export interface Memory {
  id: string                    // 只在 namespaceId 内唯一
  namespaceId: string
  type: MemoryType
  status: MemoryStatus
  origin: ExtractionOrigin
  title: string
  content: string
  tags: string[]
  confidence: number | null      // 模型/抽取置信度，0..1；与用户确认分离
  metadata: Record<string, unknown>
  version: number
  createdAt: string              // ISO 8601 UTC
  updatedAt: string
  expiresAt: string | null
  confirmedAt: string | null     // confirm/correct 反馈设置；用户确认的唯一标记
  deletedAt: string | null
  isExpired: boolean             // 计算字段，不写入 status
}

export interface Source {
  id: string                    // 只在 namespaceId 内唯一
  namespaceId: string
  type: SourceType
  externalRef: string | null
  title: string
  metadata: Record<string, unknown>
  autoCreated: boolean
  createdAt: string
  relation?: SourceRelation     // getSources 返回时附带
}

export interface Feedback {
  id: string                    // 只在 namespaceId 内唯一
  namespaceId: string
  memoryId: string
  action: FeedbackAction
  requestId: string
  requestHash: string           // 规范化 payload 的 SHA-256；用于幂等比较
  expectedVersion: number | null
  appliedVersion: number
  comment: string | null
  patch: Record<string, unknown> | null
  metadata: Record<string, unknown>
  actor: string | null
  createdAt: string
}

export interface SearchHit {
  memory: Memory
  score: number | null          // FTS: -bm25，越高越相关；LIKE: null
  matchedBy: SearchMode
  snippet: string
}

export interface Page<T> {
  items: T[]
  limit: number
  offset: number
  total: number
  hasMore: boolean
}

export interface MemoryVersion {
  namespaceId: string
  memoryId: string
  version: number               // (namespaceId, memoryId, version) 唯一
  changeType: 'create' | 'update' | 'delete' | 'confirm' | 'correct' | 'reject' | 'flag'
  changeReason: string | null
  changedBy: string | null
  contentHash: string
  createdAt: string
  snapshot: Omit<Memory, 'isExpired'>
}

export interface BackupResult {
  path: string
  bytes: number
  integrity: 'ok'
  createdAt: string
}

export interface HealthReport {
  ok: boolean
  schemaVersion: number
  applicationId: number
  journalMode: string
  foreignKeys: boolean
  integrityCheck: string
  foreignKeyViolations: number
  ftsIntegrityCheck: 'ok' | 'error'
  checkedAt: string
}
~~~

## 2. 输入类型

~~~ts
export interface CreateMemoryInput {
  id?: string                    // 可选；只在 namespaceId 内唯一；重复 -> DUPLICATE_ID
  namespaceId: string
  type: MemoryType
  title?: string
  content: string
  tags?: string[]
  confidence?: number | null
  origin?: ExtractionOrigin      // 默认 direct
  status?: 'candidate' | 'active' // 默认 candidate
  metadata?: Record<string, unknown>
  expiresAt?: string | null       // working 必填
  sources?: CreateSourceInput[]
}

export interface CreateSourceInput {
  type: SourceType
  externalRef?: string | null
  title?: string
  metadata?: Record<string, unknown>
  relation?: SourceRelation      // 默认 origin
}

export interface GetMemoryInput {
  namespaceId: string
  memoryId: string
  includeDeleted?: boolean       // 默认 false；特权/管理用途
}

export interface ListMemoriesInput {
  namespaceId: string
  types?: MemoryType[]
  statuses?: MemoryStatus[]      // 默认 ['active']；显式可查 candidate/flagged/rejected
  origins?: ExtractionOrigin[]
  sourceId?: string
  includeDeleted?: boolean       // 默认 false；特权/管理用途
  includeExpired?: boolean       // 默认 false
  limit?: number                 // 1..100，默认 20
  offset?: number                // >= 0，默认 0
  orderBy?: 'createdAt' | 'updatedAt'
  order?: 'asc' | 'desc'         // 默认 desc
}

export interface UpdateMemoryInput {
  namespaceId: string
  memoryId: string
  expectedVersion: number
  patch: {
    type?: MemoryType
    title?: string
    content?: string
    tags?: string[]
    confidence?: number | null
    metadata?: Record<string, unknown>
    expiresAt?: string | null
  }                              // 不能改 status/confirmedAt/deletedAt/origin/id
  changeReason?: string
  changedBy?: string
}

export interface DeleteMemoryInput {
  namespaceId: string
  memoryId: string
  expectedVersion: number        // 软删除也要求，避免误删新版本
  reason?: string
}

export interface PurgeMemoryInput {
  namespaceId: string
  memoryId: string
  expectedVersion: number
  confirmationToken: string      // 必须等于 PURGE:<namespaceId>:<memoryId>
  reason?: string
}

export interface SearchMemoriesInput {
  namespaceId: string
  query: string
  types?: MemoryType[]
  statuses?: Array<'candidate' | 'active' | 'flagged'> // 默认 ['active']
  limit?: number                 // 1..100，默认 20
  offset?: number
  snippetChars?: number          // 32..500，默认 160
}

export interface AddSourceInput {
  namespaceId: string
  memoryId: string
  source: CreateSourceInput
}

export interface GetSourcesInput {
  namespaceId: string
  memoryId: string
}

export interface SubmitFeedbackInput {
  namespaceId: string
  memoryId: string
  action: FeedbackAction
  requestId: string              // 1..128；同一 (namespace, requestId) 幂等
  expectedVersion: number        // 新请求必须匹配；重复 requestId 先返回原结果
  comment?: string
  patch?: {                      // correct 必填；其他 action 禁止
    title?: string
    content?: string
    tags?: string[]
    confidence?: number | null
    metadata?: Record<string, unknown>
    expiresAt?: string | null
  }
  metadata?: Record<string, unknown>
  actor?: string
}

export interface GetFeedbackHistoryInput {
  namespaceId: string
  memoryId: string
  limit?: number
  offset?: number
}

export interface GetMemoryVersionsInput {
  namespaceId: string
  memoryId: string
  limit?: number
  offset?: number
}

export interface FeedbackResult {
  feedback: Feedback
  memory: Memory
  duplicate: boolean
}
~~~

## 3. 方法契约

| 方法 | 成功返回 | 关键失败 |
| --- | --- | --- |
| createMemory | Memory | INVALID_ARGUMENT, DUPLICATE_ID, STORAGE_BUSY/ERROR |
| getMemory | Memory 或 null | INVALID_ARGUMENT |
| listMemories | Page<Memory> | INVALID_ARGUMENT |
| updateMemory | Memory | NOT_FOUND, VERSION_CONFLICT, INVALID_ARGUMENT |
| deleteMemory | void（软删除） | NOT_FOUND, VERSION_CONFLICT, MEMORY_DELETED |
| purgeMemory | void（永久删除） | NOT_FOUND, VERSION_CONFLICT, CONFIRMATION_REQUIRED |
| searchMemories | Page<SearchHit> | INVALID_ARGUMENT, STORAGE_BUSY/ERROR |
| addSource | Source | NOT_FOUND, INVALID_ARGUMENT, NAMESPACE_MISMATCH |
| getSources | Source[] | NOT_FOUND |
| submitFeedback | FeedbackResult | NOT_FOUND, VERSION_CONFLICT, MEMORY_DELETED, IDEMPOTENCY_CONFLICT, INVALID_STATE_TRANSITION |
| getFeedbackHistory | Page<Feedback> | NOT_FOUND |
| getMemoryVersions | Page<MemoryVersion> | NOT_FOUND |
| backupTo | BackupResult | INVALID_ARGUMENT, STORAGE_ERROR |
| healthCheck | HealthReport | STORAGE_ERROR/CORRUPT_DATABASE |
| close | void | 无（幂等） |

### 3.1 createMemory

规则：

- 身份是 (namespaceId, id)。id 省略时由 crypto.randomUUID() 生成；提供时只在同一 namespace 内查重。
- 同一 id 在另一个 namespace 可以存在；跨 namespace 不冲突。
- 同一 namespace 重复 id -> DUPLICATE_ID；v0.1 不做“相同 payload 幂等返回”。
- status 默认 candidate；只允许 candidate/active；working 必须提供 expiresAt。
- origin 默认 direct；title 默认空串；content 必填，1..100000 字符（默认上限，可配置）。
- tags 最多 32 个，每个 1..64；存为空格拼接的 tags_text，DTO 解析回数组。
- confidence 为 0..1 或 null；与 confirmedAt 独立。
- metadata 必须可 JSON 序列化，序列化后 <= 16KB。
- expiresAt 为 ISO UTC 或 null；必须晚于 createdAt。
- sources 在同一事务内创建/复用并关联；externalRef 去重键为 (namespace, type, externalRef)。
- 返回 Memory，version=1，createdAt/updatedAt 相同。

### 3.2 getMemory

- 默认不返回 deleted；includeDeleted=true 才返回。
- 返回任何非 deleted 状态，包括 expired；isExpired 为计算值。
- namespace 不匹配或不存在返回 null（不泄露存在性）。

### 3.3 listMemories

- 默认 statuses=['active']，includeExpired=false；只返回 active 且未过期。
- 显式 statuses 可查 candidate/flagged/rejected；deleted 只能通过 includeDeleted=true。
- includeDeleted=true 需要管理/特权调用方；普通消费者不应使用。
- sourceId 过滤通过 memory_sources 存在性。
- 排序白名单：createdAt/updatedAt + asc/desc；默认 updatedAt desc。
- 分页返回 total 与 hasMore；offset 分页 v0.1 固定，未来可加 cursor。

### 3.4 updateMemory

- expectedVersion 必填；与当前 version 不等 -> VERSION_CONFLICT（details: expectedVersion/actualVersion）。
- patch 至少一个字段；不允许 status/confirmedAt/deletedAt/origin/id/namespace/version。
- 允许修改 type/title/content/tags/confidence/metadata/expiresAt。
- 如果 type=working，expiresAt 必须非空；如果改为 semantic/episodic/procedural，可保留或清除 expiresAt。
- 不允许通过 update 让 candidate 进入 active；状态变更必须走 submitFeedback(confirm) 或 delete/purge。
- 内容/字段变化时写 memory_versions（change_type=update）；FTS 触发器同步。
- metadata/tags 为整体替换，不是深合并。
- 返回新 Memory。

### 3.5 deleteMemory（软删除）

- 只做软删除：status=deleted、deletedAt=now、version++、写版本快照；保留 versions/sources/feedback。
- expectedVersion 必填；不匹配 -> VERSION_CONFLICT。
- 已删除 -> MEMORY_DELETED；不存在/跨 namespace -> NOT_FOUND。
- 返回 void。
- 不提供 mode/confirm；永久删除必须调用 purgeMemory。

### 3.6 purgeMemory（永久删除，特权）

- 要求 expectedVersion 匹配当前版本。
- confirmationToken 必须等于 PURGE:<namespaceId>:<memoryId>；否则 CONFIRMATION_REQUIRED。
- 物理删除 memory_items；级联 versions/memory_sources/memory_feedback；清理 autoCreated 且无其他引用的 sources；保留共享 sources。
- 不写版本；不可恢复；备份可能仍含数据。
- 不在普通消费者能力中；由宿主/管理代码显式调用。
- 返回 void。

### 3.7 searchMemories

- query 去首尾空白、压缩连续空白；1..500 字符；拒绝 NUL。
- statuses 只允许 candidate/active/flagged；默认 ['active']；rejected/deleted/expired 永不返回。
- 查询长度（Unicode code points）< 3，或任一词 < 3 字符 -> LIKE 回退；否则 FTS trigram。
- FTS：每个空白分隔词作为带引号 phrase，AND 连接；BM25 权重 title 5.0/content 1.0/tags 2.0；score = -bm25。
- LIKE：转义 %/_/\，按 updatedAt desc；matchedBy='like'，score=null。
- 返回 snippet（去标记纯文本，长度受 snippetChars 限制）。
- 分页与 total 同 list。

### 3.8 addSource / getSources

- addSource：memory 必须存在且未删除；source 在 namespace 内按 (type, externalRef) 去重；已关联则幂等返回；新来源 autoCreated=false。
- getSources：返回关联来源，按 memory_sources.created_at asc；带 relation。
- 跨 namespace 的 sourceId/memoryId 组合由复合外键 + 应用校验共同拒绝。
- SourceRelation 仅允许 origin/corroborates/contradicts；未来 memory-to-memory 关系使用独立表，不复用本字段。

### 3.9 submitFeedback

- requestId 必填；expectedVersion 必填。
- 重复 (namespace, requestId)：
  - requestHash 相同 -> 返回已有 feedback + 当前 memory，duplicate=true；不重复写、不检查 expectedVersion/state。
  - requestHash 不同 -> IDEMPOTENCY_CONFLICT。
- confirm：candidate/flagged/rejected -> active；设置 confirmedAt=now；如果状态或 confirmedAt 变化则 version++ 并写版本；已 active 且已确认则只追加反馈，appliedVersion=当前版本。
- correct：patch 必填且至少一个字段；应用 patch；设置 status=active、origin=direct、confirmedAt=now；version++；写版本。
- reject：candidate/active/flagged -> rejected；状态变化时 version++；否则只追加反馈。
- flag：candidate/active -> flagged；状态变化时 version++；否则只追加反馈。
- deleted -> MEMORY_DELETED；其他非法迁移 -> INVALID_STATE_TRANSITION。
- 反馈与版本写入同一事务；FTS 随 content 更新同步。
- 返回 feedback、最新 memory、duplicate。

### 3.10 getFeedbackHistory / getMemoryVersions

- 只返回该 namespace + memory 的记录；按 createdAt desc, id/version desc。
- 分页；total。
- 历史不可修改；purge 后随父行消失。

### 3.11 管理方法

- backupTo(path)：绝对路径；父目录创建 0700；临时文件 + rename；integrity_check；返回 bytes。
- healthCheck：integrity_check、foreign_key_check、FTS integrity-check、schema/application_id/PRAGMA 状态。
- close：幂等；活跃事务中抛错（同步驱动无法等待）；关闭后调用返回 CLOSED。

## 4. 错误契约

~~~ts
export type MemoryErrorCode =
  | 'INVALID_ARGUMENT'
  | 'NOT_FOUND'
  | 'DUPLICATE_ID'
  | 'VERSION_CONFLICT'
  | 'INVALID_STATE_TRANSITION'
  | 'IDEMPOTENCY_CONFLICT'
  | 'MEMORY_DELETED'
  | 'CONFIRMATION_REQUIRED'
  | 'NAMESPACE_MISMATCH'
  | 'PAYLOAD_TOO_LARGE'
  | 'STORAGE_BUSY'
  | 'STORAGE_ERROR'
  | 'CORRUPT_DATABASE'
  | 'MIGRATION_FAILED'
  | 'CLOSED'

export class MemoryError extends Error {
  readonly code: MemoryErrorCode
  readonly details?: Record<string, unknown>
  readonly cause?: unknown
}
~~~

规则：

- details 只含结构化元数据（field、expectedVersion、actualVersion、requestId），不含 content/敏感正文。
- 不把原始 SQL、文件绝对路径、底层驱动堆栈直接返回给调用方；日志记录 code + 内部 cause。
- INVALID_ARGUMENT 的 details 含 field/path，便于调用方修正。
- STORAGE_BUSY 表示重试后仍冲突；调用方可退避重试。
- CORRUPT_DATABASE 表示 integrity_check 失败；禁止继续写，提示恢复备份。

## 5. 校验规则

| 字段 | 规则 |
| --- | --- |
| namespaceId | 1..64；^[a-z0-9][a-z0-9._-]*$ |
| id/memoryId | UUID 格式（36 字符）；只在 namespace 内唯一 |
| type | working/semantic/episodic/procedural |
| status（create） | candidate/active |
| status（feedback） | 只由 confirm/correct/reject/flag 驱动 |
| origin | direct/inferred/imported |
| title | <= 1000 字符 |
| content | 1..100000 字符（默认配置） |
| tags | <= 32 个；每个 1..64；去重后保序 |
| confidence | null 或 0..1 |
| metadata | JSON 对象；序列化 <= 16KB |
| expiresAt | ISO UTC；null 或 > createdAt；working 必须非空 |
| query | 1..500 字符；拒绝 NUL |
| requestId | 1..128；^[A-Za-z0-9._:-]+$ |
| comment | <= 10000 字符 |
| limit | 1..100 |
| offset | >= 0 |
| snippetChars | 32..500 |
| expectedVersion | 整数 >= 1 |
| confirmationToken | PURGE:<namespaceId>:<memoryId> |

所有输入对象 strict：未知字段拒绝，避免拼写错误被忽略。

## 6. 状态迁移矩阵

| 当前 \ 操作 | confirm | correct | reject | flag | delete soft | purge |
| --- | --- | --- | --- | --- | --- | --- |
| candidate | active | active | rejected | flagged | deleted | 需 token |
| active | active（无变化） | active | rejected | flagged | deleted | 需 token |
| flagged | active | active | rejected | 不允许 | deleted | 需 token |
| rejected | active | active | 不允许 | 不允许 | deleted | 需 token |
| deleted | 不允许 | 不允许 | 不允许 | 不允许 | 不允许 | 允许（幂等/不存在 NOT_FOUND） |

说明：

- updateMemory 不参与状态迁移。
- createMemory 只能初始 candidate/active。
- rejected 的复活必须通过 confirm/correct，不能通过普通 update。
- deleted 是终态；只有 purge 可物理删除。

## 7. 使用示例

### 7.1 Weekly Retro 写入一条情景记忆

~~~ts
const memory = await core.createMemory({
  namespaceId: 'weekly-retro',
  type: 'episodic',
  title: '2026-W46 周报',
  content: '本周完成 4 个会话，重复劳动集中在周报采集与校验。',
  tags: ['weekly', 'retro', '2026-W46'],
  origin: 'inferred',
  status: 'candidate',
  confidence: 0.72,
  metadata: { week: '2026-W46', sessions: 4 },
  sources: [
    { type: 'session', externalRef: 'session-abc', title: '周报采集会话' },
    { type: 'file', externalRef: '~/.dsh/learning/weekly/2026-W46.md' }
  ]
})
~~~

### 7.2 搜索中文

~~~ts
const page = await core.searchMemories({
  namespaceId: 'weekly-retro',
  query: '复盘',
  statuses: ['active', 'candidate'],
  limit: 20
})
// '复盘' 只有 2 个字符，走 LIKE 回退；matchedBy='like'
~~~

### 7.3 用户确认

~~~ts
const result = await core.submitFeedback({
  namespaceId: 'weekly-retro',
  memoryId: memory.id,
  action: 'confirm',
  requestId: 'confirm-2026-W46-001',
  expectedVersion: memory.version,
  comment: '这条总结准确'
})
// result.duplicate=false；memory.status='active'；confirmedAt 已设置
~~~

### 7.4 修正内容

~~~ts
await core.submitFeedback({
  namespaceId: 'weekly-retro',
  memoryId: memory.id,
  action: 'correct',
  requestId: 'correct-2026-W46-001',
  expectedVersion: memory.version,
  patch: { content: '本周完成 5 个会话，重复劳动集中在周报采集与校验。' },
  comment: '会话数修正'
})
~~~

### 7.5 乐观并发更新

~~~ts
try {
  await core.updateMemory({
    namespaceId: 'weekly-retro',
    memoryId: memory.id,
    expectedVersion: 1,
    patch: { tags: ['weekly', 'retro', '2026-W46', 'reviewed'] }
  })
} catch (error) {
  if (error instanceof MemoryError && error.code === 'VERSION_CONFLICT') {
    // 重新读取后再重试，不盲目覆盖
  }
}
~~~

### 7.6 软删除与永久删除

~~~ts
await core.deleteMemory({
  namespaceId: 'weekly-retro',
  memoryId: memory.id,
  expectedVersion: memory.version,
  reason: '不再需要'
})

await core.purgeMemory({
  namespaceId: 'weekly-retro',
  memoryId: memory.id,
  expectedVersion: memory.version + 1,
  confirmationToken: 'PURGE:weekly-retro:' + memory.id,
  reason: '用户明确要求永久删除'
})
~~~

### 7.7 DSH 插件消费

~~~ts
ctx.inject(['memoryCore'], (ctx) => {
  const memory = ctx.memoryCore
  // memory.createMemory(...)
  // memory.searchMemories(...)
})
~~~

### 7.8 Prompt Optimizer 使用

~~~ts
await core.createMemory({
  namespaceId: 'prompt-optimizer',
  type: 'procedural',
  title: '系统提示词改进规则',
  content: '当 rubric 分数低于阈值时，先减少规则数量，再补充一个反例。',
  origin: 'inferred',
  status: 'candidate',
  confidence: 0.66,
  sources: [{ type: 'plugin', externalRef: 'prompt-optimizer/run-42' }]
})
~~~

## 8. 兼容别名与范围说明

- addMemoryFeedback 是 submitFeedback 的兼容别名。
- archiveMemory 不单独实现；软删除 + status=deleted 覆盖归档语义；可恢复归档在 v0.2 设计。
- deleteMemory 只做软删除；purgeMemory 是独立特权操作。
- v0.1 不提供 HTTP 路由、LLM tool、向量检索、自动抽取、自动巩固。
- namespace 是数据隔离标识，不是认证；多租户场景必须在可信边界做授权。

## 9. 错误到 HTTP/工具层的映射（未来）

- INVALID_ARGUMENT -> 400
- NOT_FOUND -> 404
- VERSION_CONFLICT / INVALID_STATE_TRANSITION / IDEMPOTENCY_CONFLICT -> 409
- CONFIRMATION_REQUIRED / FORBIDDEN -> 403
- STORAGE_BUSY -> 503（可重试）
- STORAGE_ERROR / CORRUPT_DATABASE / MIGRATION_FAILED -> 500
- CLOSED -> 503

在实现 HTTP 前，必须另做认证/授权设计；不得把 namespace 当鉴权。