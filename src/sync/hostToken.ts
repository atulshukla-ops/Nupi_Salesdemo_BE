import jwt from "jsonwebtoken";
import env from "../configs/env";

/**
 * Host token: proves a console was opened by someone holding the team key, for one demo only.
 * Short-lived and never stored; the relay just verifies the signature.
 */
export interface HostClaims {
  typ: "sdr-host";
  sub: string; // demo id
  slug: string;
  name: string | null; // presenter name, for the session record
}

export const issueHostToken = (demoId: string, slug: string, presenterName: string | null) => {
  const claims: HostClaims = { typ: "sdr-host", sub: demoId, slug, name: presenterName };
  const token = jwt.sign(claims, env.hostTokenSecret, { algorithm: "HS256", expiresIn: env.hostTokenTtlSec });
  return { token, expiresAt: new Date(Date.now() + env.hostTokenTtlSec * 1000) };
};

/** Returns the claims, or null when the token is missing, expired, forged or for another demo. */
export const verifyHostToken = (token: string, slug: string): HostClaims | null => {
  try {
    const claims = jwt.verify(token, env.hostTokenSecret, { algorithms: ["HS256"] }) as HostClaims;
    return claims.typ === "sdr-host" && claims.slug === slug ? claims : null;
  } catch {
    return null;
  }
};
