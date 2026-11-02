"use client";

import { Alert, Button, Text, Title } from "@mantine/core";
import { useEffect, useRef } from "react";
import type { BANNERS } from "@/app/connexion/banners";
import { ROLE_LABELS } from "@/domain/team/rules";
import type { AccountSchool } from "@/lib/invitations";

/**
 * After an account is taken back through the e-mailed link (#404): it keeps the
 * memberships it already had, including any that whoever chose the old password
 * joined. The owner sees them all before signing in, to spot one they never joined.
 */
export function AccountSchools({ schools }: { schools: AccountSchool[] }) {
  // The form just disappeared: bring focus (and screen readers) to what replaced it.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <>
      <div className="flex flex-col gap-2">
        <Title order={1} size="h2" ref={heading} tabIndex={-1} className="outline-none">
          Adresse confirmée
        </Title>
        <Text size="sm" c="dimmed">
          Votre mot de passe est enregistré, et vos autres appareils sont déconnectés. Votre compte donne accès à{" "}
          {schools.length > 1 ? "ces écoles" : "cette école"} :
        </Text>
      </div>
      <ul className="flex flex-col gap-2">
        {schools.map((s, i) => (
          <li key={`${i}-${s.name}`} className="flex items-baseline justify-between gap-3">
            <Text fw={500}>{s.name}</Text>
            <Text span size="sm" c="dimmed">
              {ROLE_LABELS[s.role]}
            </Text>
          </li>
        ))}
      </ul>
      <Alert variant="light" color="yellow" title="Vous ne reconnaissez pas une école ?">
        Quelqu’un a pu créer ce compte avec votre adresse avant vous. Prévenez la direction de l’école qui vous a
        invité(e).
      </Alert>
      <Button component="a" href={`/connexion?lien=${"acces" satisfies keyof typeof BANNERS}`} className="self-start">
        Se connecter
      </Button>
    </>
  );
}
