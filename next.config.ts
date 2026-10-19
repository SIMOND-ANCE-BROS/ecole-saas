import type { NextConfig } from "next";

/** Liste séparée par des virgules, vide par défaut. */
const liste = (valeur: string | undefined) =>
  (valeur ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

const nextConfig: NextConfig = {
  // Développement seulement : autres noms d'hôte autorisés (ex. l'IP du poste
  // sur le réseau local pour tester depuis une autre machine). Voir .env.example.
  allowedDevOrigins: liste(process.env.ORIGINES_DEV),
};

export default nextConfig;
