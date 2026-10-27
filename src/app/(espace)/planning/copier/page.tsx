import type { Metadata } from "next";
import {
  Alert,
  Badge,
  Paper,
  Table,
  TableTbody,
  TableTd,
  TableTh,
  TableThead,
  TableTr,
  Text,
  Title,
} from "@mantine/core";
import { withSchool } from "@/db";
import { chosenSeason, currentSeason, schoolSeasons } from "@/db/schedule";
import { seasonCopyPlan, type CourseToCopy } from "@/db/season-copy";
import { DAY_NAMES } from "@/domain/schedule/days";
import { todayInParis } from "@/domain/people/age";
import { requireRole } from "@/lib/session";
import { ButtonLink } from "../../_ui/button-link";
import { TextLink } from "../../_ui/text-link";
import { seasonParam, withSeason } from "../season-link";
import { CopyButton } from "./copy-button";
import { SourcePicker } from "./source-picker";

export const metadata: Metadata = { title: "Copier un planning" };

const when = (c: CourseToCopy) => `${DAY_NAMES[c.weekday ?? 0]} ${c.startTime.slice(0, 5)}`;

/**
 * Copy of another season's planning into the season chosen on the planning
 * (#190): choose the season to copy, review what will be created, confirm.
 */
export default async function CopyPage({ searchParams }: PageProps<"/planning/copier">) {
  const { schoolId: schoolId } = await requireRole("director");
  const { saison, depuis } = await searchParams;
  const today = todayInParis();
  const data = await withSchool(schoolId, async (tx) => {
    const target = await chosenSeason(tx, saison, today);
    if (!target) return null;
    const others = (await schoolSeasons(tx)).filter((s) => s.id !== target.id);
    // By default the season just before the one to fill, otherwise the most recent other one.
    const source =
      others.find((s) => s.id === depuis) ?? others.find((s) => s.startDate < target.startDate) ?? others[0];
    return {
      target,
      others,
      current: await currentSeason(tx, today),
      copy: source ? await seasonCopyPlan(tx, source.id, target.id) : null,
    };
  });

  if (!data) return <Text size="sm">Aucune saison n’est paramétrée.</Text>;
  const { target, others, current, copy } = data;
  const targetParam = seasonParam(target.id, current?.id);
  const planning = withSeason("/planning", targetParam);

  return (
    <section className="flex w-full min-w-0 flex-col gap-4">
      <nav aria-label="Fil d’Ariane" className="text-sm">
        <TextLink href={planning} size="sm">
          Planning {target.label}
        </TextLink>
        <Text span size="sm" c="dimmed">
          {" "}
          / Copier un planning
        </Text>
      </nav>
      <div>
        <Title order={1} fz="xl">
          Copier un planning dans la saison {target.label}
        </Title>
        <Text size="sm" c="dimmed" maw="70ch">
          Chaque cours régulier est recopié avec son jour, son heure, sa durée, sa salle, son intervenant, sa
          discipline, son niveau, ses âges et ses places. Les dates ne sont pas reprises : le cours a lieu toute la
          saison. Vous modifierez ensuite ce qui change.
        </Text>
      </div>

      {!copy ? (
        <Text size="sm">Aucune autre saison à copier : créez d’abord les cours de cette saison un par un.</Text>
      ) : !copy.ok ? (
        <Alert color="red" role="alert">
          {copy.message}
        </Alert>
      ) : (
        <>
          <SourcePicker seasons={others} chosen={copy.source.id} target={targetParam} />
          {copy.targetCourses > 0 && (
            <Alert color="yellow" title={`La saison ${target.label} a déjà ${copy.targetCourses} cours`}>
              Les cours copiés s’y ajoutent. Un cours déjà présent (même discipline, jour, heure et salle) n’est pas
              recopié.
            </Alert>
          )}
          {copy.plan.inactiveInstructor.length > 0 && (
            <Alert color="yellow">
              {copy.plan.inactiveInstructor.length === 1
                ? "1 cours a un intervenant qui n’est plus actif"
                : `${copy.plan.inactiveInstructor.length} cours ont un intervenant qui n’est plus actif`}{" "}
              : il est copié tel quel, pensez à le remplacer.
            </Alert>
          )}

          <Title order={2} size="h5">
            {copy.plan.copied.length === 0
              ? `Aucun cours à copier depuis ${copy.source.label}`
              : `${copy.plan.copied.length} cours à copier depuis ${copy.source.label}`}
          </Title>
          {copy.plan.copied.length > 0 && (
            <Paper withBorder className="overflow-x-auto">
              <Table>
                <TableThead>
                  <TableTr>
                    <TableTh>Créneau</TableTh>
                    <TableTh>Discipline</TableTh>
                    <TableTh className="hidden sm:table-cell">Salle</TableTh>
                    <TableTh>Intervenant</TableTh>
                  </TableTr>
                </TableThead>
                <TableTbody>
                  {copy.plan.copied.map((c) => (
                    <TableTr key={c.id}>
                      <TableTd className="whitespace-nowrap tabular-nums">{when(c)}</TableTd>
                      <TableTd>
                        {c.discipline}
                        {c.level && (
                          <Text span size="sm" c="dimmed">
                            {" "}
                            · {c.level}
                          </Text>
                        )}
                      </TableTd>
                      <TableTd className="hidden sm:table-cell">{c.room}</TableTd>
                      <TableTd>
                        {c.instructor}
                        {!c.instructorActive && (
                          <Badge color="yellow" variant="light" ml="xs">
                            inactif
                          </Badge>
                        )}
                      </TableTd>
                    </TableTr>
                  ))}
                </TableTbody>
              </Table>
            </Paper>
          )}

          {(copy.plan.oneOff.length > 0 || copy.plan.alreadyThere.length > 0) && (
            <div className="flex flex-col gap-1">
              <Title order={2} size="h5">
                Non copiés
              </Title>
              <ul className="flex flex-col gap-1 text-sm">
                {copy.plan.alreadyThere.map((c) => (
                  <li key={c.id}>
                    {c.discipline}, {when(c)} :{" "}
                    <Text span size="sm" c="dimmed">
                      déjà dans la saison {target.label}
                    </Text>
                  </li>
                ))}
                {copy.plan.oneOff.map((c) => (
                  <li key={c.id}>
                    {c.discipline} :{" "}
                    <Text span size="sm" c="dimmed">
                      cours à des dates précises, à recréer avec les dates de la nouvelle saison
                    </Text>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {copy.plan.copied.length > 0 ? (
            <CopyButton sourceId={copy.source.id} targetId={target.id} count={copy.plan.copied.length}>
              <ButtonLink href={planning} variant="default">
                Annuler
              </ButtonLink>
            </CopyButton>
          ) : (
            <ButtonLink href={planning} variant="default" className="self-start">
              Retour au planning
            </ButtonLink>
          )}
        </>
      )}
    </section>
  );
}
