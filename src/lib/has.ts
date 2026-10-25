type KeysOfUnion<T> = T extends unknown ? keyof T : never;

/**
 * `key in value` with a key checked against the members of the union: a
 * renamed property fails to compile instead of always being false (#138).
 * Narrows `value` to the members declaring `key`.
 */
export function has<T extends object, K extends KeysOfUnion<T> & string>(
  value: T,
  key: K,
): value is Extract<T, Partial<Record<K, unknown>>> & Record<K, unknown> {
  return key in value;
}
