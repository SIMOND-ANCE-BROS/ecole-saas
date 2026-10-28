import type { Metadata } from "next";
import { Button, Text, Title } from "@mantine/core";
import { schoolsOf } from "@/db";
import { currentSession } from "@/lib/session";
import { signOut } from "../(espace)/actions";
import { chooseSchoolAction } from "./actions";
import { SCHOOL_CHOICE } from "./fields";

export const metadata: Metadata = { title: "Choisir une école" };

const ROLE_LABEL = { director: "Direction", front_desk: "Accueil", teacher: "Professeur" } as const;

export default async function SchoolsPage() {
  const { user } = await currentSession();
  const schools = await schoolsOf(user.id);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 p-6">
      <Title order={1} size="h2">
        Choisir une école
      </Title>
      {schools.length === 0 ? (
        <p>Votre compte n’est rattaché à aucune école active. Contactez la direction de votre école.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {schools.map((e) => (
            <li key={e.id}>
              <form action={chooseSchoolAction}>
                <input type="hidden" name={SCHOOL_CHOICE.name("schoolId")} value={e.id} />
                <Button
                  type="submit"
                  variant="default"
                  fullWidth
                  justify="space-between"
                  rightSection={
                    <Text span size="sm" c="dimmed">
                      {ROLE_LABEL[e.role]}
                    </Text>
                  }
                >
                  {e.name}
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <form action={signOut}>
        <Button type="submit" variant="subtle" size="compact-sm">
          Se déconnecter
        </Button>
      </form>
    </main>
  );
}
