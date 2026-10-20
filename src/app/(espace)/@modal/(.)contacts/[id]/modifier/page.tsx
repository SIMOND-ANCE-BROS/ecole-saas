import { Panneau } from "@/app/(espace)/_panneau/panneau";
import Page from "@/app/(espace)/contacts/[id]/modifier/page";

/** « Modifier le contact » ouvert en panneau par-dessus la page courante. */
export default function PagePanneau(props: PageProps<"/contacts/[id]/modifier">) {
  return <Panneau titre="Modifier le contact"><Page {...props} /></Panneau>;
}
