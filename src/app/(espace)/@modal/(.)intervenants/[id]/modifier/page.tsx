import { Panel } from "@/app/(espace)/_panneau/panneau";
import Page from "@/app/(espace)/intervenants/[id]/modifier/page";

/** « Modifier l’intervenant » ouvert en panneau par-dessus la page courante. */
export default function PanelPage(props: PageProps<"/intervenants/[id]/modifier">) {
  return (
    <Panel title="Modifier l’intervenant">
      <Page {...props} />
    </Panel>
  );
}
