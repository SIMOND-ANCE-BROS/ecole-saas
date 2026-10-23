import { Panel } from "@/app/(espace)/_panel/panel";
import Page from "@/app/(espace)/intervenants/nouveau/page";

/** « Nouvel intervenant » opened as a side panel over the current page. */
export default function PanelPage() {
  return (
    <Panel title="Nouvel intervenant">
      <Page />
    </Panel>
  );
}
