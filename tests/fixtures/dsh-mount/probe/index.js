import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'dsh-memory-core-probe'
export const inject = ['memoryCore']

function writeEvidence(dir, phase, value) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, phase + '.json'), JSON.stringify(value, null, 2) + '\n')
}

function memoryStatus(memory) {
  return memory ? memory.status : null
}

async function run(ctx, phase, dir) {
  const startedAt = new Date().toISOString()
  try {
    const api = ctx.memoryCore
    if (!api) throw new Error('ctx.memoryCore is missing')
    const healthBefore = await api.healthCheck()
    let memory
    if (phase === 'write') {
      memory = await api.createMemory({
        namespaceId: 'mount-probe',
        type: 'semantic',
        title: 'Mount probe alpha',
        content: 'The DSH mount probe verifies durable memory across a restart. alpha bravo charlie.',
        tags: ['mount', 'probe'],
        metadata: { phase: 'write' },
        status: 'candidate',
      })
      const feedback = await api.submitFeedback({
        namespaceId: 'mount-probe',
        memoryId: memory.id,
        action: 'confirm',
        requestId: 'mount-probe-confirm',
        expectedVersion: memory.version,
        actor: 'dsh-boot-verify',
      })
      if (!feedback.memory || feedback.memory.status !== 'active') {
        throw new Error('feedback did not activate the probe memory')
      }
    } else {
      const prior = JSON.parse(readFileSync(join(dir, 'write.json'), 'utf8'))
      if (!prior.ok || !prior.memoryId) throw new Error('prior write evidence is missing or failed')
      memory = await api.getMemory({ namespaceId: 'mount-probe', memoryId: prior.memoryId })
      if (!memory || memory.id !== prior.memoryId) throw new Error('memory did not persist across restart')
    }

    const fetched = await api.getMemory({ namespaceId: 'mount-probe', memoryId: memory.id })
    const hits = await api.searchMemories({ namespaceId: 'mount-probe', query: 'mount probe', statuses: ['active'] })
    const history = await api.getFeedbackHistory({ namespaceId: 'mount-probe', memoryId: memory.id })
    const healthAfter = await api.healthCheck()
    const closedBefore = await api.close().then(() => true, () => false)
    let closedRejected = false
    try {
      await api.getMemory({ namespaceId: 'mount-probe', memoryId: memory.id })
    } catch {
      closedRejected = true
    }

    writeEvidence(dir, phase, {
      phase,
      startedAt,
      ok: fetched !== null
        && hits.items.some((hit) => hit.memory.id === memory.id)
        && history.total >= 1
        && healthBefore.ok
        && healthAfter.ok
        && closedBefore
        && closedRejected,
      service: 'memoryCore',
      memoryId: memory.id,
      status: memoryStatus(fetched),
      hits: hits.items.length,
      feedbackTotal: history.total,
      healthBefore,
      healthAfter,
      closedBefore,
      closedRejected,
    })
  } catch (error) {
    writeEvidence(dir, phase, {
      phase,
      startedAt,
      ok: false,
      error: String(error),
      stack: error && error.stack ? error.stack : null,
    })
  }
}

export function apply(ctx) {
  const phase = process.env.MEMORY_CORE_PROBE_PHASE || 'write'
  const dir = process.env.MEMORY_CORE_PROBE_DIR
  if (!dir) throw new Error('MEMORY_CORE_PROBE_DIR is required')
  ctx.effect(() => {
    run(ctx, phase, dir).catch((error) => {
      writeEvidence(dir, phase, { phase, ok: false, error: String(error) })
    })
    return () => {}
  }, 'memory-core-probe.run')
}
