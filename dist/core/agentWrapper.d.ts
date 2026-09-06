import { UserProfile, Course, Question } from '../types/index.js';
import { ProviderType } from './liveClient.js';
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
export declare function queryActiveAgent(query: string, profile: UserProfile, activeCourse?: Course | null): Promise<AgentResponse>;
/**
 * Agentic query relevance evaluator:
 * - Casual banter / gibberish ("helo", "hey", "asdf", "lol", "what model are you") -> 0 XP!
 * - Basic question -> 5 XP.
 * - In-depth, thoughtful technical inquiry or insightful commentary -> 10 to 25 XP.
 */
export declare function evaluateQueryRelevance(query: string, activeCourse?: Course | null): RelevanceEvaluation;
/**
 * Dynamically synthesizes an interactive 3-question drill on any topic on demand.
 */
export declare function generateOnTheFlyQuiz(topic: string, activeCourse?: Course | null): Promise<Question[]>;
