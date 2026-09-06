export type Pace = 'accelerated' | 'standard' | 'deep';
export type LearningLevel = 'beginner' | 'intermediate' | 'advanced';
export type LearningMode = 'conceptual' | 'practical' | 'exam' | 'project';
/** The learner's north star. Optional so older courses remain readable. */
export interface LearningIntent {
    goal: string;
    targetOutcome?: string;
    level?: LearningLevel;
    preferredMode?: LearningMode;
    weeklyMinutes?: number;
    constraints?: string[];
}
export type QuestionType = 'multiple-choice' | 'cloze' | 'match' | 'scenario' | 'flashcard' | 'open-ended';
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
    flashcardBack?: string;
    rubric?: string;
    minSentences?: number;
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
    attemptCount?: number;
    masteryScore?: number;
    lastAttemptAt?: string;
    completedQuestionIds?: string[];
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
    intent?: LearningIntent;
    currentNodeId?: string;
    lastStudiedAt?: string;
}
export type CourseNextAction = 'lesson' | 'review' | 'complete';
export interface CourseProgress {
    completedNodes: number;
    totalNodes: number;
    completedLessons: number;
    totalLessons: number;
    progressPercentage: number;
    currentNodeId?: string;
    currentLessonId?: string;
    nextAction: CourseNextAction;
    dueReviewCount: number;
    estimatedMinutesRemaining: number;
}
export interface MicroConcept {
    id: string;
    order: number;
    title: string;
    digest: string;
    analogy: string;
    keyTakeaway: string;
    flashcards: Array<{
        term: string;
        explanation: string;
        hint?: string;
    }>;
    questions: Question[];
}
export interface TopicDecomposition {
    topic: string;
    overview: string;
    concepts: MicroConcept[];
}
export interface AnswerEvaluation {
    isCorrect: boolean;
    scorePercentage: number;
    feedback: string;
    suggestedImprovement?: string;
    xpEarned?: number;
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
export type ChatMessageRole = 'user' | 'assistant' | 'system';
/** A durable, rendering-agnostic message in a Jarvis CLI thread. */
export interface ChatMessage {
    id: string;
    role: ChatMessageRole;
    text: string;
    createdAt: string;
}
/**
 * A locally persisted conversation. Keeping the full message list here lets
 * any intro screen or alternate renderer decide how much history to show.
 */
export interface RecentThread {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    messages: ChatMessage[];
    provider?: string;
    model?: string;
    harness?: string;
}
/** Compact data suitable for a recent-thread picker or intro screen. */
export interface RecentThreadSummary {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    messageCount: number;
    preview: string;
    provider?: string;
    model?: string;
    harness?: string;
}
export interface RecentThreadHistory {
    version: 1;
    threads: RecentThread[];
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
