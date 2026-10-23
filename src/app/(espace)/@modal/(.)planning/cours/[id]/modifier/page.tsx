import { Panel } from "@/app/(espace)/_panneau/panneau";
import Page from "@/app/(espace)/planning/cours/[id]/modifier/page";

/** « Modifier le cours » ouvert en panneau par-dessus la page courante. */
export default function PanelPage(props: PageProps<"/planning/cours/[id]/modifier">) {
  return (
    <Panel title="Modifier le cours">
      <Page {...props} />
    </Panel>
  );
}
