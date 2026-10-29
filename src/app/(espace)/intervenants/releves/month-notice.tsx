import { Text } from "@mantine/core";
import { frenchDate } from "@/lib/dates";

/** Said under the month picker when the month is not over: lessons count up to today only (#285, open question 1). */
export function MonthNotice({
  inProgress,
  notStarted,
  today,
}: {
  inProgress: boolean;
  notStarted: boolean;
  today: string;
}) {
  if (notStarted)
    return (
      <Text size="sm" c="dimmed">
        Ce mois n’a pas encore commencé : aucune séance n’est comptée.
      </Text>
    );
  if (inProgress)
    return (
      <Text size="sm" c="dimmed">
        Mois en cours : seules les séances jusqu’au {frenchDate(today)} inclus sont comptées.
      </Text>
    );
  return null;
}
