import { createHash, randomBytes } from "node:crypto";

export function createCredentialToken() {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    hash: hashCredentialToken(token),
  };
}

export function hashCredentialToken(token) {
  return createHash("sha256").update(token).digest("hex");
}
