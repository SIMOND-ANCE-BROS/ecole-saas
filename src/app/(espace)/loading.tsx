import { Loader, Skeleton, Text } from "@mantine/core";

/**
 * Shown while a page of the space loads (#107): a list or a record taking more
 * than a moment. Delayed (`chargement-differe`) so a fast page does not flash.
 */
export default function Loading() {
  return (
    <section aria-busy="true" className="chargement-differe flex w-full min-w-0 flex-col gap-4">
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
