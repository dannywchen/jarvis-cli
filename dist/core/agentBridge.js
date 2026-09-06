import { queryActiveAgent } from './agentWrapper.js';
/**
 * Detects whether Jarvis CLI is running inside Antigravity, Claude Code, Codex, or standalone.
 */
export function detectAgentEnvironment() {
    if (process.env.ANTIGRAVITY_AGENT || process.env.ANTIGRAVITY_CONVERSATION_ID || process.env.ANTIGRAVITY_SOURCE_METADATA) {
        return {
            env: 'antigravity',
            name: 'Google Antigravity Agent',
            badge: 'Antigravity Bridge',
            description: 'Deep-reasoning agent with 2M context integration',
            hasLiveLlm: true,
        };
    }
    if (process.env.CLAUDE_CODE || process.env.CLAUDE_PROJECT || process.env.ANTHROPIC_API_KEY) {
        return {
            env: 'claude-code',
            name: 'Claude Code Agent',
            badge: 'Claude Code Bridge',
            description: 'Technical reasoning & terminal tool execution',
            hasLiveLlm: true,
        };
    }
    if (process.env.CODEX_THREAD_ID || process.env.OPENAI_API_KEY) {
        return {
            env: 'codex',
            name: 'OpenAI Codex Agent',
            badge: 'Codex Agent Bridge',
            description: 'GPT-5.6 Luna high-reasoning engine',
            hasLiveLlm: true,
        };
    }
    if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
        return {
            env: 'gemini',
            name: 'Google Gemini Direct',
            badge: 'Gemini 2.0 Flash',
            description: 'Direct high-speed multimodal LLM connection',
            hasLiveLlm: true,
        };
    }
    return {
        env: 'standalone',
        name: 'Jarvis CLI Autonomous Engine',
        badge: 'Jarvis CLI Engine',
        description: 'Procedural synthesizer with zero dependencies',
        hasLiveLlm: false,
    };
}
/**
 * Chat with Jarvis using the active agentic backend or live LLM.
 */
export async function chatWithAgentTutor(userQuery, profile, activeCourse) {
    const result = await queryActiveAgent(userQuery, profile, activeCourse, { userQuery });
    return { text: result.text, xpAwarded: result.xpAwarded };
}
