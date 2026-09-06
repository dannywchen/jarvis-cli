import chalk from 'chalk';
import { Course, SkillNode } from '../../types/index.js';
import { getCourseProgress, normalizeLearningIntent } from '../../core/learningEngine.js';

export function renderRoadmap(course: Course): void {
  console.log('');
  console.log(chalk.hex('#F8FAFC').bold(`  ROADMAP: ${course.title.toUpperCase()}`));
  console.log(chalk.hex('#64748B')(`  ${course.summary} · PACE: [${course.pace.toUpperCase()}]`));
  const intent = normalizeLearningIntent(course.intent, course.title);
  const progress = getCourseProgress(course);
  console.log(chalk.hex('#94A3B8')(`  Goal: ${intent.goal}`));
  console.log(chalk.hex('#94A3B8')(`  Target: ${intent.targetOutcome} · Level: ${intent.level} · Mode: ${intent.preferredMode}`));
  console.log('');

  const completedCount = progress.completedNodes;
  const progressPct = progress.totalNodes ? Math.round((completedCount / progress.totalNodes) * 100) : 0;

  // Clean ASCII progress bar
  const totalSlots = 24;
  const filledSlots = Math.round((progressPct / 100) * totalSlots);
  const progressBar = chalk.hex('#E2E8F0')('■'.repeat(filledSlots)) + chalk.hex('#334155')('·'.repeat(totalSlots - filledSlots));
  console.log(`  Progress [${progressBar}] ${progressPct}% (${completedCount}/${course.nodes.length} nodes) · ~${progress.estimatedMinutesRemaining} min left\n`);

  // Group nodes by unit
  const unitsMap = new Map<string, { title: string; nodes: SkillNode[] }>();
  for (const node of course.nodes) {
    if (!unitsMap.has(node.unitId)) {
      unitsMap.set(node.unitId, { title: node.unitTitle, nodes: [] });
    }
    unitsMap.get(node.unitId)!.nodes.push(node);
  }

  for (const [_, unit] of unitsMap.entries()) {
    const unitTitleClean = unit.title.toUpperCase();
    console.log(chalk.hex('#94A3B8')(`  ┌─ ${unitTitleClean} ` + '─'.repeat(Math.max(4, 54 - unitTitleClean.length))));

    const nodes = unit.nodes;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const isLast = i === nodes.length - 1;
      const branch = isLast ? '└──' : '├──';
      const pipe = isLast ? '   ' : '│  ';

      const orderStr = String(node.order).padStart(2, '0');
      let statusPill = '';
      let titleFormatted = '';

      if (node.status === 'mastered') {
        statusPill = chalk.hex('#E2E8F0').bold('[MASTERED]');
        titleFormatted = chalk.hex('#E2E8F0').bold(node.title.replace(/^[⚔️\s]+/, ''));
      } else if (node.status === 'completed') {
        statusPill = chalk.hex('#94A3B8')('[DONE]');
        titleFormatted = chalk.hex('#94A3B8')(node.title.replace(/^[⚔️\s]+/, ''));
      } else if (node.status === 'active') {
        statusPill = chalk.hex('#38BDF8').bold('[ACTIVE]');
        titleFormatted = chalk.hex('#F8FAFC').bold(node.title.replace(/^[⚔️\s]+/, ''));
      } else {
        statusPill = chalk.hex('#475569')('[LOCKED]');
        titleFormatted = chalk.hex('#64748B')(node.title.replace(/^[⚔️\s]+/, ''));
      }

      if (node.isBossCheckpoint && node.status !== 'completed' && node.status !== 'mastered') {
        statusPill = chalk.hex('#F59E0B')('[CHECKPOINT]');
      }

      const nodeLine = `  ${chalk.hex('#475569')(branch)} [${orderStr}] ${titleFormatted}`;
      const padding = Math.max(2, 60 - node.title.length);
      const dots = chalk.hex('#1E293B')('.'.repeat(padding));

      console.log(`${nodeLine} ${dots} ${statusPill}`);
      console.log(`  ${chalk.hex('#475569')(pipe)}      ${chalk.dim(node.description.slice(0, 65))}`);
      if (!isLast) {
        console.log(`  ${chalk.hex('#475569')('│')}`);
      }
    }
    console.log(chalk.hex('#475569')('  └' + '─'.repeat(58)) + '\n');
  }
}
