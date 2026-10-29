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
import { PAY_UNITS } from "@/db/instructors";
import { DAY_NAMES } from "@/domain/schedule/days";
import { formatEuros } from "@/lib/money";
import { todayInParis } from "@/domain/people/age";
import { requireRole } from "@/lib/session";
import { ButtonLink } from "../../_ui/button-link";
import { TextLink } from "../../_ui/text-link";
import { seasonParam, withSeason } from "../season-link";
import { CopyButton } from "./copy-button";
import { SourcePicker } from "./source-picker";

export const metadata: Metadata = { title: "Copier un planning" };

const when = (c: CourseToCopy) => `${DAY_NAMES[c.weekday ?? 0]} ${c.startTime.slice(0, 5)}`;

/** « Classique (Débutant), mercredi 15:00, Grande salle, Site Centre » */
const describe = (c: CourseToCopy) =>
  [`${c.discipline}${c.level ? ` (${c.level})` : ""}`, ...(c.weekday ? [when(c)] : []), c.room].join(", ");

const count = (n: number, one: string, many: string) => (n === 1 ? `1 cours ${one}` : `${n} cours ${many}`);

function Flag({ children }: { children: string }) {
  return (
    <Badge color="yellow" variant="light" ml="xs">
      {children}
    </Badge>
  );
}

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
  const copied = copy?.ok ? copy.plan.copied : [];
  const check = copy?.ok ? copy.plan.check : null;
  // A rate typed in the instructor's older pay mode is not carried over (#268).
  const oldUnitRates = copied.filter((c) => c.oldUnitRate !== null).length;
  const toCheck = check
    ? [
        oldUnitRates > 0 &&
          (oldUnitRates === 1
            ? "1 cours a un tarif intervenant de l’ancien mode de rémunération de son intervenant : il n’est pas repris, le tarif habituel s’applique."
            : `${oldUnitRates} cours ont un tarif intervenant de l’ancien mode de rémunération de leur intervenant : ces tarifs ne sont pas repris, le tarif habituel s’applique.`),
        check.periodDropped.length > 0 &&
          `${count(check.periodDropped.length, "avait une période limitée", "avaient une période limitée")} dans l’ancienne saison : la copie a lieu toute la saison, ajustez ses dates si besoin.`,
        check.biweekly.length > 0 &&
          `${count(check.biweekly.length, "a lieu", "ont lieu")} une semaine sur deux : l’alternance repart de la première semaine de la saison, vérifiez les semaines où ils tombent.`,
        check.roomTaken.length > 0 &&
          `${count(check.roomTaken.length, "tombe", "tombent")} dans une salle déjà occupée à la même heure par un autre cours de la saison ${target.label}.`,
        check.inactiveInstructor.length > 0 &&
          `${count(check.inactiveInstructor.length, "a un intervenant", "ont un intervenant")} qui n’est plus actif : il est copié tel quel, pensez à le remplacer.`,
      ].filter((line): line is string => typeof line === "string")
    : [];

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
          <SourcePicker seasons={others} chosen={copy.source.id} current={current?.id} target={targetParam} />
          {copied.length > 0 && copy.targetCourses > 0 && (
            <Alert color="yellow" title={`La saison ${target.label} a déjà ${copy.targetCourses} cours`}>
              Les cours copiés s’y ajoutent. Un cours déjà présent (même discipline, jour, heure et salle) n’est pas
              recopié.
            </Alert>
          )}
          {toCheck.length > 0 && (
            <Alert color="yellow" title="À vérifier après la copie">
              <ul className="flex list-disc flex-col gap-1 pl-4">
                {toCheck.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </Alert>
          )}

          <Title order={2} size="h5">
            {copied.length === 0
              ? `Aucun cours à copier depuis ${copy.source.label}`
              : `${copied.length} cours à copier depuis ${copy.source.label}`}
          </Title>
          {copied.length > 0 && (
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
                  {copied.map((c) => (
                    <TableTr key={c.id}>
                      <TableTd className="whitespace-nowrap tabular-nums">
                        {when(c)}
                        {/* Here rather than under the room, which is hidden on a phone. */}
                        {copy.plan.check.roomTaken.includes(c) && <Flag>salle déjà occupée</Flag>}
                      </TableTd>
                      <TableTd>
                        {c.discipline}
                        {c.level && (
                          <Text span size="sm" c="dimmed">
                            {" "}
                            ({c.level})
                          </Text>
                        )}
                        {copy.plan.check.periodDropped.includes(c) && <Flag>période non reprise</Flag>}
                        {copy.plan.check.biweekly.includes(c) && <Flag>une semaine sur deux</Flag>}
                      </TableTd>
                      <TableTd className="hidden sm:table-cell">{c.room}</TableTd>
                      <TableTd>
                        {c.instructor}
                        {copy.plan.check.inactiveInstructor.includes(c) && <Flag>inactif</Flag>}
                        {c.oldUnitRate && (
                          <Flag>{`tarif de ${formatEuros(c.oldUnitRate.cents)} / ${PAY_UNITS[c.oldUnitRate.payMode]} non repris`}</Flag>
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
                {copied.length === 0 && copy.plan.alreadyThere.length > 0 ? (
                  <li>
                    {copy.plan.alreadyThere.length === 1
                      ? `Le cours régulier de ${copy.source.label} est déjà dans la saison ${target.label}.`
                      : `Les ${copy.plan.alreadyThere.length} cours réguliers de ${copy.source.label} sont déjà dans la saison ${target.label}.`}
                  </li>
                ) : (
                  copy.plan.alreadyThere.map((c) => (
                    <li key={c.id}>
                      {describe(c)} :{" "}
                      <Text span size="sm" c="dimmed">
                        déjà dans la saison {target.label}
                      </Text>
                    </li>
                  ))
                )}
                {copy.plan.oneOff.map((c) => (
                  <li key={c.id}>
                    {describe(c)} :{" "}
                    <Text span size="sm" c="dimmed">
                      cours à des dates précises, à recréer avec les dates de la nouvelle saison
                    </Text>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {copied.length > 0 ? (
            <CopyButton sourceId={copy.source.id} targetId={target.id} count={copied.length}>
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
