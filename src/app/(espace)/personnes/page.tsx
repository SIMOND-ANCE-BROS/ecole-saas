import { redirect } from "next/navigation";

/** Old URL (#67): people are now students and contacts (#77). */
export default async function OldPeople({ searchParams }: PageProps<"/personnes">) {
  const { q } = await searchParams;
  redirect(typeof q === "string" && q ? `/eleves?q=${encodeURIComponent(q)}` : "/eleves");
}
