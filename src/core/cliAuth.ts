import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import crypto from "crypto";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import "dotenv/config";

export const DEFAULT_CODEX_MODEL = "gpt-5.6-luna";
export const DEFAULT_CODEX_REASONING_EFFORT = "high" as const;

const execAsync = promisify(exec);

// OAuth client credentials stay outside the repository. Existing Gemini and
// Antigravity sessions continue to work without these values; they are only
// needed when starting a fresh browser-based Google OAuth flow.
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
const OAUTH_TIMEOUT_MS = 2 * 60 * 1000;

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

function getExpiryMs(tokenObject: Record<string, any>): number {
  const rawExpiry = tokenObject.expiry_date ?? tokenObject.expiry;
  if (typeof rawExpiry === "number") {
    return rawExpiry < 1_000_000_000_000 ? rawExpiry * 1000 : rawExpiry;
  }
  if (typeof rawExpiry === "string" && rawExpiry.trim()) {
    const parsed = Number(rawExpiry);
    if (Number.isFinite(parsed)) return parsed < 1_000_000_000_000 ? parsed * 1000 : parsed;
    return Date.parse(rawExpiry);
  }
  return 0;
}

function hasUsableGoogleCredential(tokenObject: Record<string, any>): boolean {
  const expiryMs = getExpiryMs(tokenObject);
  return !!tokenObject.refresh_token || (!!tokenObject.access_token && expiryMs > Date.now());
}

function readCachedGoogleEmail(home: string): string | undefined {
  try {
    const accountsPath = path.join(home, ".gemini", "google_accounts.json");
    const accounts = JSON.parse(fs.readFileSync(accountsPath, "utf-8"));
    return typeof accounts.active === "string" ? accounts.active : undefined;
  } catch {
    return undefined;
  }
}

export function getAntigravityCliPath(): string {
  const home = os.homedir();
  const candidates = [
    ...((process.env.PATH || "").split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, "agy"))),
    path.join(home, ".local", "bin", "agy"),
    "/opt/homebrew/bin/agy",
    "/usr/local/bin/agy",
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || "agy";
}

export function scanDetectedCliSessions(): CliSessionInfo[] {
  const home = os.homedir();
  const sessions: CliSessionInfo[] = [];

  const jetskiPath = path.join(home, ".gemini", "jetski-standalone-oauth-token");
  if (fs.existsSync(jetskiPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(jetskiPath, "utf-8"));
      const tokenObj = data.token || data;
      const email = parseJwtEmail(tokenObj.id_token) || readCachedGoogleEmail(home) || "Authenticated Google account";
      sessions.push({
        provider: "gemini",
        harness: "antigravity-cli",
        name: "Google Code Assist · Antigravity",
        email,
        defaultModel: "gemini-3.8-flash",
        token: tokenObj.access_token,
        hasValidSession: hasUsableGoogleCredential(tokenObj),
      });
    } catch {}
  }

  const geminiCredsPath = path.join(home, ".gemini", "oauth_creds.json");
  if (fs.existsSync(geminiCredsPath)) {
    try {
      const creds = JSON.parse(fs.readFileSync(geminiCredsPath, "utf-8"));
      const email = parseJwtEmail(creds.id_token) || readCachedGoogleEmail(home) || "Authenticated Google account";
      const alreadyHasAntigravity = sessions.some((s) => s.harness === "antigravity-cli");
      if (!alreadyHasAntigravity) {
        sessions.push({
          provider: "gemini",
          harness: "gemini-cli",
          name: "Google Code Assist · Gemini CLI",
          email,
          defaultModel: "gemini-3.8-flash",
          token: creds.access_token,
          hasValidSession: hasUsableGoogleCredential(creds),
        });
      }
    } catch {}
  }

  const codexPath = path.join(home, ".codex", "auth.json");
  if (fs.existsSync(codexPath)) {
    try {
      const codex = JSON.parse(fs.readFileSync(codexPath, "utf-8"));
      const tokens = codex.tokens || {};
      const email = parseJwtEmail(tokens.id_token) || "Authenticated ChatGPT account";
      sessions.push({
        provider: "openai",
        harness: "codex-cli",
        name: "ChatGPT Codex CLI",
        email,
        defaultModel: DEFAULT_CODEX_MODEL,
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
        name: "Claude Code",
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
      const email = parseJwtEmail(tokenObj.id_token) || readCachedGoogleEmail(home) || "Authenticated Google account";

      const expiryMs = getExpiryMs(tokenObj);
      const isExpired = !expiryMs || expiryMs < Date.now() + 5 * 60 * 1000;

      if (!isExpired && tokenObj.access_token) {
        return { token: tokenObj.access_token, email, harness: "antigravity-cli" };
      }

      if (tokenObj.refresh_token) {
        const refreshed = await refreshGoogleToken(
          tokenObj.refresh_token,
          ANTIGRAVITY_CLIENT_ID || GEMINI_CLIENT_ID,
          ANTIGRAVITY_CLIENT_SECRET || GEMINI_CLIENT_SECRET
        );
        if (refreshed?.access_token) {
          tokenObj.access_token = refreshed.access_token;
          if (refreshed.expires_in) {
            tokenObj.expiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
          }
          fs.writeFileSync(jetskiPath, JSON.stringify(data, null, 2), "utf-8");
          return { token: refreshed.access_token, email, harness: "antigravity-cli" };
        }
      }

    } catch {}
  }

  const credsPath = path.join(home, ".gemini", "oauth_creds.json");
  if (fs.existsSync(credsPath)) {
    try {
      const creds = JSON.parse(fs.readFileSync(credsPath, "utf-8"));
      const email = parseJwtEmail(creds.id_token) || readCachedGoogleEmail(home) || "Authenticated Google account";
      const expiryMs = getExpiryMs(creds);
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
  model = DEFAULT_CODEX_MODEL,
  reasoningEffort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra" = DEFAULT_CODEX_REASONING_EFFORT
): Promise<{ text: string; error?: string }> {
  return new Promise((resolve) => {
    const args = ["exec", "--ephemeral", "--skip-git-repo-check", "-m", model];
    if (/^gpt-5(?:\.|-|$)/i.test(model) || /^o\d/i.test(model)) {
      args.push("-c", `model_reasoning_effort="${reasoningEffort}"`);
    }
    args.push(prompt);

    const child = spawn("codex", args, {
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

export async function executeAntigravityPrompt(
  prompt: string,
  model = "gemini-3.8-flash-low"
): Promise<{ text: string; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn(getAntigravityCliPath(), ["--print", prompt, "--model", model, "--output-format", "text"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
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
        return;
      }
      resolve({
        text: "",
        error: stderr.trim() || stdout.trim() || `Antigravity CLI exited with code ${code}`,
      });
    });
    child.on("error", (err) => resolve({ text: "", error: `Could not start Antigravity CLI: ${err.message}` }));
  });
}

export async function runAntigravityCliLogin(): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn(getAntigravityCliPath(), ["--prompt-interactive"], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("close", (code) => resolve(code === 0 ? { success: true } : { success: false, error: `Antigravity CLI exited with code ${code}` }));
    child.on("error", (err) => resolve({ success: false, error: `Could not start Antigravity CLI: ${err.message}` }));
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
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        callback();
      };

      const server = http.createServer(async (req, res) => {
        try {
          const reqUrl = new URL(req.url || "/", `http://localhost:${REDIRECT_PORT}`);
          if (reqUrl.pathname !== "/oauth-callback") {
            res.writeHead(404);
            res.end();
            return;
          }

          const returnedState = reqUrl.searchParams.get("state");
          const oauthError = reqUrl.searchParams.get("error");
          if (oauthError || returnedState !== state) {
            res.writeHead(400, { "Content-Type": "text/plain" });
            res.end(oauthError ? `Authentication failed: ${oauthError}` : "Authentication failed: Invalid OAuth state");
            finish(() => reject(new Error(oauthError || "Invalid OAuth state")));
            server.close();
            return;
          }

          const code = reqUrl.searchParams.get("code");
          if (!code) {
            res.writeHead(400, { "Content-Type": "text/plain" });
            res.end("Authentication failed: Missing code");
            finish(() => reject(new Error("Missing authorization code")));
            server.close();
            return;
          }

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
          if (!tokenRes.ok || !tokens.access_token) {
            res.writeHead(502, { "Content-Type": "text/plain" });
            res.end("Google sign-in completed, but Jarvis CLI could not exchange the authorization code.");
            finish(() => reject(new Error(tokens.error_description || "Token exchange failed")));
            server.close();
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

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`
            <html>
              <body style="font-family: -apple-system, sans-serif; text-align: center; padding: 40px; background: #0f172a; color: #f8fafc;">
                <h1 style="color: #38bdf8;">Jarvis CLI Authenticated</h1>
                <p>Google credentials were captured successfully. You can return to your terminal.</p>
              </body>
            </html>
          `);
          finish(() => resolve({
              accessToken: tokens.access_token,
              refreshToken: tokens.refresh_token,
              email,
            })
          );
          server.close();
        } catch (err) {
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "text/plain" });
            res.end("Jarvis CLI could not complete Google authentication.");
          }
          finish(() => reject(err));
          server.close();
        }
      });

      const timeout = setTimeout(() => {
        finish(() => reject(new Error("Google sign-in timed out after 2 minutes.")));
        server.close();
      }, OAUTH_TIMEOUT_MS);

      server.listen(REDIRECT_PORT, () => {});
      server.on("error", (error) => finish(() => reject(error)));
    }
  );

  return {
    authUrl: authUrl.toString(),
    waitForCredentials: () => promise,
  };
}
