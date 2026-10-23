import { Panel } from "@/app/(espace)/_panel/panel";
import Page from "@/app/(espace)/paiements/nouveau/page";

/** « Encaisser » opened as a side panel over the payer's record. */
export default function PanelPage(props: PageProps<"/paiements/nouveau">) {
  return (
    <Panel title="Encaisser">
      <Page {...props} />
    </Panel>
  );
}
