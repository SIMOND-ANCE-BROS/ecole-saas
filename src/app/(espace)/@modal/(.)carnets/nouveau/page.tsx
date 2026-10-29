import { Panel } from "@/app/(espace)/_panel/panel";
import Page from "@/app/(espace)/carnets/nouveau/page";

/** « Vendre un carnet » opened as a side panel over the student's or payer's record. */
export default function PanelPage(props: PageProps<"/carnets/nouveau">) {
  return (
    <Panel title="Vendre un carnet">
      <Page {...props} />
    </Panel>
  );
}
