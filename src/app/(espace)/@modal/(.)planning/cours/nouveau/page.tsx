import { Panel } from "@/app/(espace)/_panel/panel";
import Page from "@/app/(espace)/planning/cours/nouveau/page";
import { newCourseTitle } from "@/app/(espace)/planning/season-link";
import { withSchool } from "@/db";
import { chosenSeason, currentSeason } from "@/db/schedule";
import { todayInParis } from "@/domain/people/age";
import { requireRole } from "@/lib/session";

/** « Nouveau cours » opened as a side panel over the current page; names a season other than the current one. */
export default async function PanelPage(props: PageProps<"/planning/cours/nouveau">) {
  const { schoolId } = await requireRole("director");
  const { saison } = await props.searchParams;
  const title = await withSchool(schoolId, async (tx) => {
    const s = await chosenSeason(tx, saison, todayInParis());
    return newCourseTitle(s?.label, s?.id === (await currentSeason(tx, todayInParis()))?.id);
  });
  return (
    <Panel title={title}>
      <Page {...props} />
    </Panel>
  );
}
