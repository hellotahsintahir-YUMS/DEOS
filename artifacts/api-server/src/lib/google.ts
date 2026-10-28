import { google } from "googleapis";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { googleConnectionsTable } from "@workspace/db/schema";

export const googleScopes = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.readonly",
];

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_REDIRECT_URL,
  );
}

export function createGoogleOAuthClient() {
  if (!isGoogleOAuthConfigured()) {
    throw new Error("Google OAuth is not configured");
  }

  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URL,
  );
}

function tokenEncryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET must be configured to protect Google tokens");
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptGoogleToken(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptGoogleToken(value: string): string {
  const [ivValue, tagValue, encryptedValue] = value.split(".");
  if (!ivValue || !tagValue || !encryptedValue) {
    throw new Error("Stored Google token is invalid");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    tokenEncryptionKey(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export async function getGoogleConnection(email: string) {
  const [connection] = await db
    .select()
    .from(googleConnectionsTable)
    .where(eq(googleConnectionsTable.email, email))
    .limit(1);
  return connection ?? null;
}

export async function getGoogleAccessToken(email: string): Promise<string | null> {
  const connection = await getGoogleConnection(email);
  if (!connection) return null;

  if (
    connection.expiresAt &&
    connection.expiresAt.getTime() > Date.now() + 60_000
  ) {
    return decryptGoogleToken(connection.accessTokenEncrypted);
  }

  if (!connection.refreshTokenEncrypted || !isGoogleOAuthConfigured()) {
    return null;
  }

  const refreshToken = decryptGoogleToken(connection.refreshTokenEncrypted);
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) return null;

  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object") return null;
  const tokenData = payload as Record<string, unknown>;
  const accessToken = tokenData.access_token;
  const expiresIn = tokenData.expires_in;
  if (typeof accessToken !== "string" || typeof expiresIn !== "number") {
    return null;
  }

  await db
    .update(googleConnectionsTable)
    .set({
      accessTokenEncrypted: encryptGoogleToken(accessToken),
      expiresAt: new Date(Date.now() + expiresIn * 1000),
      updatedAt: new Date(),
    })
    .where(eq(googleConnectionsTable.email, email));

  return accessToken;
}
