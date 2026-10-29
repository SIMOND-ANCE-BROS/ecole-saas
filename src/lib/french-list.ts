/** Items joined for a French sentence: « A », « A et B », « A, B et C »; empty for none. */
export function frenchList(items: readonly string[]): string {
  if (items.length < 2) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} et ${items[items.length - 1]}`;
}
