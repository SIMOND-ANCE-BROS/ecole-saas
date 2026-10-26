"use client";

import { Button, PasswordInput, TextInput } from "@mantine/core";
import { useActionState, useState } from "react";
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
  // Controlled: React resets an uncontrolled form after its action, and an error must not wipe what was typed.
  const [v, setV] = useState({ name: name ?? "", password: "", confirmation: "", currentPassword: "" });
  const field = (k: keyof typeof v) => ({
    name: LINK.name(k),
    value: v[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.currentTarget.value }),
  });
  return (
    <form action={submit} className="flex flex-col gap-4" noValidate>
      {/* For password managers: the account the password belongs to. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      {kind === "new" && <TextInput label="Votre nom" autoComplete="name" required {...field("name")} />}
      {kind === "existing" ? (
        <PasswordInput
          label="Votre mot de passe actuel"
          autoComplete="current-password"
          required
          autoFocus
          error={state.error}
          {...field("currentPassword")}
        />
      ) : (
        <>
          <PasswordInput
            label={kind === "reset" ? "Nouveau mot de passe" : "Mot de passe"}
            description="Au moins 10 caractères : une phrase de passe convient très bien."
            autoComplete="new-password"
            required
            autoFocus
            {...field("password")}
          />
          <PasswordInput
            label="Confirmez le mot de passe"
            autoComplete="new-password"
            required
            error={state.error}
            {...field("confirmation")}
          />
        </>
      )}
      <Button type="submit" loading={inProgress}>
        {SUBMIT[kind]}
      </Button>
    </form>
  );
}
