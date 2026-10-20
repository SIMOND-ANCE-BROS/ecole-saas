import { Panneau } from "@/app/(espace)/_panneau/panneau";
import Page from "@/app/(espace)/intervenants/[id]/modifier/page";

/** « Modifier l’intervenant » ouvert en panneau par-dessus la page courante. */
export default function PagePanneau(props: PageProps<"/intervenants/[id]/modifier">) {
  return <Panneau titre="Modifier l’intervenant"><Page {...props} /></Panneau>;
}
