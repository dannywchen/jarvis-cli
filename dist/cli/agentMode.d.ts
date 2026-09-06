import { LearningIntent, Pace } from '../types/index.js';
export declare function handleAgentStatus(): Promise<void>;
export declare function handleAgentIngest(filePath: string, pace?: Pace, intent?: LearningIntent): Promise<void>;
export declare function handleAgentLesson(nodeId?: string): Promise<void>;
export declare function handleAgentSubmitAnswer(options: {
    nodeId?: string;
    lessonId?: string;
    questionId: string;
    answer: string;
}): Promise<void>;
export declare function handleAgentDecompose(topic: string, intent?: LearningIntent): Promise<void>;
/** Machine-readable course library and active-course switcher. */
export declare function handleAgentCourses(selector?: string): Promise<void>;
