import { Panel } from "@/app/(espace)/_panel/panel";
import Page from "@/app/(espace)/intervenants/[id]/modifier/page";

/** « Modifier l’intervenant » opened as a side panel over the current page. */
export default function PanelPage(props: PageProps<"/intervenants/[id]/modifier">) {
  return (
    <Panel title="Modifier l’intervenant">
      <Page {...props} />
    </Panel>
  );
}
