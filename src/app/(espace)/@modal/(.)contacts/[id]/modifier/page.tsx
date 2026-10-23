import { Panel } from "@/app/(espace)/_panel/panel";
import Page from "@/app/(espace)/contacts/[id]/modifier/page";

/** « Modifier le contact » opened as a side panel over the current page. */
export default function PanelPage(props: PageProps<"/contacts/[id]/modifier">) {
  return (
    <Panel title="Modifier le contact">
      <Page {...props} />
    </Panel>
  );
}
