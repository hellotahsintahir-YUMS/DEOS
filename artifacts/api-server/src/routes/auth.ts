import { Router, type IRouter } from "express";
import { randomBytes } from "node:crypto";
import type { Request } from "express";
import { eq } from "drizzle-orm";
import { google } from "googleapis";
import {
  DisconnectGoogleResponse,
  GetGoogleFileContentParams,
  GetGoogleFileContentResponse,
  GetGoogleStatusResponse,
  ListGoogleFilesResponse,
  StartGoogleConnectResponse,
} from "@workspace/api-zod";
import { db } from "@workspace/db";
import { googleConnectionsTable } from "@workspace/db/schema";
import {
  createGoogleOAuthClient,
  decryptGoogleToken,
  encryptGoogleToken,
  getGoogleAccessToken,
  getGoogleConnection,
  googleScopes,
  isGoogleOAuthConfigured,
} from "../lib/google";

const router: IRouter = Router();

type StudySession = {
  email?: string;
  oauthState?: string;
  studyId?: string;
};

function getSession(req: Request): StudySession {
  if (!req.session) req.session = {};
  return req.session as unknown as StudySession;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function collectTextRuns(value: unknown, output: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectTextRuns(item, output);
    return output;
  }
  const record = asRecord(value);
  if (!record) return output;
  const textRun = asRecord(record.textRun);
  if (textRun && typeof textRun.content === "string") {
    output.push(textRun.content);
    return output;
  }
  for (const child of Object.values(record)) collectTextRuns(child, output);
  return output;
}

function getGoogleErrorStatus(error: unknown): number | undefined {
  const record = asRecord(error);
  const status = record?.status ?? record?.code;
  return typeof status === "number" ? status : undefined;
}

router.get("/google/status", async (req, res): Promise<void> => {
  const configured = isGoogleOAuthConfigured();
  const email = getSession(req).email ?? null;
  const connection = configured && email ? await getGoogleConnection(email) : null;
  const connected = Boolean(connection);
  const data = GetGoogleStatusResponse.parse({
    configured,
    connected,
    email: connected ? email : null,
    message: configured
      ? connected
        ? "Your personal Google account is connected."
        : "Connect your own Google account to use your study materials."
      : "Google OAuth needs to be configured before students can connect their accounts.",
  });
  res.json(data);
});

router.post("/google/connect", (req, res): void => {
  if (!isGoogleOAuthConfigured()) {
    res.status(503).json({ error: "Google OAuth is not configured yet." });
    return;
  }
  const state = randomBytes(24).toString("hex");
  const session = getSession(req);
  session.oauthState = state;
  const authorizationUrl = createGoogleOAuthClient().generateAuthUrl({
    access_type: "offline",
    include_granted_scopes: true,
    prompt: "consent",
    scope: googleScopes,
    state,
  });
  res.json(StartGoogleConnectResponse.parse({ authorizationUrl }));
});

router.get("/google/callback", async (req, res): Promise<void> => {
  const session = getSession(req);
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  if (!code || !state || !session.oauthState || state !== session.oauthState) {
    delete session.oauthState;
    res.status(400).send("Google authorization could not be verified. Please try again.");
    return;
  }
  delete session.oauthState;

  try {
    const oauthClient = createGoogleOAuthClient();
    const { tokens } = await oauthClient.getToken(code);
    if (!tokens.access_token) {
      res.redirect("/?google=error");
      return;
    }
    oauthClient.setCredentials(tokens);
    const profile = await google
      .oauth2({ version: "v2", auth: oauthClient })
      .userinfo.get();
    const email = profile.data.email?.trim().toLowerCase();
    if (!email) {
      res.redirect("/?google=error");
      return;
    }

    const existing = await getGoogleConnection(email);
    const refreshToken =
      tokens.refresh_token ??
      (existing?.refreshTokenEncrypted
        ? decryptGoogleToken(existing.refreshTokenEncrypted)
        : null);
    const values = {
      email,
      accessTokenEncrypted: encryptGoogleToken(tokens.access_token),
      refreshTokenEncrypted: refreshToken
        ? encryptGoogleToken(refreshToken)
        : null,
      expiresAt: tokens.expiry_date
        ? new Date(tokens.expiry_date)
        : new Date(Date.now() + 60 * 60 * 1000),
      scopes: tokens.scope ?? googleScopes.join(" "),
      updatedAt: new Date(),
    };
    await db
      .insert(googleConnectionsTable)
      .values(values)
      .onConflictDoUpdate({
        target: googleConnectionsTable.email,
        set: {
          accessTokenEncrypted: values.accessTokenEncrypted,
          refreshTokenEncrypted: values.refreshTokenEncrypted,
          expiresAt: values.expiresAt,
          scopes: values.scopes,
          updatedAt: values.updatedAt,
        },
      });

    session.email = email;
    res.redirect("/?google=connected");
  } catch (error) {
    req.log.warn(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Google OAuth callback failed",
    );
    res.redirect("/?google=error");
  }
});

router.get("/google/files", async (req, res): Promise<void> => {
  const email = getSession(req).email;
  if (!email) {
    res.status(401).json({ error: "Connect a Google account first." });
    return;
  }
  const accessToken = await getGoogleAccessToken(email);
  if (!accessToken) {
    res.status(401).json({ error: "Reconnect your Google account to continue." });
    return;
  }

  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set(
    "q",
    "trashed = false and (mimeType = 'application/vnd.google-apps.document' or mimeType = 'application/vnd.google-apps.presentation')",
  );
  url.searchParams.set("pageSize", "50");
  url.searchParams.set("orderBy", "modifiedTime desc");
  url.searchParams.set(
    "fields",
    "files(id,name,mimeType,webViewLink,modifiedTime)",
  );
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    if (response.status === 401) {
      res.status(401).json({ error: "Reconnect your Google account to continue." });
      return;
    }
    req.log.warn({ status: response.status }, "Google Drive file listing failed");
    res.status(502).json({ error: "Google Drive could not load your files." });
    return;
  }

  const payload = asRecord(await response.json());
  const rows = Array.isArray(payload?.files) ? payload.files : [];
  const files = rows.flatMap((value) => {
    const file = asRecord(value);
    if (
      !file ||
      typeof file.id !== "string" ||
      typeof file.name !== "string" ||
      typeof file.mimeType !== "string"
    ) {
      return [];
    }
    const kind =
      file.mimeType === "application/vnd.google-apps.document"
        ? "doc"
        : file.mimeType === "application/vnd.google-apps.presentation"
          ? "slides"
          : null;
    if (!kind) return [];
    const fallbackUrl =
      kind === "doc"
        ? `https://docs.google.com/document/d/${encodeURIComponent(file.id)}/edit`
        : `https://docs.google.com/presentation/d/${encodeURIComponent(file.id)}/edit`;
    return [
      {
        id: file.id,
        name: file.name,
        kind,
        url: typeof file.webViewLink === "string" ? file.webViewLink : fallbackUrl,
        modifiedAt:
          typeof file.modifiedTime === "string" ? file.modifiedTime : null,
      },
    ];
  });

  res.json(ListGoogleFilesResponse.parse(files));
});

router.get(
  "/google/files/:fileId/content",
  async (req, res): Promise<void> => {
    const params = GetGoogleFileContentParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "The selected Google file is invalid." });
      return;
    }
    const email = getSession(req).email;
    if (!email) {
      res.status(401).json({ error: "Connect a Google account first." });
      return;
    }
    const accessToken = await getGoogleAccessToken(email);
    if (!accessToken) {
      res.status(401).json({ error: "Reconnect your Google account to continue." });
      return;
    }
    const fileId = params.data.fileId;
    const authHeaders = { Authorization: `Bearer ${accessToken}` };
    const metadataResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,webViewLink`,
      { headers: authHeaders },
    );
    if (metadataResponse.status === 404) {
      res.status(404).json({ error: "The selected Google file was not found." });
      return;
    }
    if (!metadataResponse.ok) {
      res.status(metadataResponse.status === 401 ? 401 : 502).json({
        error: "Google Drive could not open that file.",
      });
      return;
    }
    const metadata = asRecord(await metadataResponse.json());
    const mimeType = metadata?.mimeType;
    const kind =
      mimeType === "application/vnd.google-apps.document"
        ? "doc"
        : mimeType === "application/vnd.google-apps.presentation"
          ? "slides"
          : null;
    if (
      !kind ||
      typeof metadata?.name !== "string" ||
      typeof metadata.id !== "string"
    ) {
      res.status(404).json({ error: "This file type is not supported for study." });
      return;
    }
    const contentUrl =
      kind === "doc"
        ? `https://docs.googleapis.com/v1/documents/${encodeURIComponent(fileId)}`
        : `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(fileId)}`;
    const contentResponse = await fetch(contentUrl, { headers: authHeaders });
    if (!contentResponse.ok) {
      res.status(contentResponse.status === 401 ? 401 : 502).json({
        error: "Google could not read the text in that file.",
      });
      return;
    }
    const contentPayload = await contentResponse.json();
    const text = collectTextRuns(contentPayload).join("").slice(0, 18_000);
    const fallbackUrl =
      kind === "doc"
        ? `https://docs.google.com/document/d/${encodeURIComponent(fileId)}/edit`
        : `https://docs.google.com/presentation/d/${encodeURIComponent(fileId)}/edit`;
    const data = GetGoogleFileContentResponse.parse({
      id: metadata.id,
      title: metadata.name,
      kind,
      text,
      url: typeof metadata.webViewLink === "string" ? metadata.webViewLink : fallbackUrl,
    });
    res.json(data);
  },
);

router.post("/google/disconnect", async (req, res): Promise<void> => {
  const session = getSession(req);
  const email = session.email;
  if (email) {
    const connection = await getGoogleConnection(email);
    if (connection?.refreshTokenEncrypted) {
      const token = decryptGoogleToken(connection.refreshTokenEncrypted);
      try {
        await fetch("https://oauth2.googleapis.com/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token }),
        });
      } catch {
        req.log.warn("Could not revoke Google token during disconnect");
      }
    }
    await db
      .delete(googleConnectionsTable)
      .where(eq(googleConnectionsTable.email, email));
  }
  delete session.email;
  const data = DisconnectGoogleResponse.parse({ disconnected: true });
  res.json(data);
});

export default router;
