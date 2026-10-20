import { redirect } from "next/navigation";

/** Ancienne adresse (#67) : les personnes sont désormais des élèves et des contacts (#77). */
export default async function AnciennesPersonnes({ searchParams }: PageProps<"/personnes">) {
  const { q } = await searchParams;
  redirect(typeof q === "string" && q ? `/eleves?q=${encodeURIComponent(q)}` : "/eleves");
}
