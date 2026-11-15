export interface Schema<T = unknown> {
  default(value: T): Schema<T>
}

export interface StringSchema extends Schema<string> {
  min(value: number): StringSchema
  max(value: number): StringSchema
}

export interface NumberSchema extends Schema<number> {
  step(value: number): NumberSchema
  min(value: number): NumberSchema
  max(value: number): NumberSchema
}

export interface BooleanSchema extends Schema<boolean> {}

export interface UnionSchema extends Schema<string> {}

export interface Z {
  string(): StringSchema
  number(): NumberSchema
  boolean(): BooleanSchema
  union(values: readonly string[]): UnionSchema
  object(shape: Record<string, unknown>): Schema<Record<string, unknown>>
}

declare const z: Z
export default z
