export type Pace = 'accelerated' | 'standard' | 'deep';
export type QuestionType = 'multiple-choice' | 'cloze' | 'match' | 'scenario';
export interface MatchPair {
    term: string;
    definition: string;
}
export interface Question {
    id: string;
    type: QuestionType;
    prompt: string;
    options?: string[];
    correctIndex?: number;
    clozeAnswer?: string;
    matchPairs?: MatchPair[];
    explanation: string;
    hint?: string;
    xpReward: number;
}
export interface Lesson {
    id: string;
    title: string;
    conceptDigest: string;
    keyTakeaway: string;
    analogies?: string[];
    questions: Question[];
    xpAwarded: number;
    isCompleted: boolean;
    crownCount: number;
}
export interface SkillNode {
    id: string;
    unitId: string;
    unitTitle: string;
    title: string;
    description: string;
    order: number;
    status: 'locked' | 'active' | 'completed' | 'mastered';
    lessons: Lesson[];
    isBossCheckpoint?: boolean;
}
export interface Course {
    id: string;
    title: string;
    sourceFileName: string;
    pace: Pace;
    createdAt: string;
    nodes: SkillNode[];
    summary: string;
}
export interface Achievement {
    id: string;
    name: string;
    description: string;
    unlockedAt: string;
    icon: string;
}
export interface UserProfile {
    name: string;
    xp: number;
    level: number;
    hearts: number;
    maxHearts: number;
    streak: number;
    lastActiveDate: string;
    zenMode: boolean;
    activeCourseId?: string;
    completedLessonsCount: number;
    masteredSkillsCount: number;
    achievements: Achievement[];
    apiKey?: string;
    apiProvider?: 'gemini' | 'anthropic' | 'openai';
    apiKeys?: {
        gemini?: string;
        anthropic?: string;
        openai?: string;
    };
    selectedAgent?: 'antigravity' | 'claude' | 'gemini' | 'codex' | 'autonomous';
    activeModel?: string;
}
export interface SpacedReviewItem {
    id: string;
    nodeId: string;
    courseId: string;
    questionId: string;
    conceptTitle: string;
    dueDate: string;
    intervalDays: number;
    repetitionCount: number;
    easeFactor: number;
}
