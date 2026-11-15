import type { MemoryApi } from '../src/api/memory-api.js'

export interface Fiber {
  dispose(): void | Promise<void>
}

export interface Logger {
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

export interface Context {
  effect(setup: () => void | (() => void | Promise<void>), label?: string): Fiber
  logger?: Logger
  memoryCore: MemoryApi
}

export abstract class Service<T = never> {
  static readonly init: unique symbol
  static readonly check: unique symbol
  protected constructor(ctx: Context, name: string)
}
