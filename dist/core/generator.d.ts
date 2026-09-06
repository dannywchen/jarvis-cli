import { ParsedDocument } from './parser.js';
import { Course, Pace } from '../types/index.js';
import { LlmConfig } from './ai.js';
/**
 * Procedurally generates a comprehensive course from the parsed document.
 */
export declare function generateCourse(doc: ParsedDocument, pace?: Pace, config?: LlmConfig): Promise<Course>;
