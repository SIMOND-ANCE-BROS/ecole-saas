import { Panneau } from "@/app/(espace)/_panneau/panneau";
import Page from "@/app/(espace)/eleves/nouveau/page";

/** « Nouvel élève » ouvert en panneau par-dessus la page courante. */
export default function PagePanneau(props: PageProps<"/eleves/nouveau">) {
  return (
    <Panneau titre="Nouvel élève">
      <Page {...props} />
    </Panneau>
  );
}
