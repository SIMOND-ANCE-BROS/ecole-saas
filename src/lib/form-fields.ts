/**
 * Field names of a form posted as FormData, shared by the form (`name=`) and
 * its action (`read`): a name renamed on one side fails to compile instead of
 * reading an empty value (#138). Declare it in a plain module next to the
 * action (a "use server" file only exports async functions).
 */
export function formFields<const N extends readonly string[]>(...names: N) {
  type Name = N[number];
  return {
    names,
    /** The `name` attribute of a field. */
    name: (n: Name): Name => n,
    /** Text value of a field, "" when absent. */
    read: (f: FormData, n: Name): string => String(f.get(n) ?? ""),
  };
}
