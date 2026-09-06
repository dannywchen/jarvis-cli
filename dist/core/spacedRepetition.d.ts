import { SpacedReviewItem } from '../types/index.js';
/**
 * SuperMemo SM-2 algorithm implementation for terminal spaced repetition.
 */
export declare function calculateNextReview(item: SpacedReviewItem, grade: number): SpacedReviewItem;
export declare function getDueReviews(): Promise<SpacedReviewItem[]>;
export declare function registerReviewItem(item: Omit<SpacedReviewItem, 'dueDate' | 'intervalDays' | 'repetitionCount' | 'easeFactor'>): Promise<void>;
