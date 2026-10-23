import { Panneau } from "@/app/(espace)/_panneau/panneau";
import Page from "@/app/(espace)/eleves/[id]/modifier/page";

/** « Modifier l’élève » ouvert en panneau par-dessus la page courante. */
export default function PagePanneau(props: PageProps<"/eleves/[id]/modifier">) {
  return (
    <Panneau titre="Modifier l’élève">
      <Page {...props} />
    </Panneau>
  );
}
