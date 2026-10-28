import { PageLoading } from "./_ui/page-loading";

/**
 * Shown while moving to another section of the space (Élèves → Contacts,
 * Planning…). Moving inside a section (list → record) is covered by the
 * record's own `loading.tsx`; the side panel has its own (`@modal/loading.tsx`).
 * No `loading.tsx` at list level: filters and sort change the list's address
 * and would show it on every change.
 */
export default function Loading() {
  return <PageLoading />;
}
