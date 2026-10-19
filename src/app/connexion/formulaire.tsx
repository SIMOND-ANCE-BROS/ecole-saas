"use client";

import { useActionState } from "react";
import { type EtatConnexion, seConnecter } from "./actions";

const etatInitial: EtatConnexion = { erreur: null, email: "" };

export function FormulaireConnexion() {
  const [etat, action, enCours] = useActionState(seConnecter, etatInitial);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-sm font-medium">
          Adresse e-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          defaultValue={etat.email}
          className="champ"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="motDePasse" className="text-sm font-medium">
          Mot de passe
        </label>
        <input
          id="motDePasse"
          name="motDePasse"
          type="password"
          autoComplete="current-password"
          required
          className="champ"
        />
      </div>
      {etat.erreur && (
        <p role="alert" className="text-sm text-erreur">
          {etat.erreur}
        </p>
      )}
      <button type="submit" disabled={enCours} className="bouton-principal">
        {enCours ? "Connexion…" : "Se connecter"}
      </button>
    </form>
  );
}
