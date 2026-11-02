"use client";

import { Button, PasswordInput, TextInput } from "@mantine/core";
import { useActionState, useState } from "react";
import type { LinkState } from "./actions";
import { AccountSchools } from "./account-schools";
import { LINK } from "./fields";

type Props = {
  action: (s: LinkState, f: FormData) => Promise<LinkState>;
  /**
   * new: create an access; existing: confirm an account already used elsewhere; reset: new password;
   * proof: the e-mail is proven (#179), choose the account's password to join.
   */
  kind: "new" | "existing" | "reset" | "proof";
  email: string;
  name: string | null;
  /** Shown above the form, replaced with the account's schools once it is taken back (#404). */
  intro?: React.ReactNode;
};

const SUBMIT = {
  new: "Créer mon accès",
  existing: "Rejoindre l’école",
  reset: "Changer mon mot de passe",
  proof: "Rejoindre l’école",
};

export function LinkForm({ action, kind, email, name, intro }: Props) {
  const [state, submit, inProgress] = useActionState(action, { error: null });
  // Controlled: React resets an uncontrolled form after its action, and an error must not wipe what was typed.
  const [v, setV] = useState({ name: name ?? "", password: "", confirmation: "", currentPassword: "" });
  const field = (k: keyof typeof v) => ({
    name: LINK.name(k),
    value: v[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.currentTarget.value }),
  });
  if (state.schools) return <AccountSchools schools={state.schools} />;
  return (
    <>
      {intro}
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
              label={kind === "new" ? "Mot de passe" : "Nouveau mot de passe"}
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
    </>
  );
}
