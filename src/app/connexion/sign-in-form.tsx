"use client";

import { useActionState } from "react";
import { type ConnectionState, signIn } from "./actions";
import { SIGN_IN } from "./fields";

const initialState: ConnectionState = { error: null, email: "" };

export function SignInForm() {
  const [state, action, inProgress] = useActionState(signIn, initialState);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-sm font-medium">
          Adresse e-mail
        </label>
        <input
          id="email"
          name={SIGN_IN.name("email")}
          type="email"
          autoComplete="username"
          required
          autoFocus
          defaultValue={state.email}
          className="champ"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-sm font-medium">
          Mot de passe
        </label>
        <input
          id="password"
          name={SIGN_IN.name("password")}
          type="password"
          autoComplete="current-password"
          required
          className="champ"
        />
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-erreur">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={inProgress} className="bouton-principal">
        {inProgress ? "Connexion…" : "Se connecter"}
      </button>
    </form>
  );
}
