import { Panel } from "@/app/(espace)/_panneau/panneau";
import Page from "@/app/(espace)/intervenants/nouveau/page";

/** « Nouvel intervenant » ouvert en panneau par-dessus la page courante. */
export default function PanelPage() {
  return (
    <Panel title="Nouvel intervenant">
      <Page />
    </Panel>
  );
}
