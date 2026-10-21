import { Panneau } from "@/app/(espace)/_panneau/panneau";
import Page from "@/app/(espace)/paiements/nouveau/page";

/** « Encaisser » ouvert en panneau par-dessus la fiche du payeur. */
export default function PagePanneau(props: PageProps<"/paiements/nouveau">) {
  return (
    <Panneau titre="Encaisser">
      <Page {...props} />
    </Panneau>
  );
}
