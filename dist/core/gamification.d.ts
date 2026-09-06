import { UserProfile, Achievement } from '../types/index.js';
export declare const ALL_ACHIEVEMENTS: {
    id: string;
    name: string;
    description: string;
    icon: string;
}[];
export declare function calculateLevel(xp: number): number;
export declare function getXpForLevel(level: number): number;
export declare function getXpForNextLevel(level: number): number;
export declare function getLevelProgress(xp: number): {
    currentLevel: number;
    nextLevel: number;
    currentXp: number;
    targetXp: number;
    progressPercent: number;
};
export declare function updateStreak(profile: UserProfile): {
    streakChanged: boolean;
    newStreak: number;
};
export declare function awardXp(profile: UserProfile, amount: number): {
    oldLevel: number;
    newLevel: number;
    didLevelUp: boolean;
};
export declare function checkNewAchievements(profile: UserProfile, context?: {
    isFlawless?: boolean;
    isBoss?: boolean;
    isMastery?: boolean;
}): Achievement[];
