import { Text } from "@mantine/core";

const longDate = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** Said under the month picker when the month is not over: lessons count up to today only (#285). */
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
        Mois en cours : seules les séances jusqu’au{" "}
        {longDate.format(new Date(`${today}T00:00:00Z`)).replace(/^1 /, "1er ")} inclus sont comptées.
      </Text>
    );
  return null;
}
