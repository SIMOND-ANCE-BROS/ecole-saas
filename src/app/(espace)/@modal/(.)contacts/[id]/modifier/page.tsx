import { Panel } from "@/app/(espace)/_panel/panel";
import Page from "@/app/(espace)/contacts/[id]/modifier/page";

/** « Modifier le contact » ouvert en panneau par-dessus la page courante. */
export default function PanelPage(props: PageProps<"/contacts/[id]/modifier">) {
  return (
    <Panel title="Modifier le contact">
      <Page {...props} />
    </Panel>
  );
}
