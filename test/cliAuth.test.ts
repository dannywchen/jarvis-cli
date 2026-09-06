import assert from "node:assert";
import { scanDetectedCliSessions, getPrimaryCliSession, startGoogleOAuthServer } from "../src/core/cliAuth.js";
import { resolveActiveCredentials } from "../src/core/agentWrapper.js";

async function runCliAuthTests() {
  console.log("🧪 Testing DuoCode CLI Authentication & Auto-Detection...");

  // 1. Session detection
  const sessions = scanDetectedCliSessions();
  assert(Array.isArray(sessions), "scanDetectedCliSessions should return an array");
  console.log("  ✓ Detected " + sessions.length + " local CLI sessions");
  
  const antigravity = sessions.find((s) => s.harness === "antigravity-cli");
  assert(antigravity, "Antigravity CLI session must be detected");
  assert.strictEqual(antigravity.defaultModel, "gemini-2.0-flash", "Default model must be gemini-2.0-flash");
  assert(antigravity.email, "Session should identify user email");
  console.log("  ✓ Antigravity CLI detected for: " + antigravity.email);

  const codex = sessions.find((s) => s.harness === "codex-cli");
  assert(codex, "OpenAI Codex CLI session must be detected");
  assert.strictEqual(codex.defaultModel, "gpt-4o", "Default model must be gpt-4o");
  console.log("  ✓ OpenAI Codex CLI detected for: " + codex.email);

  // 2. Primary session resolution
  const primary = getPrimaryCliSession();
  assert(primary, "Primary session should be resolved");
  console.log("  ✓ Primary session resolved: " + primary.name);

  // 3. Credentials resolution with latest model defaults
  const mockProfile = {
    id: "test_user",
    name: "Developer",
    xp: 100,
    level: 2,
    streak: 3,
    lastActiveDate: new Date().toISOString(),
    hearts: 5,
    maxHearts: 5,
    badges: [],
    completedLessons: [],
    weakConcepts: [],
    reviewQueue: [],
    zenMode: false,
    apiProvider: "gemini",
  };

  const creds = resolveActiveCredentials(mockProfile);
  assert.strictEqual(creds.provider, "gemini");
  assert.strictEqual(creds.model, "gemini-2.0-flash", "Gemini must default to latest model gemini-2.0-flash");
  assert(creds.harnessName.includes("Antigravity"), "Harness name should identify Antigravity");
  console.log("  ✓ Resolved active credentials: " + creds.harnessName + " (" + creds.model + ")");

  // Switch to OpenAI
  mockProfile.apiProvider = "openai";
  const codexCreds = resolveActiveCredentials(mockProfile);
  assert.strictEqual(codexCreds.provider, "openai");
  assert.strictEqual(codexCreds.model, "gpt-4o", "OpenAI must default to latest model gpt-4o");
  console.log("  ✓ Resolved OpenAI Codex credentials: " + codexCreds.harnessName + " (" + codexCreds.model + ")");

  // Switch to Claude
  mockProfile.apiProvider = "anthropic";
  const claudeCreds = resolveActiveCredentials(mockProfile);
  assert.strictEqual(claudeCreds.provider, "anthropic");
  assert.strictEqual(claudeCreds.model, "claude-3-5-sonnet-20241022", "Claude must default to latest model claude-3-5-sonnet-20241022");
  console.log("  ✓ Resolved Claude credentials: " + claudeCreds.harnessName + " (" + claudeCreds.model + ")");

  console.log("\n✨ CLI AUTH TESTS PASSED SUCCESSFULLY! ✨\n");
}

runCliAuthTests().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
