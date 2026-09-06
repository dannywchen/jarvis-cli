import chalk from 'chalk';
import boxen from 'boxen';
import * as p from '@clack/prompts';
import { getDueReviews, calculateNextReview } from '../../core/spacedRepetition.js';
import { loadReviewItems, saveReviewItems } from '../../core/storage.js';
import { playChime } from '../effects.js';
export async function runPracticeSession(profile, activeCourse) {
    console.clear();
    console.log('\n  ' + chalk.hex('#F8FAFC').bold('[PRACTICE] RECOVERY & SPACED REPETITION'));
    const allReviews = await loadReviewItems();
    const dueReviews = await getDueReviews();
    if (dueReviews.length === 0 && (!activeCourse || activeCourse.nodes.length === 0)) {
        console.log(boxen(chalk.hex('#CBD5E1')('No overdue reviews or active nodes to practice currently.\n') +
            chalk.hex('#64748B')('Complete roadmap lessons to automatically register concepts into the SM-2 review queue.'), { padding: 1, borderColor: 'gray', borderStyle: 'round' }));
        if (profile.hearts < profile.maxHearts) {
            profile.hearts = profile.maxHearts;
            console.log(chalk.hex('#10B981').bold('Health shields replenished to full: [5/5]'));
        }
        p.outro(chalk.hex('#64748B')('Practice session complete.'));
        return;
    }
    const targetItem = dueReviews[0];
    if (targetItem) {
        console.log(chalk.hex('#CBD5E1')(`\nConcept Review: ${targetItem.conceptTitle}`));
        const answer = await p.select({
            message: `Recall confidence for "${targetItem.conceptTitle}":`,
            options: [
                { value: 5, label: '5 - Perfect recall (Immediate, unambiguous)' },
                { value: 4, label: '4 - Good recall (Minor hesitation)' },
                { value: 3, label: '3 - Recalled with effort' },
                { value: 1, label: '1 - Complete blackout' },
            ],
        });
        if (p.isCancel(answer))
            return;
        const grade = Number(answer);
        const updated = calculateNextReview(targetItem, grade);
        const index = allReviews.findIndex((i) => i.id === targetItem.id);
        if (index >= 0) {
            allReviews[index] = updated;
            await saveReviewItems(allReviews);
        }
        playChime();
        console.log(chalk.hex('#10B981')(`\n[UPDATED] Spaced repetition interval: Next review in ${updated.intervalDays} day(s).`));
    }
    else {
        // Quick micro-quiz from active course
        const randomNode = activeCourse?.nodes.find((n) => n.status !== 'locked');
        const question = randomNode?.lessons[0]?.questions[0];
        if (question && question.options) {
            const selected = await p.select({
                message: `Practice Drill: ${question.prompt}`,
                options: question.options.map((opt, i) => ({ value: i, label: opt })),
            });
            if (p.isCancel(selected))
                return;
            if (Number(selected) === question.correctIndex) {
                console.log(chalk.hex('#10B981').bold('[PASS] Correct. Well done.'));
            }
            else {
                console.log(chalk.hex('#CBD5E1')(`Explanation: ${question.explanation}`));
            }
        }
    }
    // Restore 1 heart
    if (profile.hearts < profile.maxHearts) {
        profile.hearts += 1;
        console.log(chalk.hex('#38BDF8').bold(`[RESTORED] +1 HP. Current: ${profile.hearts}/${profile.maxHearts}`));
    }
    p.outro(chalk.hex('#10B981')('Practice complete.'));
}
