/** Number of Unicode code points, not UTF-16 code units. */
export function countCodePoints(value: string): number {
  return [...value].length
}
