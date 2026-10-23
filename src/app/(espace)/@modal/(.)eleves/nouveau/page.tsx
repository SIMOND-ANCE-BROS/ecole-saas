import { Panel } from "@/app/(espace)/_panel/panel";
import Page from "@/app/(espace)/eleves/nouveau/page";

/** « Nouvel élève » opened as a side panel over the current page. */
export default function PanelPage(props: PageProps<"/eleves/nouveau">) {
  return (
    <Panel title="Nouvel élève">
      <Page {...props} />
    </Panel>
  );
}
