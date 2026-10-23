import { Panel } from "@/app/(espace)/_panel/panel";
import Page from "@/app/(espace)/contacts/nouveau/page";

/** « Nouveau contact » opened as a side panel over the current page. */
export default function PanelPage() {
  return (
    <Panel title="Nouveau contact">
      <Page />
    </Panel>
  );
}
