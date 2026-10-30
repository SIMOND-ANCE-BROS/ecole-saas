import { createHash, timingSafeEqual } from "node:crypto";

/** Shortest secret accepted: 32 characters (`openssl rand -hex 32` gives 64). */
export const MIN_SECRET_LENGTH = 32;

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

/**
 * Whether an `Authorization` header carries `Bearer <secret>`. Compared in constant time on
 * SHA-256 digests (same length whatever was sent), so the time taken reveals neither the
 * secret nor its length. A missing or too short secret refuses everything: a server without
 * its secret never runs the jobs for whoever asks. Neither value is ever logged.
 */
export function bearerMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < MIN_SECRET_LENGTH) return false;
  const match = /^Bearer (\S+)$/.exec(header ?? "");
  const sent = match ? match[1] : "";
  // Always compare, even when nothing usable was sent: the same work whatever the header.
  const same = timingSafeEqual(digest(sent), digest(secret));
  return match !== null && same;
}
