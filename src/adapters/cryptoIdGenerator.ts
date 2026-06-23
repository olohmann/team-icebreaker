import { randomBytes } from "node:crypto";
import type { IdGenerator } from "../domain/ports";

/** URL-safe ids backed by crypto randomness. */
export class CryptoIdGenerator implements IdGenerator {
  newSessionId(): string {
    // ~8 url-safe chars, enough entropy for shareable, non-sequential ids.
    return randomBytes(6).toString("base64url");
  }

  newOwnerToken(): string {
    return randomBytes(24).toString("base64url");
  }
}
