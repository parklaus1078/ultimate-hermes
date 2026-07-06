export function vectorLiteral(values: number[]): string {
  return `[${values.map((value) => Number(value.toFixed(8))).join(",")}]`;
}

export function normalizeVector(values: number[]): number[] {
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) return values;
  return values.map((value) => value / magnitude);
}
