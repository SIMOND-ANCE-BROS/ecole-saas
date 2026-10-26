"use client";

import { Button, PasswordInput, TextInput } from "@mantine/core";
import { useActionState } from "react";
import type { LinkState } from "./actions";
import { LINK } from "./fields";

type Props = {
  action: (s: LinkState, f: FormData) => Promise<LinkState>;
  /** new: create an access; existing: confirm an account already used elsewhere; reset: new password. */
  kind: "new" | "existing" | "reset";
  email: string;
  name: string | null;
};

const SUBMIT = { new: "Créer mon accès", existing: "Rejoindre l’école", reset: "Changer mon mot de passe" };

export function LinkForm({ action, kind, email, name }: Props) {
  const [state, submit, inProgress] = useActionState(action, { error: null });
  return (
    <form action={submit} className="flex flex-col gap-4" noValidate>
      {/* For password managers: the account the password belongs to. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      {kind === "new" && (
        <TextInput label="Votre nom" name={LINK.name("name")} defaultValue={name ?? ""} autoComplete="name" required />
      )}
      {kind === "existing" ? (
        <PasswordInput
          label="Votre mot de passe actuel"
          name={LINK.name("currentPassword")}
          autoComplete="current-password"
          required
          autoFocus
        />
      ) : (
        <>
          <PasswordInput
            label={kind === "reset" ? "Nouveau mot de passe" : "Mot de passe"}
            description="Au moins 10 caractères : une phrase de passe convient très bien."
            name={LINK.name("password")}
            autoComplete="new-password"
            required
            autoFocus={kind === "reset"}
          />
          <PasswordInput
            label="Confirmez le mot de passe"
            name={LINK.name("confirmation")}
            autoComplete="new-password"
            required
          />
        </>
      )}
      {state.error && (
        <p role="alert" className="text-sm text-erreur">
          {state.error}
        </p>
      )}
      <Button type="submit" loading={inProgress}>
        {SUBMIT[kind]}
      </Button>
    </form>
  );
}
