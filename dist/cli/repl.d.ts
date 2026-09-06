import { RecentThreadMetadata } from '../core/storage.js';
import { ChatMessageRole, RecentThread, RecentThreadSummary } from '../types/index.js';
export interface ReplHistorySnapshot {
    recentThreads: RecentThread[];
    activeThread: RecentThread | null;
    resumed: boolean;
}
export interface ReplHistoryCallbacks {
    onHistoryLoaded?: (snapshot: ReplHistorySnapshot) => void | Promise<void>;
    onHistoryChanged?: (snapshot: ReplHistorySnapshot) => void | Promise<void>;
    onThreadCreated?: (thread: RecentThread, snapshot: ReplHistorySnapshot) => void | Promise<void>;
    onThreadUpdated?: (thread: RecentThread, snapshot: ReplHistorySnapshot) => void | Promise<void>;
}
export interface JarvisCliHarnessOptions extends ReplHistoryCallbacks {
    threadId?: string;
    metadata?: RecentThreadMetadata;
}
export interface JarvisCliHarness {
    getSnapshot(): ReplHistorySnapshot;
    getThreadSummaries(limit?: number): RecentThreadSummary[];
    refresh(): Promise<ReplHistorySnapshot>;
    startNew(): Promise<ReplHistorySnapshot>;
    resume(threadId: string): Promise<RecentThread | null>;
    recordMessage(role: ChatMessageRole, text: string, metadata?: RecentThreadMetadata): Promise<RecentThread>;
    buildContinuationPrompt(query: string): string;
}
export declare function loadReplHistory(threadId?: string): Promise<ReplHistorySnapshot>;
export declare function createJarvisCliHarness(options?: JarvisCliHarnessOptions): Promise<JarvisCliHarness>;
export declare function startJarvisCliRepl(options?: JarvisCliHarnessOptions): Promise<void>;
export declare const startDuoCodeRepl: typeof startJarvisCliRepl;
