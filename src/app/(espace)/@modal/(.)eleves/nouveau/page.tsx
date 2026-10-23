import { Panel } from "@/app/(espace)/_panneau/panneau";
import Page from "@/app/(espace)/eleves/nouveau/page";

/** « Nouvel élève » ouvert en panneau par-dessus la page courante. */
export default function PanelPage(props: PageProps<"/eleves/nouveau">) {
  return (
    <Panel title="Nouvel élève">
      <Page {...props} />
    </Panel>
  );
}
