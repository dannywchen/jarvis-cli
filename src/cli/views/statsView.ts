import chalk from 'chalk';
import boxen from 'boxen';
import { UserProfile } from '../../types/index.js';
import { getLevelProgress, ALL_ACHIEVEMENTS } from '../../core/gamification.js';
import { getDueReviews } from '../../core/spacedRepetition.js';

export async function renderStats(profile: UserProfile): Promise<void> {
  const levelInfo = getLevelProgress(profile.xp);
  const dueItems = await getDueReviews();

  const barWidth = 20;
  const filled = Math.round((levelInfo.progressPercent / 100) * barWidth);
  const progressBar = chalk.hex('#F8FAFC')('█'.repeat(filled)) + chalk.hex('#334155')('░'.repeat(barWidth - filled));

  const hpBar = profile.zenMode
    ? 'Zen (Infinite)'
    : `${profile.hearts}/${profile.maxHearts}`;

  const profileText =
    chalk.hex('#F8FAFC').bold(`PROFILE: ${profile.name.toUpperCase()}\n\n`) +
    `Level: ${chalk.white.bold(String(levelInfo.currentLevel))} -> Next Level ${levelInfo.nextLevel}\n` +
    `Progress: [${progressBar}] ${levelInfo.progressPercent}%\n` +
    `XP: ${chalk.white.bold(String(profile.xp))} / Target: ${levelInfo.targetXp}\n\n` +
    `Streak: ${chalk.white(`${profile.streak} days active`)}\n` +
    `Health: ${chalk.white(hpBar)}\n` +
    `Completed Lessons: ${chalk.white(String(profile.completedLessonsCount))}\n` +
    `Mastered Nodes: ${chalk.white(String(profile.masteredSkillsCount))}\n` +
    `Reviews Due: ${dueItems.length > 0 ? chalk.yellow(`${dueItems.length} cards waiting`) : chalk.hex('#94A3B8')('0 (Up to date)')}`;

  console.log(
    boxen(profileText, {
      padding: 1,
      borderColor: 'gray',
      borderStyle: 'round',
    })
  );

  // Achievements section
  console.log(chalk.hex('#94A3B8').bold('  ACHIEVEMENTS'));
  const unlockedIds = new Set(profile.achievements.map((a) => a.id));

  for (const ach of ALL_ACHIEVEMENTS) {
    const isUnlocked = unlockedIds.has(ach.id);
    const mark = isUnlocked ? chalk.hex('#38BDF8').bold('[x]') : chalk.hex('#475569')('[ ]');
    const name = isUnlocked ? chalk.hex('#F8FAFC')(ach.name.padEnd(18)) : chalk.hex('#64748B')(ach.name.padEnd(18));
    const desc = isUnlocked ? chalk.hex('#94A3B8')(ach.description) : chalk.hex('#475569')(ach.description);

    console.log(`  ${mark} ${name} ${desc}`);
  }
  console.log('');
}
