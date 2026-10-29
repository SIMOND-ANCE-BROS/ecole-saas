import { Badge } from "@mantine/core";
import type { EnrollmentStatus } from "@/domain/enrollment/statuses";
import { frenchDate } from "@/lib/dates";

/** Heading of the enrollments section, focused once a change is saved (its button may be gone). */
export const ENROLLMENTS_HEADING = "inscriptions";

/** Badge colour and lower-case label of each status other than « Inscrit » (#284). */
const BADGES = {
  trial: { label: "à l’essai", color: "indigo" },
  waitlist: { label: "en attente", color: "yellow" },
  dropped: { label: "abandon", color: "gray" },
  ended: { label: "terminé", color: "gray" },
} as const;

const WRAPPING = { label: { whiteSpace: "normal", overflow: "visible" } } as const;

/**
 * Status of an enrollment as a badge, the same on records, course lists and
 * attendance sheets; a word, never colour alone. Nothing for an active
 * enrollment unless `showActive` (a list where every status is shown).
 */
export function EnrollmentStatusBadge({
  status,
  droppedOn,
  showActive = false,
}: {
  status: EnrollmentStatus;
  droppedOn?: string | null;
  showActive?: boolean;
}) {
  if (status === "active")
    return showActive ? (
      <Badge color="green" variant="light" tt="none">
        inscrit
      </Badge>
    ) : null;
  const b = BADGES[status];
  return (
    // « abandon le 15/11/2026 » wraps in a narrow cell (phone) rather than being cut.
    <Badge color={b.color} variant="light" tt="none" h="auto" maw="100%" styles={WRAPPING}>
      {b.label}
      {status === "dropped" && droppedOn ? ` le ${frenchDate(droppedOn)}` : ""}
    </Badge>
  );
}
