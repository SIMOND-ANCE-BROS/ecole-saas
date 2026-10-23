import { Panel } from "@/app/(espace)/_panneau/panneau";
import Page from "@/app/(espace)/contacts/nouveau/page";

/** « Nouveau contact » ouvert en panneau par-dessus la page courante. */
export default function PanelPage() {
  return (
    <Panel title="Nouveau contact">
      <Page />
    </Panel>
  );
}
