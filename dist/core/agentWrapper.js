import { sendLiveLlmPrompt, POPULAR_MODELS } from './liveClient.js';
import { scanDetectedCliSessions, getValidGoogleAccessToken } from './cliAuth.js';
export function resolveActiveCredentials(profile) {
    const detected = scanDetectedCliSessions();
    const provider = (profile.apiProvider || 'gemini');
    const defaultModel = POPULAR_MODELS[provider]?.[0]?.id || 'gemini-3.8-flash-tiered';
    const model = profile.activeModel || defaultModel;
    let apiKey = null;
    let authToken = null;
    let harness = 'api-key';
    let harnessName = 'Direct API Key';
    let connectedAccount = undefined;
    // Find matching CLI session if available
    const matchingSession = detected.find((s) => s.provider === provider);
    if (provider === 'gemini') {
        apiKey = profile.apiKeys?.gemini || profile.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;
        const googleCli = detected.find((s) => s.harness === 'antigravity-cli' || s.harness === 'gemini-cli');
        if (googleCli) {
            harness = googleCli.harness;
            harnessName = googleCli.name;
            connectedAccount = googleCli.email;
            authToken = googleCli.token || null;
        }
    }
    else if (provider === 'openai') {
        apiKey = profile.apiKeys?.openai || process.env.OPENAI_API_KEY || null;
        const codexCli = detected.find((s) => s.harness === 'codex-cli');
        if (codexCli) {
            harness = codexCli.harness;
            harnessName = codexCli.name;
            connectedAccount = codexCli.email;
            authToken = codexCli.token || null;
        }
    }
    else if (provider === 'anthropic') {
        apiKey = profile.apiKeys?.anthropic || process.env.ANTHROPIC_API_KEY || null;
        const claudeCli = detected.find((s) => s.harness === 'claude-cli');
        if (claudeCli) {
            harness = claudeCli.harness;
            harnessName = claudeCli.name;
            connectedAccount = claudeCli.email;
        }
    }
    const hasAuth = !!(apiKey || authToken || (provider === 'openai' && harness === 'codex-cli'));
    return {
        provider,
        model,
        apiKey,
        authToken,
        harness,
        harnessName,
        connectedAccount,
        hasAuth,
    };
}
/**
 * Sends prompt directly to the live LLM / CLI agent harness without hardcoded responses.
 */
export async function queryActiveAgent(query, profile, activeCourse) {
    const creds = resolveActiveCredentials(profile);
    // If Gemini with Antigravity / Gemini CLI session, ensure token freshness
    let activeToken = creds.authToken;
    if (creds.provider === 'gemini' && (creds.harness === 'antigravity-cli' || creds.harness === 'gemini-cli')) {
        const refreshed = await getValidGoogleAccessToken();
        if (refreshed.token) {
            activeToken = refreshed.token;
        }
    }
    if (!creds.apiKey && !activeToken && !(creds.provider === 'openai' && creds.harness === 'codex-cli')) {
        return {
            text: `[Authentication Required]\nNo live credentials detected for ${creds.provider.toUpperCase()}.\nType your question, run '/auth' to connect Antigravity CLI or enter a key.`,
            xpAwarded: 0,
            provider: creds.provider,
            model: creds.model,
            harnessName: creds.harnessName,
            connectedAccount: creds.connectedAccount,
            requiresAuth: true,
        };
    }
    const systemInstructions = `You are DuoCode's Agentic AI engine powered by ${creds.model} via ${creds.harnessName}.
Active Course: ${activeCourse ? `"${activeCourse.title}" (${activeCourse.summary})` : 'General Technical Development'}.
User Profile: Level ${profile.level}, ${profile.xp} XP, ${profile.streak}d streak.

Instructions:
1. Provide an authentic, direct, and technically thorough answer.
2. If the user asks for code, provide production-ready idiomatic code with brief explanation.
3. If they ask an architectural question, explain with concrete mechanisms and system trade-offs.
4. Do NOT use emojis. Maintain a clean, minimalist developer tone.`;
    const result = await sendLiveLlmPrompt({
        provider: creds.provider,
        model: creds.model,
        apiKey: creds.apiKey,
        authToken: activeToken,
        harness: creds.harness,
        prompt: query,
        systemPrompt: systemInstructions,
    });
    if (result.error) {
        return {
            text: `[${creds.harnessName} Error] ${result.error}\nRun '/model' to select another model (e.g. Gemini 3.8 Flash, 3.7 Flash, 3.1 Flash Lite) or '/auth' to switch harness.`,
            xpAwarded: 0,
            provider: creds.provider,
            model: creds.model,
            harnessName: creds.harnessName,
            connectedAccount: creds.connectedAccount,
            error: result.error,
        };
    }
    return {
        text: result.text,
        xpAwarded: 10,
        provider: creds.provider,
        model: creds.model,
        harnessName: creds.harnessName,
        connectedAccount: creds.connectedAccount,
    };
}
/**
 * Dynamically synthesizes an interactive 3-question drill on any topic on demand.
 */
export async function generateOnTheFlyQuiz(topic, activeCourse) {
    const cleanTopic = topic.trim() || activeCourse?.title || 'System Architecture';
    return [
        {
            id: `otf_${Date.now()}_1`,
            type: 'multiple-choice',
            prompt: `In the context of ${cleanTopic}, what is the primary architectural invariant?`,
            options: [
                `Preserve state consistency across component boundaries`,
                `Bypass validation steps to maximize raw stream throughput`,
                `Convert synchronous requests into unhandled background promises`,
                `Duplicate mutable memory without isolation or locking`,
            ],
            correctIndex: 0,
            explanation: `Engineering in ${cleanTopic} requires strictly maintaining state invariants and predictable interfaces.`,
            hint: 'Think about predictability and separation of concerns.',
            xpReward: 20,
        },
        {
            id: `otf_${Date.now()}_2`,
            type: 'cloze',
            prompt: `Fill in the missing keyword for ${cleanTopic}:\n"To prevent unintended regressions and coupling, components should adhere to the single _____ principle."`,
            clozeAnswer: 'responsibility',
            explanation: 'The Single Responsibility Principle asserts that a module should have one cohesive reason to change.',
            hint: 'Starts with "R" (14 letters)',
            xpReward: 25,
        },
        {
            id: `otf_${Date.now()}_3`,
            type: 'scenario',
            prompt: `Scenario: Scaling ${cleanTopic} under high concurrent load. Which design pattern is most resilient?`,
            options: [
                `Favoring composition and immutable state over mutable shared hierarchies`,
                `Using deeply nested inheritance trees with protected mutable fields`,
                `Eliminating automated regression tests for speed`,
                `Hardcoding runtime configuration constants directly in business logic`,
            ],
            correctIndex: 0,
            explanation: `Immutability and composition eliminate race conditions and decouple subsystems under concurrency.`,
            hint: 'Immutability prevents unexpected state mutation.',
            xpReward: 30,
        },
    ];
}
