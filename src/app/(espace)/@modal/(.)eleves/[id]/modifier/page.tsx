import { Panel } from "@/app/(espace)/_panneau/panneau";
import Page from "@/app/(espace)/eleves/[id]/modifier/page";

/** « Modifier l’élève » ouvert en panneau par-dessus la page courante. */
export default function PanelPage(props: PageProps<"/eleves/[id]/modifier">) {
  return (
    <Panel title="Modifier l’élève">
      <Page {...props} />
    </Panel>
  );
}
