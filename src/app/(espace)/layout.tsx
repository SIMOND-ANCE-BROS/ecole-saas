import { Anchor } from "@mantine/core";
import { Suspense } from "react";
import { eq } from "drizzle-orm";
import { withSchool } from "@/db";
import { school } from "@/db/schema";
import { schoolContext, currentSession } from "@/lib/session";
import { signOut } from "./actions";
import { Frame } from "./frame";
import { Navigation, GlobalSearch } from "./navigation";
import { TextLink } from "./_ui/text-link";

const ROLE_LABEL = { director: "Direction", front_desk: "Accueil", teacher: "Professeur" } as const;

/**
 * Frame of the signed-in workspace: sidebar (school, navigation, account) and
 * global search. It only displays information: every page and every action
 * runs its own check (schoolContext), since a layout is not re-run on every
 * navigation. `modal`: side panel of the intercepted routes (`@modal`),
 * empty the rest of the time.
 */
export default async function WorkspaceLayout({ children, modal }: LayoutProps<"/">) {
  const [{ schoolId: schoolId, role }, { user }] = await Promise.all([schoolContext(), currentSession()]);
  const [{ name: name }] = await withSchool(schoolId, (tx) =>
    tx.select({ name: school.name }).from(school).where(eq(school.id, schoolId)),
  );

  return (
    <Frame
      header={
        // useSearchParams requires a Suspense boundary.
        <Suspense>{role !== "teacher" && <GlobalSearch />}</Suspense>
      }
      pane={
        <>
          <div className="flex items-center gap-2 px-1">
            <span
              aria-hidden
              className="grid size-8 shrink-0 place-items-center rounded-md bg-(--mantine-primary-color-filled) text-sm font-semibold text-white"
            >
              {name.charAt(0)}
            </span>
            <span className="text-sm leading-tight font-semibold">{name}</span>
          </div>
          <Navigation role={role} />
          <div className="mt-auto flex flex-col gap-1 border-t border-bordure pt-3 text-sm">
            <span className="px-1 font-medium">{user.name}</span>
            <span className="px-1 text-xs text-doux">{ROLE_LABEL[role]}</span>
            <TextLink href="/ecoles" size="xs" px={4} className="self-start">
              Changer d’école
            </TextLink>
            <form action={signOut}>
              <Anchor component="button" type="submit" size="xs" px={4}>
                Se déconnecter
              </Anchor>
            </form>
          </div>
        </>
      }
    >
      {children}
      {modal}
    </Frame>
  );
}
