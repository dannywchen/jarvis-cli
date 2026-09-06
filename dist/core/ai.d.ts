import { ParsedDocument } from './parser.js';
import { Course, Pace, Question, AnswerEvaluation } from '../types/index.js';
import { evaluateOpenEndedAnswer } from './topicEngine.js';
export { evaluateOpenEndedAnswer };
export interface LlmConfig {
    provider?: 'gemini' | 'anthropic' | 'openai';
    apiKey?: string;
    model?: string;
}
export type { AnswerEvaluation };
/**
 * Calls an external LLM API (Gemini, Claude, or OpenAI) if configured,
 * otherwise returns null to trigger the procedural heuristic engine.
 */
export declare function generateCurriculumWithLlm(doc: ParsedDocument, pace: Pace, config?: LlmConfig): Promise<Course | null>;
/**
 * Dynamically evaluates free-form text or complex answers using AI reasoning.
 */
export declare function evaluateAnswerWithAi(question: Question, userAnswer: string, config?: LlmConfig): Promise<AnswerEvaluation>;
