import { Panel } from "@/app/(espace)/_panel/panel";
import Page from "@/app/(espace)/planning/cours/nouveau/page";

/** « Nouveau cours » opened as a side panel over the current page. */
export default function PanelPage(props: PageProps<"/planning/cours/nouveau">) {
  return (
    <Panel title="Nouveau cours">
      <Page {...props} />
    </Panel>
  );
}
