import { Pace } from '../types/index.js';
export declare function handleAgentStatus(): Promise<void>;
export declare function handleAgentIngest(filePath: string, pace?: Pace): Promise<void>;
export declare function handleAgentLesson(nodeId?: string): Promise<void>;
export declare function handleAgentSubmitAnswer(options: {
    nodeId?: string;
    lessonId?: string;
    questionId: string;
    answer: string;
}): Promise<void>;
export declare function handleAgentDecompose(topic: string): Promise<void>;
