import { Panel } from "@/app/(espace)/_panel/panel";
import Page from "@/app/(espace)/stages/nouveau/page";

/** « Inscrire à un stage » opened as a side panel over the student's or payer's record. */
export default function PanelPage(props: PageProps<"/stages/nouveau">) {
  return (
    <Panel title="Inscrire à un stage">
      <Page {...props} />
    </Panel>
  );
}
