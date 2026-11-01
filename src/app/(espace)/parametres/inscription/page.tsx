import type { Metadata } from "next";
// A server component: the Table parts by name, `Table.Thead` is not available here.
import { Anchor, Paper, Table, TableTbody, TableTd, TableTh, TableThead, TableTr, Text, Title } from "@mantine/core";
import { withSchool } from "@/db";
import { listReferralSources, referralCounts, seasonsRules } from "@/db/internal-rules";
import { currentSeason } from "@/db/schedule";
import { todayInParis } from "@/domain/people/age";
import { requireRole } from "@/lib/session";
import { FormPage } from "../../_ui/form-page";
import { SettingsHeader } from "../settings-header";
import { Referrals } from "./referrals";
import { RulesTexts } from "./rules-texts";

export const metadata: Metadata = { title: "Règlement et questionnaire" };

/** Internal rules of each season and « Comment nous avez-vous connus ? » (#296): management. */
export default async function EnrollmentSettingsPage() {
  const { schoolId } = await requireRole("director");
  const { seasons, sources, counts, season } = await withSchool(schoolId, async (tx) => {
    const season = await currentSeason(tx, todayInParis());
    return {
      seasons: await seasonsRules(tx),
      sources: await listReferralSources(tx),
      counts: await referralCounts(tx, season?.id ?? null),
      season,
    };
  });
  return (
    <FormPage className="flex w-full min-w-0 flex-col gap-6">
      <SettingsHeader
        title="Règlement et questionnaire"
        help="Le règlement intérieur que les familles signent avec la fiche d’inscription (droit à l’image compris), et les réponses proposées à « Comment nous avez-vous connus ? »."
      />
      <section aria-labelledby="reglements" className="flex flex-col gap-2">
        <Title order={2} size="h5" id="reglements">
          Règlement intérieur
        </Title>
        <Text size="sm" c="dimmed">
          La signature se coche à l’inscription, ou sur la fiche de l’élève. Tant qu’un payeur d’un élève inscrit n’a
          pas signé, « Règlement intérieur » apparaît dans « Documents manquants ».
        </Text>
        <RulesTexts seasons={seasons} />
      </section>
      <section aria-labelledby="connus" className="flex flex-col gap-2">
        <Title order={2} size="h5" id="connus">
          Comment nous avez-vous connus ?
        </Title>
        <Text size="sm" c="dimmed">
          Question facultative, posée à la première inscription d’un élève. Elles sont proposées dans l’ordre où vous
          les avez ajoutées.
        </Text>
        <Referrals sources={sources} />
      </section>
      {sources.length > 0 && (
        <section aria-labelledby="statistiques" className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <Title order={2} size="h5" id="statistiques">
              Statistiques
            </Title>
            {/* A file, not a page: a plain link, never prefetched. */}
            <Anchor href="/parametres/inscription/export" size="sm" download>
              Exporter (CSV)
            </Anchor>
          </div>
          <Paper withBorder className="overflow-x-auto">
            <Table verticalSpacing="xs" fz="sm">
              <TableThead>
                <TableTr>
                  <TableTh>Réponse</TableTh>
                  {season && <TableTh className="text-right">Nouveaux élèves {season.label}</TableTh>}
                  <TableTh className="text-right">Tous les élèves</TableTh>
                </TableTr>
              </TableThead>
              <TableTbody>
                {counts.map((c) => (
                  <TableTr key={c.label}>
                    <TableTd>{c.label}</TableTd>
                    {season && <TableTd className="text-right tabular-nums">{c.newThisSeason}</TableTd>}
                    <TableTd className="text-right tabular-nums">{c.students}</TableTd>
                  </TableTr>
                ))}
              </TableTbody>
            </Table>
          </Paper>
        </section>
      )}
    </FormPage>
  );
}
