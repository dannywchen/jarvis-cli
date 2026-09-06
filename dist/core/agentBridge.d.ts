import { UserProfile, Course } from '../types/index.js';
export type AgentEnvironment = 'antigravity' | 'claude-code' | 'codex' | 'gemini' | 'standalone';
export interface AgentDetection {
    env: AgentEnvironment;
    name: string;
    badge: string;
    description: string;
    hasLiveLlm: boolean;
}
/**
 * Detects whether Jarvis CLI is running inside Antigravity, Claude Code, Codex, or standalone.
 */
export declare function detectAgentEnvironment(): AgentDetection;
/**
 * Chat with Jarvis using the active agentic backend or live LLM.
 */
export declare function chatWithAgentTutor(userQuery: string, profile: UserProfile, activeCourse?: Course | null): Promise<{
    text: string;
    xpAwarded: number;
}>;
