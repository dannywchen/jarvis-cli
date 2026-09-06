import chalk from 'chalk';
import boxen from 'boxen';
import * as p from '@clack/prompts';
import { Lesson, SkillNode, Course, UserProfile, Question } from '../../types/index.js';
import { awardXp, checkNewAchievements } from '../../core/gamification.js';
import { showConfetti, playChime, renderCombo, renderLevelUp } from '../effects.js';
import { registerReviewItem } from '../../core/spacedRepetition.js';
import { evaluateAnswerWithAi } from '../../core/ai.js';
import { detectAgentEnvironment } from '../../core/agentBridge.js';

export async function runLesson(
  lesson: Lesson,
  node: SkillNode,
  course: Course,
  profile: UserProfile
): Promise<{ success: boolean; xpEarned: number }> {
  console.clear();

  const agentInfo = detectAgentEnvironment();

  // 1. Lesson Header (OpenCode Minimalist)
  console.log('\n  ' + chalk.hex('#F8FAFC').bold(`[LESSON] ${lesson.title.toUpperCase()}`));
  console.log(chalk.hex('#64748B')(`  Node ${String(node.order).padStart(2, '0')}: ${node.title} · Source: ${course.title} · ${agentInfo.badge}\n`));

  // 2. Mental Model Digest Card
  const digestBox = boxen(
    chalk.hex('#CBD5E1').bold('DIGEST & MENTAL MODEL\n\n') +
      chalk.hex('#E2E8F0')(lesson.conceptDigest) +
      '\n\n' +
      chalk.hex('#38BDF8').bold('Core Rule:\n') +
      chalk.hex('#CBD5E1')(lesson.keyTakeaway) +
      (lesson.analogies && lesson.analogies.length > 0
        ? '\n\n' + chalk.hex('#94A3B8').bold('Analogy:\n') + chalk.hex('#94A3B8')(lesson.analogies[0].replace(/^[🦉🧩💡\s]+/, ''))
        : ''),
    {
      padding: 1,
      margin: { bottom: 1 },
      borderStyle: 'round',
      borderColor: 'gray',
    }
  );

  console.log(digestBox);

  const proceed = await p.confirm({
    message: 'Proceed to interactive drill questions?',
    initialValue: true,
  });

  if (p.isCancel(proceed) || !proceed) {
    p.outro(chalk.hex('#64748B')('Lesson paused. Progress saved.'));
    return { success: false, xpEarned: 0 };
  }

  // 3. Question Gauntlet
  let combo = 0;
  let totalXp = 0;
  let correctCount = 0;
  const totalQuestions = lesson.questions.length;

  for (let idx = 0; idx < totalQuestions; idx++) {
    const q = lesson.questions[idx];
    console.log('\n  ' + chalk.hex('#334155')('─'.repeat(54)));

    // HUD: Question progress, Combo, HP
    const qHeader = chalk.hex('#CBD5E1')(`[${String(idx + 1).padStart(2, '0')}/${String(totalQuestions).padStart(2, '0')}]`);
    const hpDisplay = profile.zenMode
      ? chalk.cyan('HP [ZEN]')
      : chalk.hex('#94A3B8')('HP [') +
        chalk.hex('#E2E8F0')('■'.repeat(profile.hearts)) +
        chalk.hex('#334155')('·'.repeat(Math.max(0, profile.maxHearts - profile.hearts))) +
        chalk.hex('#94A3B8')(` ${profile.hearts}/${profile.maxHearts}]`);

    console.log(`  ${qHeader}  ${hpDisplay}`);
    renderCombo(combo);

    let isCorrect = false;
    let earnedXp = q.xpReward;
    let aiFeedbackText = '';

    if (q.type === 'multiple-choice' || q.type === 'scenario') {
      const options = [
        ...(q.options || []).map((opt, i) => ({
          value: String(i),
          label: `${opt}`,
        })),
        {
          value: 'custom_ai',
          label: chalk.hex('#38BDF8')('Type your own explanation in freeform text (AI Evaluated)'),
        },
        {
          value: 'ask_hint',
          label: chalk.hex('#64748B')('Ask AI for a coaching hint'),
        },
      ];

      let choice = await p.select({
        message: q.prompt,
        options,
      });

      if (p.isCancel(choice)) {
        p.outro(chalk.hex('#64748B')('Lesson cancelled.'));
        return { success: false, xpEarned: totalXp };
      }

      // If user asks for hint
      if (choice === 'ask_hint') {
        console.log(
          boxen(
            chalk.hex('#94A3B8').bold('Coaching Hint:\n') +
              chalk.hex('#E2E8F0')(q.hint || `Focus on how this relates to ${node.title}.\nRemember: ${lesson.keyTakeaway}`),
            { padding: 1, borderColor: 'gray', borderStyle: 'round' }
          )
        );

        // Re-ask without hint option
        choice = await p.select({
          message: `${q.prompt} (Select your answer):`,
          options: options.filter((o) => o.value !== 'ask_hint'),
        });
        if (p.isCancel(choice)) return { success: false, xpEarned: totalXp };
      }

      if (choice === 'custom_ai') {
        const freeform = await p.text({
          message: 'Explain your reasoning in your own words:',
          placeholder: 'e.g. It coordinates state transitions because...',
        });
        if (p.isCancel(freeform) || !freeform) return { success: false, xpEarned: totalXp };

        const spinner = p.spinner();
        spinner.start(`✦ ${agentInfo.badge} analyzing reasoning...`);

        const evalResult = await evaluateAnswerWithAi(q, freeform as string, {
          provider: profile.apiProvider,
          apiKey: profile.apiKey,
        });

        spinner.stop('Evaluation complete:');

        isCorrect = evalResult.isCorrect;
        earnedXp = Math.round((q.xpReward * evalResult.scorePercentage) / 100);
        aiFeedbackText = `Agent Feedback: "${evalResult.feedback}" (Score: ${evalResult.scorePercentage}%)`;
      } else {
        isCorrect = Number(choice) === q.correctIndex;
      }
    } else if (q.type === 'cloze') {
      const input = await p.text({
        message: q.prompt,
        placeholder: 'Type the missing keyword or concept...',
      });

      if (p.isCancel(input)) {
        p.outro(chalk.hex('#64748B')('Lesson cancelled.'));
        return { success: false, xpEarned: totalXp };
      }

      const cleanInput = (input as string).trim();
      const spinner = p.spinner();
      spinner.start(`✦ ${agentInfo.badge} grading response...`);

      const evalResult = await evaluateAnswerWithAi(q, cleanInput, {
        provider: profile.apiProvider,
        apiKey: profile.apiKey,
      });

      spinner.stop('Graded:');

      isCorrect = evalResult.isCorrect;
      earnedXp = Math.max(10, Math.round((q.xpReward * evalResult.scorePercentage) / 100));
      aiFeedbackText = `Agent Feedback: "${evalResult.feedback}"`;
    } else if (q.type === 'match') {
      console.log(chalk.bold(q.prompt));
      const pair = q.matchPairs?.[0];
      if (pair) {
        const selected = await p.select({
          message: `Match definition for "${pair.term}":`,
          options: (q.matchPairs || []).map((pItem) => ({
            value: pItem.term,
            label: pItem.definition,
          })),
        });
        if (p.isCancel(selected)) return { success: false, xpEarned: totalXp };
        isCorrect = selected === pair.term;
      } else {
        isCorrect = true;
      }
    }

    // Feedback handling
    if (isCorrect) {
      playChime();
      combo += 1;
      correctCount += 1;

      // Calculate multiplier
      let multiplier = 1.0;
      if (combo === 2) multiplier = 1.2;
      else if (combo === 3) multiplier = 1.5;
      else if (combo >= 4) multiplier = 2.0;

      const earned = Math.round(earnedXp * multiplier);
      totalXp += earned;

      console.log(chalk.hex('#10B981').bold(`\n  [PASS] Correct. +${earned} XP`));
      if (aiFeedbackText) {
        console.log(chalk.hex('#6EE7B7')(`    ${aiFeedbackText}`));
      }
      console.log(chalk.hex('#94A3B8')(`    ${q.explanation}`));
    } else {
      combo = 0;
      if (!profile.zenMode) {
        profile.hearts = Math.max(0, profile.hearts - 1);
      }

      console.log(chalk.hex('#F87171').bold(`\n  [FAIL] Incorrect. (-1 HP)`));
      if (aiFeedbackText) {
        console.log(chalk.hex('#FCA5A5')(`    ${aiFeedbackText}`));
      }
      console.log(chalk.hex('#94A3B8')(`    ${q.explanation}`));
      if (q.hint) {
        console.log(chalk.hex('#64748B')(`    Tip: ${q.hint}`));
      }

      // Add to Spaced Repetition queue
      await registerReviewItem({
        id: `review_${course.id}_${q.id}`,
        nodeId: node.id,
        courseId: course.id,
        questionId: q.id,
        conceptTitle: node.title,
      });

      // Check heart depletion
      if (profile.hearts <= 0 && !profile.zenMode) {
        console.log(
          boxen(
            chalk.hex('#F87171').bold('OUT OF HEALTH SHIELDS\n\n') +
              chalk.hex('#CBD5E1')('You have depleted all active HP.\nRun practice mode (/practice) to restore shields or switch to Zen Mode.'),
            { padding: 1, borderColor: 'gray', borderStyle: 'round' }
          )
        );
        p.outro(chalk.hex('#64748B')('Lesson paused. Practice to recover HP.'));
        return { success: false, xpEarned: totalXp };
      }
    }
  }

  // 4. Lesson Victory Celebration
  await showConfetti();

  const isFlawless = correctCount === totalQuestions;
  const flawlessBonus = isFlawless ? 25 : 0;
  totalXp += flawlessBonus;

  const xpResult = awardXp(profile, totalXp);
  profile.completedLessonsCount += 1;
  lesson.isCompleted = true;
  lesson.crownCount += 1;

  // Unlock next node in course
  const currentIndex = course.nodes.findIndex((n) => n.id === node.id);
  if (currentIndex >= 0 && currentIndex + 1 < course.nodes.length) {
    if (course.nodes[currentIndex + 1].status === 'locked') {
      course.nodes[currentIndex + 1].status = 'active';
    }
  }

  // Check node mastery
  if (lesson.crownCount >= 2) {
    node.status = 'mastered';
    profile.masteredSkillsCount += 1;
  } else {
    node.status = 'completed';
  }

  // Check achievements
  const newBadges = checkNewAchievements(profile, {
    isFlawless,
    isBoss: node.isBossCheckpoint,
    isMastery: node.status === 'mastered',
  });

  if (xpResult.didLevelUp) {
    renderLevelUp(xpResult.newLevel);
  }

  // Victory summary card (OpenCode ASCII style)
  console.log(
    boxen(
      chalk.hex('#F8FAFC').bold('LESSON COMPLETE\n\n') +
        chalk.hex('#CBD5E1')(`Accuracy: ${Math.round((correctCount / totalQuestions) * 100)}% (${correctCount}/${totalQuestions})\n`) +
        chalk.hex('#38BDF8')(`XP Earned: +${totalXp} XP\n`) +
        (flawlessBonus > 0 ? chalk.hex('#F59E0B')('Flawless Bonus: +25 XP\n') : '') +
        chalk.hex('#CBD5E1')(`Total XP: ${profile.xp} (Level ${profile.level})\n`) +
        chalk.hex('#94A3B8')(`Streak: ${profile.streak} days active`),
      { padding: 1, borderColor: 'gray', borderStyle: 'round' }
    )
  );

  if (newBadges.length > 0) {
    for (const badge of newBadges) {
      console.log(chalk.hex('#38BDF8').bold(`  [UNLOCKED] ${badge.icon} ${badge.name} - ${badge.description}`));
    }
    console.log('');
  }

  p.outro(chalk.hex('#10B981').bold('Next roadmap node unlocked.'));
  return { success: true, xpEarned: totalXp };
}
