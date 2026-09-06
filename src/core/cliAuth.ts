import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import crypto from "crypto";
import { exec, spawn } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export const GEMINI_CLIENT_ID = process.env.GEMINI_CLIENT_ID || "";
export const GEMINI_CLIENT_SECRET = process.env.GEMINI_CLIENT_SECRET || "";

export const ANTIGRAVITY_CLIENT_ID = process.env.ANTIGRAVITY_CLIENT_ID || "";
export const ANTIGRAVITY_CLIENT_SECRET = process.env.ANTIGRAVITY_CLIENT_SECRET || "";

export const GOOGLE_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cloud-platform",
];

export const REDIRECT_PORT = 51121;
export const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth-callback`;

export interface CliSessionInfo {
  provider: "gemini" | "openai" | "anthropic";
  harness: "antigravity-cli" | "gemini-cli" | "codex-cli" | "claude-cli" | "api-key";
  name: string;
  email?: string;
  defaultModel: string;
  token?: string;
  hasValidSession: boolean;
}

function parseJwtEmail(jwtToken?: string): string | undefined {
  if (!jwtToken || !jwtToken.includes(".")) return undefined;
  try {
    const parts = jwtToken.split(".");
    if (parts.length < 2) return undefined;
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf-8"));
    return payload.email || payload.sub;
  } catch {
    return undefined;
  }
}

export function scanDetectedCliSessions(): CliSessionInfo[] {
  const home = os.homedir();
  const sessions: CliSessionInfo[] = [];

  const jetskiPath = path.join(home, ".gemini", "jetski-standalone-oauth-token");
  if (fs.existsSync(jetskiPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(jetskiPath, "utf-8"));
      const tokenObj = data.token || data;
      const email = parseJwtEmail(tokenObj.id_token) || "dannywchenofficial@gmail.com";
      sessions.push({
        provider: "gemini",
        harness: "antigravity-cli",
        name: "Antigravity CLI (OAuth)",
        email,
        defaultModel: "gemini-3.8-flash-tiered",
        token: tokenObj.access_token,
        hasValidSession: !!(tokenObj.access_token || tokenObj.refresh_token),
      });
    } catch {}
  }

  const geminiCredsPath = path.join(home, ".gemini", "oauth_creds.json");
  if (fs.existsSync(geminiCredsPath)) {
    try {
      const creds = JSON.parse(fs.readFileSync(geminiCredsPath, "utf-8"));
      const email = parseJwtEmail(creds.id_token) || "dannywchenofficial@gmail.com";
      const alreadyHasAntigravity = sessions.some((s) => s.harness === "antigravity-cli");
      if (!alreadyHasAntigravity) {
        sessions.push({
          provider: "gemini",
          harness: "gemini-cli",
          name: "Gemini CLI (OAuth)",
          email,
          defaultModel: "gemini-3.8-flash-tiered",
          token: creds.access_token,
          hasValidSession: !!(creds.access_token || creds.refresh_token),
        });
      }
    } catch {}
  }

  const codexPath = path.join(home, ".codex", "auth.json");
  if (fs.existsSync(codexPath)) {
    try {
      const codex = JSON.parse(fs.readFileSync(codexPath, "utf-8"));
      const tokens = codex.tokens || {};
      const email = parseJwtEmail(tokens.id_token) || "dannywchenofficial@gmail.com";
      sessions.push({
        provider: "openai",
        harness: "codex-cli",
        name: "OpenAI Codex CLI",
        email,
        defaultModel: "gpt-4o",
        token: tokens.access_token,
        hasValidSession: !!(tokens.access_token || codex.auth_mode === "chatgpt"),
      });
    } catch {}
  }

  const claudePath = path.join(home, ".claude.json");
  if (fs.existsSync(claudePath)) {
    try {
      const claude = JSON.parse(fs.readFileSync(claudePath, "utf-8"));
      const email = claude.oauthAccount?.emailAddress || "Anthropic User";
      sessions.push({
        provider: "anthropic",
        harness: "claude-cli",
        name: "Claude Code CLI",
        email,
        defaultModel: "claude-3-5-sonnet-20241022",
        hasValidSession: !!claude.oauthAccount?.emailAddress,
      });
    } catch {}
  }

  return sessions;
}

export function getPrimaryCliSession(): CliSessionInfo | null {
  const sessions = scanDetectedCliSessions();
  if (sessions.length === 0) return null;

  const google = sessions.find((s) => s.harness === "antigravity-cli" || s.harness === "gemini-cli");
  if (google) return google;

  const codex = sessions.find((s) => s.harness === "codex-cli");
  if (codex) return codex;

  return sessions[0];
}

export async function getValidGoogleAccessToken(): Promise<{
  token: string | null;
  email?: string;
  harness: "antigravity-cli" | "gemini-cli" | null;
}> {
  const home = os.homedir();

  const jetskiPath = path.join(home, ".gemini", "jetski-standalone-oauth-token");
  if (fs.existsSync(jetskiPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(jetskiPath, "utf-8"));
      const tokenObj = data.token || data;
      const email = parseJwtEmail(tokenObj.id_token) || "dannywchenofficial@gmail.com";

      const expiryMs = tokenObj.expiry ? new Date(tokenObj.expiry).getTime() : 0;
      const isExpired = !expiryMs || expiryMs < Date.now() + 5 * 60 * 1000;

      if (!isExpired && tokenObj.access_token) {
        return { token: tokenObj.access_token, email, harness: "antigravity-cli" };
      }

      if (tokenObj.refresh_token) {
        const refreshed = await refreshGoogleToken(tokenObj.refresh_token, ANTIGRAVITY_CLIENT_ID, ANTIGRAVITY_CLIENT_SECRET);
        if (refreshed?.access_token) {
          tokenObj.access_token = refreshed.access_token;
          if (refreshed.expires_in) {
            tokenObj.expiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
          }
          fs.writeFileSync(jetskiPath, JSON.stringify(data, null, 2), "utf-8");
          return { token: refreshed.access_token, email, harness: "antigravity-cli" };
        }
      }

      if (tokenObj.access_token) {
        return { token: tokenObj.access_token, email, harness: "antigravity-cli" };
      }
    } catch {}
  }

  const credsPath = path.join(home, ".gemini", "oauth_creds.json");
  if (fs.existsSync(credsPath)) {
    try {
      const creds = JSON.parse(fs.readFileSync(credsPath, "utf-8"));
      const email = parseJwtEmail(creds.id_token) || "dannywchenofficial@gmail.com";
      const expiryMs = creds.expiry_date || 0;
      const isExpired = !expiryMs || expiryMs < Date.now() + 5 * 60 * 1000;

      if (!isExpired && creds.access_token) {
        return { token: creds.access_token, email, harness: "gemini-cli" };
      }

      if (creds.refresh_token) {
        const refreshed = await refreshGoogleToken(creds.refresh_token, GEMINI_CLIENT_ID, GEMINI_CLIENT_SECRET);
        if (refreshed?.access_token) {
          creds.access_token = refreshed.access_token;
          if (refreshed.expires_in) {
            creds.expiry_date = Date.now() + refreshed.expires_in * 1000;
          }
          fs.writeFileSync(credsPath, JSON.stringify(creds, null, 2), "utf-8");
          return { token: refreshed.access_token, email, harness: "gemini-cli" };
        }
      }

      if (creds.access_token) {
        return { token: creds.access_token, email, harness: "gemini-cli" };
      }
    } catch {}
  }

  return { token: null, harness: null };
}

export async function refreshGoogleToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<{ access_token: string; expires_in?: number } | null> {
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as any;
    return data;
  } catch {
    return null;
  }
}

export async function executeCodexPrompt(
  prompt: string,
  model = "gpt-4o"
): Promise<{ text: string; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn("codex", ["exec", "--ephemeral", "--skip-git-repo-check", "-m", model, prompt], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code === 0 && stdout.trim()) {
        resolve({ text: stdout.trim() });
      } else {
        const err = stderr.trim() || stdout.trim() || `Codex exited with code ${code}`;
        resolve({ text: "", error: err });
      }
    });

    child.on("error", (err) => {
      resolve({ text: "", error: err.message });
    });
  });
}

export async function startGoogleOAuthServer(): Promise<{
  authUrl: string;
  waitForCredentials: () => Promise<{ accessToken: string; refreshToken?: string; email?: string }>;
}> {
  if (!GEMINI_CLIENT_ID || !GEMINI_CLIENT_SECRET) {
    throw new Error("Google OAuth requires GEMINI_CLIENT_ID and GEMINI_CLIENT_SECRET environment variables.");
  }

  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const state = crypto.randomBytes(16).toString("hex");

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", GEMINI_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");

  const promise = new Promise<{ accessToken: string; refreshToken?: string; email?: string }>(
    (resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        try {
          const reqUrl = new URL(req.url || "/", `http://localhost:${REDIRECT_PORT}`);
          if (reqUrl.pathname !== "/oauth-callback") {
            res.writeHead(404);
            res.end();
            return;
          }

          const code = reqUrl.searchParams.get("code");
          if (!code) {
            res.writeHead(400, { "Content-Type": "text/plain" });
            res.end("Authentication failed: Missing code");
            reject(new Error("Missing authorization code"));
            server.close();
            return;
          }

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`
            <html>
              <body style="font-family: -apple-system, sans-serif; text-align: center; padding: 40px; background: #0f172a; color: #f8fafc;">
                <h1 style="color: #38bdf8;">DuoCode Authenticated</h1>
                <p>Google Antigravity / Gemini CLI credentials captured. You can return to your terminal.</p>
              </body>
            </html>
          `);
          server.close();

          const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: GEMINI_CLIENT_ID,
              client_secret: GEMINI_CLIENT_SECRET,
              code,
              grant_type: "authorization_code",
              redirect_uri: REDIRECT_URI,
              code_verifier: verifier,
            }),
          });

          const tokens = (await tokenRes.json()) as any;
          if (!tokens.access_token) {
            reject(new Error(tokens.error_description || "Token exchange failed"));
            return;
          }

          const email = parseJwtEmail(tokens.id_token) || "Google User";

          const home = os.homedir();
          const geminiDir = path.join(home, ".gemini");
          if (!fs.existsSync(geminiDir)) fs.mkdirSync(geminiDir, { recursive: true });
          fs.writeFileSync(
            path.join(geminiDir, "oauth_creds.json"),
            JSON.stringify(
              {
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
                id_token: tokens.id_token,
                token_type: tokens.token_type || "Bearer",
                expiry_date: Date.now() + (tokens.expires_in || 3600) * 1000,
                scope: tokens.scope,
              },
              null,
              2
            ),
            "utf-8"
          );

          resolve({
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            email,
          });
        } catch (err) {
          reject(err);
          server.close();
        }
      });

      server.listen(REDIRECT_PORT, () => {});
      server.on("error", reject);
    }
  );

  return {
    authUrl: authUrl.toString(),
    waitForCredentials: () => promise,
  };
}
