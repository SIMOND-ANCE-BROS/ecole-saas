import { Panneau } from "@/app/(espace)/_panneau/panneau";
import Page from "@/app/(espace)/planning/cours/nouveau/page";

/** « Nouveau cours » ouvert en panneau par-dessus la page courante. */
export default function PagePanneau(props: PageProps<"/planning/cours/nouveau">) {
  return <Panneau titre="Nouveau cours"><Page {...props} /></Panneau>;
}
