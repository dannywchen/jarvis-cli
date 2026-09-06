import { UserProfile, Course, Question, GeneratedLearningHistoryEntry } from '../types/index.js';
import { ProviderType } from './liveClient.js';
import { AgentActivitySink } from './agentTools.js';
export interface AgentResponse {
    text: string;
    xpAwarded: number;
    relevanceReason?: string;
    provider: ProviderType;
    model: string;
    harnessName?: string;
    connectedAccount?: string;
    error?: string;
    requiresAuth?: boolean;
}
export interface QueryActiveAgentOptions {
    onActivity?: AgentActivitySink;
    /** The current raw user turn, kept separate from the trusted continuation context. */
    userQuery?: string;
}
export interface RelevanceEvaluation {
    xpAwarded: number;
    relevanceReason?: string;
    category: 'banter' | 'basic' | 'in-depth';
}
export interface ResolvedAuth {
    provider: ProviderType;
    model: string;
    apiKey: string | null;
    authToken: string | null;
    harness: string;
    harnessName: string;
    connectedAccount?: string;
    hasAuth: boolean;
}
export declare function resolveActiveCredentials(profile: UserProfile): ResolvedAuth;
/**
 * Sends prompt directly to the live LLM / CLI agent harness without hardcoded responses.
 */
export declare function queryActiveAgent(query: string, profile: UserProfile, activeCourse?: Course | null, options?: QueryActiveAgentOptions): Promise<AgentResponse>;
export declare function shouldUseWorkspaceTools(query: string): boolean;
/**
 * Agentic query relevance evaluator:
 * - Casual banter / gibberish ("helo", "hey", "asdf", "lol", "what model are you") -> 0 XP!
 * - Basic question -> 5 XP.
 * - In-depth, thoughtful technical inquiry or insightful commentary -> 10 to 25 XP.
 */
export declare function evaluateQueryRelevance(query: string, activeCourse?: Course | null): RelevanceEvaluation;
export interface GeneratedFlashcard {
    front: string;
    back: string;
    hint?: string;
}
export interface LearningGenerationOptions {
    forceOffline?: boolean;
    timeoutMs?: number;
    mode?: 'quiz' | 'practice';
}
export declare function rememberGeneratedLearning(profile: UserProfile, kind: GeneratedLearningHistoryEntry['kind'], topic: string, prompts: string[]): void;
/** Generate a fresh, course-grounded drill and avoid prompts used in earlier attempts. */
export declare function generateOnTheFlyQuiz(topic: string, activeCourse?: Course | null, profile?: UserProfile, options?: LearningGenerationOptions): Promise<Question[]>;
/** Generate new flashcards from the active agent, with an unused course-card fallback. */
export declare function generateOnTheFlyFlashcards(topic: string, activeCourse?: Course | null, profile?: UserProfile, options?: LearningGenerationOptions): Promise<GeneratedFlashcard[]>;
