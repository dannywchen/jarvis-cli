import { SpacedReviewItem } from '../types/index.js';
import { loadReviewItems, saveReviewItems } from './storage.js';

/**
 * SuperMemo SM-2 algorithm implementation for terminal spaced repetition.
 */
export function calculateNextReview(
  item: SpacedReviewItem,
  grade: number // 0-5 (0=blackout, 3=pass with effort, 5=perfect recall)
): SpacedReviewItem {
  let { repetitionCount, intervalDays, easeFactor } = item;

  if (grade >= 3) {
    if (repetitionCount === 0) {
      intervalDays = 1;
    } else if (repetitionCount === 1) {
      intervalDays = 3;
    } else {
      intervalDays = Math.round(intervalDays * easeFactor);
    }
    repetitionCount += 1;
  } else {
    repetitionCount = 0;
    intervalDays = 1;
  }

  easeFactor = Math.max(
    1.3,
    easeFactor + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02))
  );

  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + intervalDays);
  const dueDate = nextDate.toISOString().split('T')[0];

  return {
    ...item,
    dueDate,
    intervalDays,
    repetitionCount,
    easeFactor,
  };
}

export async function getDueReviews(): Promise<SpacedReviewItem[]> {
  const items = await loadReviewItems();
  const today = new Date().toISOString().split('T')[0];
  return items.filter((item) => item.dueDate <= today);
}

export async function registerReviewItem(item: Omit<SpacedReviewItem, 'dueDate' | 'intervalDays' | 'repetitionCount' | 'easeFactor'>): Promise<void> {
  const items = await loadReviewItems();
  const existingIndex = items.findIndex((i) => i.id === item.id);
  const today = new Date().toISOString().split('T')[0];

  const fullItem: SpacedReviewItem = {
    ...item,
    dueDate: today,
    intervalDays: 1,
    repetitionCount: 0,
    easeFactor: 2.5,
  };

  if (existingIndex >= 0) {
    items[existingIndex] = fullItem;
  } else {
    items.push(fullItem);
  }

  await saveReviewItems(items);
}
