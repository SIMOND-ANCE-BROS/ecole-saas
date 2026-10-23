import { Panel } from "@/app/(espace)/_panneau/panneau";
import Page from "@/app/(espace)/paiements/nouveau/page";

/** « Encaisser » ouvert en panneau par-dessus la fiche du payeur. */
export default function PanelPage(props: PageProps<"/paiements/nouveau">) {
  return (
    <Panel title="Encaisser">
      <Page {...props} />
    </Panel>
  );
}
