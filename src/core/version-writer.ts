import type { Memory, MemoryChangeType } from '../api/contracts.js'
import type { MemoryRepository } from '../repositories/memory-repository.js'
import { memorySnapshotHash, toMemorySnapshot } from '../repositories/rows.js'
import { canonicalStringify } from '../utils/json.js'

export function writeMemoryVersion(
  memories: MemoryRepository,
  memory: Memory,
  changeType: MemoryChangeType,
  changeReason: string | null,
  changedBy: string | null,
  nowMs: number,
): void {
  const snapshot = toMemorySnapshot(memory)
  memories.insertVersion({
    namespace_id: memory.namespaceId,
    memory_id: memory.id,
    version: memory.version,
    snapshot_json: canonicalStringify(snapshot),
    content_hash: memorySnapshotHash(snapshot),
    change_type: changeType,
    change_reason: changeReason,
    changed_by: changedBy,
    created_at: nowMs,
  })
}
