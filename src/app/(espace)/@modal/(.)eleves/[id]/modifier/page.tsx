import { Panel } from "@/app/(espace)/_panel/panel";
import Page from "@/app/(espace)/eleves/[id]/modifier/page";

/** « Modifier l’élève » opened as a side panel over the current page. */
export default function PanelPage(props: PageProps<"/eleves/[id]/modifier">) {
  return (
    <Panel title="Modifier l’élève">
      <Page {...props} />
    </Panel>
  );
}
