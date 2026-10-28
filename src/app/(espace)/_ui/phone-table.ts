/**
 * Classes that turn a small Mantine table into cards on phones (DESIGN.md:
 * tables become cards, no inner scroll, #186): the header is hidden, each row
 * wraps its cells, each cell carries its own `PHONE_LABEL`. Layout only.
 */
export const PHONE_TABLE = {
  table: "max-sm:block",
  head: "max-sm:hidden",
  body: "max-sm:block",
  row: "max-sm:flex max-sm:flex-wrap max-sm:items-end max-sm:gap-x-4 max-sm:gap-y-2 max-sm:px-3 max-sm:py-3",
  cell: "max-sm:block max-sm:border-0 max-sm:p-0",
  /** The first cell takes the whole line, as the card's title. */
  title: "max-sm:basis-full",
} as const;

/** The column name shown before a cell on phones only. */
export const PHONE_LABEL = "block text-xs text-doux sm:hidden";
