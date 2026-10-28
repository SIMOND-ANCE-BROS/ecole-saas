import { Text, Title } from "@mantine/core";
import type { ReactNode } from "react";

type Props = {
  title: ReactNode;
  /** Next to the title, such as the season picker. */
  beside?: ReactNode;
  /** One dimmed line under the title: what the page holds, or the result count. */
  description?: ReactNode;
  /** The description changes with the filters: read out when it does. */
  live?: boolean;
  /** Buttons on the right; they wrap under the title on a phone. */
  actions?: ReactNode;
};

/** Same header on every page (#107): title, one line of context, actions. */
export function PageHeader({ title, beside, description, live, actions }: Props) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 flex-col">
        <div className="flex flex-wrap items-end gap-3">
          <Title order={1} fz="xl">
            {title}
          </Title>
          {beside}
        </div>
        {description && (
          <Text size="sm" c="dimmed" aria-live={live ? "polite" : undefined}>
            {description}
          </Text>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
