import { UserProfile, Course, SpacedReviewItem, ChatMessage, RecentThread, RecentThreadSummary } from '../types/index.js';
export interface CreateRecentThreadOptions {
    id?: string;
    title?: string;
    createdAt?: string;
    updatedAt?: string;
    provider?: string;
    model?: string;
    harness?: string;
}
export interface RecentThreadMetadata {
    provider?: string;
    model?: string;
    harness?: string;
}
/**
 * Jarvis writes new data to ~/.jarvis-cli. The legacy ~/.duocode directory is
 * read as a fallback and is never removed or overwritten, so existing courses,
 * profiles, reviews, and conversations continue to work after the rename.
 */
export declare function getStorageDirectory(): string;
export declare function ensureStorageDirectories(): Promise<void>;
export declare function sanitizeLoadedProfile(parsed: Partial<UserProfile>): UserProfile;
export declare function loadUserProfile(): Promise<UserProfile>;
export declare function saveUserProfile(profile: UserProfile): Promise<void>;
export declare function saveCourse(course: Course): Promise<void>;
export declare function loadCourse(courseId: string): Promise<Course | null>;
export declare function listSavedCourses(): Promise<Course[]>;
export declare function loadReviewItems(): Promise<SpacedReviewItem[]>;
export declare function saveReviewItems(items: SpacedReviewItem[]): Promise<void>;
export declare function loadRecentThreads(): Promise<RecentThread[]>;
export declare function saveRecentThreads(threads: RecentThread[]): Promise<void>;
export declare function createRecentThread(options?: CreateRecentThreadOptions): Promise<RecentThread>;
export declare function loadRecentThread(threadId: string): Promise<RecentThread | null>;
export declare function saveRecentThread(thread: RecentThread): Promise<RecentThread>;
export declare function appendRecentThreadMessage(threadId: string, message: Omit<ChatMessage, 'id' | 'createdAt'> & Partial<Pick<ChatMessage, 'id' | 'createdAt'>>, metadata?: RecentThreadMetadata): Promise<RecentThread | null>;
export declare function summarizeRecentThreads(threads: RecentThread[], limit?: number): RecentThreadSummary[];
export declare const loadRecentThreadHistory: typeof loadRecentThreads;
export declare const saveRecentThreadHistory: typeof saveRecentThreads;
