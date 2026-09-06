import { UserProfile, Course, Question } from '../types/index.js';
import { ProviderType } from './liveClient.js';
export interface AgentResponse {
    text: string;
    xpAwarded: number;
    provider: ProviderType;
    model: string;
    harnessName?: string;
    connectedAccount?: string;
    error?: string;
    requiresAuth?: boolean;
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
 * Dynamically synthesizes an interactive 3-question drill on any topic on demand.
 */
export declare function generateOnTheFlyQuiz(topic: string, activeCourse?: Course | null): Promise<Question[]>;
