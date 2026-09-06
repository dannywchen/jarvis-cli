import { UserProfile, Achievement } from '../types/index.js';

export const ALL_ACHIEVEMENTS = [
  { id: 'first_byte', name: 'First Byte', description: 'Complete your first lesson', icon: '[FIRST]' },
  { id: 'streak_3', name: 'On Fire', description: 'Maintain a 3-day learning streak', icon: '[STREAK]' },
  { id: 'streak_7', name: 'Unstoppable', description: 'Reach a 7-day learning streak', icon: '[STREAK_7]' },
  { id: 'xp_100', name: 'Centurion', description: 'Accumulate over 100 XP', icon: '[100_XP]' },
  { id: 'xp_500', name: 'Scholar', description: 'Accumulate over 500 XP', icon: '[500_XP]' },
  { id: 'master_1', name: 'Crown Bearer', description: 'Master your first skill node', icon: '[MASTER]' },
  { id: 'boss_slayer', name: 'Boss Slayer', description: 'Conquer a unit checkpoint challenge', icon: '[BOSS]' },
  { id: 'flawless', name: 'Flawless Victory', description: 'Finish a lesson with 100% accuracy', icon: '[FLAWLESS]' },
];

export function calculateLevel(xp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 40)) + 1;
}

export function getXpForLevel(level: number): number {
  return Math.round(Math.pow(level - 1, 2) * 40);
}

export function getXpForNextLevel(level: number): number {
  return Math.round(Math.pow(level, 2) * 40);
}

export function getLevelProgress(xp: number): { currentLevel: number; nextLevel: number; currentXp: number; targetXp: number; progressPercent: number } {
  const currentLevel = calculateLevel(xp);
  const currentBaseXp = getXpForLevel(currentLevel);
  const targetXp = getXpForNextLevel(currentLevel);
  const xpInLevel = Math.max(0, xp - currentBaseXp);
  const neededXp = Math.max(1, targetXp - currentBaseXp);
  const progressPercent = Math.min(100, Math.round((xpInLevel / neededXp) * 100));

  return {
    currentLevel,
    nextLevel: currentLevel + 1,
    currentXp: xp,
    targetXp,
    progressPercent,
  };
}

export function updateStreak(profile: UserProfile): { streakChanged: boolean; newStreak: number } {
  const today = new Date().toISOString().split('T')[0];
  const lastActive = profile.lastActiveDate;

  if (lastActive === today) {
    return { streakChanged: false, newStreak: profile.streak };
  }

  const todayDate = new Date(today);
  const lastDate = new Date(lastActive);
  const diffDays = Math.round((todayDate.getTime() - lastDate.getTime()) / (1000 * 3600 * 24));

  let newStreak = profile.streak;
  if (diffDays === 1) {
    newStreak += 1;
  } else if (diffDays > 1) {
    newStreak = 1;
  }

  profile.streak = newStreak;
  profile.lastActiveDate = today;

  return { streakChanged: true, newStreak };
}

export function awardXp(profile: UserProfile, amount: number): { oldLevel: number; newLevel: number; didLevelUp: boolean } {
  const oldLevel = calculateLevel(profile.xp);
  profile.xp += amount;
  const newLevel = calculateLevel(profile.xp);
  profile.level = newLevel;

  return {
    oldLevel,
    newLevel,
    didLevelUp: newLevel > oldLevel,
  };
}

export function checkNewAchievements(
  profile: UserProfile,
  context?: { isFlawless?: boolean; isBoss?: boolean; isMastery?: boolean }
): Achievement[] {
  const newlyUnlocked: Achievement[] = [];
  const existingIds = new Set(profile.achievements.map((a) => a.id));
  const now = new Date().toISOString();

  for (const def of ALL_ACHIEVEMENTS) {
    if (existingIds.has(def.id)) continue;

    let unlocked = false;
    switch (def.id) {
      case 'first_byte':
        if (profile.completedLessonsCount >= 1) unlocked = true;
        break;
      case 'streak_3':
        if (profile.streak >= 3) unlocked = true;
        break;
      case 'streak_7':
        if (profile.streak >= 7) unlocked = true;
        break;
      case 'xp_100':
        if (profile.xp >= 100) unlocked = true;
        break;
      case 'xp_500':
        if (profile.xp >= 500) unlocked = true;
        break;
      case 'master_1':
        if (profile.masteredSkillsCount >= 1 || context?.isMastery) unlocked = true;
        break;
      case 'boss_slayer':
        if (context?.isBoss) unlocked = true;
        break;
      case 'flawless':
        if (context?.isFlawless) unlocked = true;
        break;
    }

    if (unlocked) {
      const achievement: Achievement = {
        ...def,
        unlockedAt: now,
      };
      profile.achievements.push(achievement);
      newlyUnlocked.push(achievement);
    }
  }

  return newlyUnlocked;
}
