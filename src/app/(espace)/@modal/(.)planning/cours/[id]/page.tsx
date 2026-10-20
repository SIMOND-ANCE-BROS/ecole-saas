import { Panneau } from "@/app/(espace)/_panneau/panneau";
import Page from "@/app/(espace)/planning/cours/[id]/page";

/** « Cours » ouvert en panneau par-dessus la page courante. */
export default function PagePanneau(props: PageProps<"/planning/cours/[id]">) {
  return <Panneau titre="Cours"><Page {...props} /></Panneau>;
}
