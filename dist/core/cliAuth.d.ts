export declare const GEMINI_CLIENT_ID: string;
export declare const GEMINI_CLIENT_SECRET: string;
export declare const ANTIGRAVITY_CLIENT_ID: string;
export declare const ANTIGRAVITY_CLIENT_SECRET: string;
export declare const GOOGLE_SCOPES: string[];
export declare const REDIRECT_PORT = 51121;
export declare const REDIRECT_URI = "http://localhost:51121/oauth-callback";
export interface CliSessionInfo {
    provider: "gemini" | "openai" | "anthropic";
    harness: "antigravity-cli" | "gemini-cli" | "codex-cli" | "claude-cli" | "api-key";
    name: string;
    email?: string;
    defaultModel: string;
    token?: string;
    hasValidSession: boolean;
}
export declare function scanDetectedCliSessions(): CliSessionInfo[];
export declare function getPrimaryCliSession(): CliSessionInfo | null;
export declare function getValidGoogleAccessToken(): Promise<{
    token: string | null;
    email?: string;
    harness: "antigravity-cli" | "gemini-cli" | null;
}>;
export declare function refreshGoogleToken(refreshToken: string, clientId: string, clientSecret: string): Promise<{
    access_token: string;
    expires_in?: number;
} | null>;
export declare function executeCodexPrompt(prompt: string, model?: string): Promise<{
    text: string;
    error?: string;
}>;
export declare function startGoogleOAuthServer(): Promise<{
    authUrl: string;
    waitForCredentials: () => Promise<{
        accessToken: string;
        refreshToken?: string;
        email?: string;
    }>;
}>;
