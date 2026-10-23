import { Panel } from "@/app/(espace)/_panel/panel";
import Page from "@/app/(espace)/planning/cours/[id]/page";

/** « Cours » ouvert en panneau par-dessus la page courante. */
export default function PanelPage(props: PageProps<"/planning/cours/[id]">) {
  return (
    <Panel title="Cours">
      <Page {...props} />
    </Panel>
  );
}
