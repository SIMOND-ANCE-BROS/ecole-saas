import { Loader, Skeleton, Text } from "@mantine/core";

/**
 * « Chargement… » with a skeleton, for the `loading.tsx` files (#107). Faded in
 * after 300 ms (`delayed-loading`) so a fast page does not flash.
 */
export function PageLoading() {
  return (
    <section aria-busy="true" className="delayed-loading flex w-full min-w-0 flex-col gap-4">
      <div role="status" className="flex items-center gap-2">
        <Loader size="xs" />
        <Text size="sm" c="dimmed">
          Chargement…
        </Text>
      </div>
      <Skeleton height={28} width="30%" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} height={24} />
        ))}
      </div>
    </section>
  );
}
