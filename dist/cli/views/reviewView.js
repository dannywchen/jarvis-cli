import chalk from 'chalk';
import boxen from 'boxen';
import * as p from '@clack/prompts';
import { getDueReviews, calculateNextReview } from '../../core/spacedRepetition.js';
import { loadReviewItems, saveReviewItems } from '../../core/storage.js';
import { evaluateOpenEndedAnswer } from '../../core/topicEngine.js';
import { awardXp } from '../../core/gamification.js';
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
    let targetQuestion;
    if (targetItem && activeCourse) {
        for (const node of activeCourse.nodes) {
            for (const lesson of node.lessons) {
                const found = lesson.questions.find((q) => q.id === targetItem.questionId);
                if (found) {
                    targetQuestion = found;
                    break;
                }
            }
            if (targetQuestion)
                break;
        }
    }
    if (targetItem && targetQuestion) {
        console.log(chalk.hex('#64748B')(`\n  Target Concept: ${targetItem.conceptTitle}`));
        if (targetQuestion.type === 'flashcard') {
            console.log(boxen(chalk.hex('#38BDF8').bold('REVIEW FLASHCARD FRONT\n\n') +
                chalk.hex('#F8FAFC').bold(targetQuestion.prompt.replace(/^Flashcard:\s*/i, '')) +
                (targetQuestion.hint ? chalk.hex('#64748B')(`\n\nHint: ${targetQuestion.hint}`) : ''), { padding: 1, borderColor: 'cyan', borderStyle: 'round' }));
            const reveal = await p.confirm({
                message: 'Press Enter/Space to reveal back:',
                initialValue: true,
            });
            if (p.isCancel(reveal))
                return;
            console.log(boxen(chalk.hex('#10B981').bold('FLASHCARD BACK (EXPLANATION)\n\n') +
                chalk.hex('#F8FAFC')(targetQuestion.flashcardBack || targetQuestion.explanation), { padding: 1, borderColor: 'green', borderStyle: 'round' }));
            const confidence = await p.select({
                message: 'Self-rate your recall confidence:',
                options: [
                    { value: '2', label: '2: Got it (Understood & retained)' },
                    { value: '1', label: '1: Review again (Needs reinforcement)' },
                ],
            });
            if (p.isCancel(confidence))
                return;
            const grade = confidence === '2' ? 5 : 1;
            const updated = calculateNextReview(targetItem, grade);
            const index = allReviews.findIndex((i) => i.id === targetItem.id);
            if (index >= 0) {
                allReviews[index] = updated;
                await saveReviewItems(allReviews);
            }
            if (confidence === '2') {
                playChime();
                console.log(chalk.hex('#10B981').bold('\n[PASS] Flashcard retained. +10 XP'));
                awardXp(profile, 10);
            }
            else {
                console.log(chalk.hex('#FBBF24').bold('\n[REVIEW] Kept in spaced repetition review queue.'));
            }
            console.log(chalk.hex('#64748B')(`Next SM-2 review in ${updated.intervalDays} day(s).`));
        }
        else if (targetQuestion.type === 'open-ended') {
            const minSentences = targetQuestion.minSentences || 1;
            const sentenceReq = minSentences > 1 ? `Answer in ${minSentences}-3 sentences:` : 'Answer in 1-3 sentences:';
            console.log(boxen(chalk.hex('#38BDF8').bold('REVIEW SYNTHESIS QUESTION\n\n') +
                chalk.hex('#F8FAFC').bold(targetQuestion.prompt) +
                (targetQuestion.hint ? chalk.hex('#64748B')(`\n\nHint: ${targetQuestion.hint}`) : ''), { padding: 1, borderColor: 'cyan', borderStyle: 'round' }));
            const input = await p.text({
                message: sentenceReq,
                placeholder: 'Explain the core mechanism in your own words...',
                validate: (val) => {
                    if (!val || val.trim().length === 0)
                        return 'Please enter an answer.';
                    return undefined;
                },
            });
            if (p.isCancel(input))
                return;
            const spinner = p.spinner();
            spinner.start('✦ Evaluating answer with AI...');
            const evalResult = await evaluateOpenEndedAnswer(targetQuestion, input.trim(), profile);
            spinner.stop(`Evaluation complete (Score: ${evalResult.scorePercentage}%):`);
            const grade = evalResult.isCorrect ? (evalResult.scorePercentage >= 85 ? 5 : 4) : 1;
            const updated = calculateNextReview(targetItem, grade);
            const index = allReviews.findIndex((i) => i.id === targetItem.id);
            if (index >= 0) {
                allReviews[index] = updated;
                await saveReviewItems(allReviews);
            }
            if (evalResult.isCorrect) {
                playChime();
                const earned = evalResult.xpEarned ?? 20;
                console.log(chalk.hex('#10B981').bold(`\n[PASS] Correct! +${earned} XP`));
                console.log(chalk.hex('#6EE7B7')(`  Feedback: ${evalResult.feedback}`));
                awardXp(profile, earned);
            }
            else {
                console.log(chalk.hex('#F87171').bold('\n[FAIL] Needs Improvement.'));
                console.log(chalk.hex('#FCA5A5')(`  Feedback: ${evalResult.feedback}`));
                console.log(chalk.hex('#94A3B8')(`  Model Answer: ${targetQuestion.explanation}`));
            }
            console.log(chalk.hex('#64748B')(`Next SM-2 review in ${updated.intervalDays} day(s).`));
        }
        else {
            // Multiple choice review question
            const selected = await p.select({
                message: `Practice Drill: ${targetQuestion.prompt}`,
                options: (targetQuestion.options || []).map((opt, i) => ({ value: i, label: opt })),
            });
            if (p.isCancel(selected))
                return;
            const isCorrect = Number(selected) === targetQuestion.correctIndex;
            const grade = isCorrect ? 5 : 1;
            const updated = calculateNextReview(targetItem, grade);
            const index = allReviews.findIndex((i) => i.id === targetItem.id);
            if (index >= 0) {
                allReviews[index] = updated;
                await saveReviewItems(allReviews);
            }
            if (isCorrect) {
                playChime();
                console.log(chalk.hex('#10B981').bold('[PASS] Correct. +15 XP'));
                awardXp(profile, 15);
            }
            else {
                console.log(chalk.hex('#F87171').bold('[FAIL] Incorrect.'));
                console.log(chalk.hex('#CBD5E1')(`Explanation: ${targetQuestion.explanation}`));
            }
            console.log(chalk.hex('#64748B')(`Next SM-2 review in ${updated.intervalDays} day(s).`));
        }
    }
    else if (targetItem) {
        // Overdue item without question definition: self-rated recall confidence
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
        if (question) {
            if (question.type === 'flashcard') {
                console.log(boxen(chalk.hex('#38BDF8').bold('PRACTICE FLASHCARD FRONT\n\n') +
                    chalk.hex('#F8FAFC').bold(question.prompt.replace(/^Flashcard:\s*/i, '')) +
                    (question.hint ? chalk.hex('#64748B')(`\n\nHint: ${question.hint}`) : ''), { padding: 1, borderColor: 'cyan', borderStyle: 'round' }));
                const reveal = await p.confirm({
                    message: 'Press Enter/Space to reveal back:',
                    initialValue: true,
                });
                if (p.isCancel(reveal))
                    return;
                console.log(boxen(chalk.hex('#10B981').bold('FLASHCARD BACK\n\n') +
                    chalk.hex('#F8FAFC')(question.flashcardBack || question.explanation), { padding: 1, borderColor: 'green', borderStyle: 'round' }));
                const confidence = await p.select({
                    message: 'Self-rate your recall confidence:',
                    options: [
                        { value: '2', label: '2: Got it' },
                        { value: '1', label: '1: Review again' },
                    ],
                });
                if (p.isCancel(confidence))
                    return;
                if (confidence === '2') {
                    playChime();
                    console.log(chalk.hex('#10B981').bold('[PASS] Retained. +10 XP'));
                    awardXp(profile, 10);
                }
                else {
                    console.log(chalk.hex('#FBBF24').bold('[REVIEW] Scheduled for review.'));
                }
            }
            else if (question.type === 'open-ended') {
                const minSentences = question.minSentences || 1;
                const sentenceReq = minSentences > 1 ? `Answer in ${minSentences}-3 sentences:` : 'Answer in 1-3 sentences:';
                console.log(boxen(chalk.hex('#38BDF8').bold('PRACTICE SYNTHESIS QUESTION\n\n') +
                    chalk.hex('#F8FAFC').bold(question.prompt) +
                    (question.hint ? chalk.hex('#64748B')(`\n\nHint: ${question.hint}`) : ''), { padding: 1, borderColor: 'cyan', borderStyle: 'round' }));
                const input = await p.text({
                    message: sentenceReq,
                    placeholder: 'Explain the core concept in your own words...',
                });
                if (p.isCancel(input))
                    return;
                const spinner = p.spinner();
                spinner.start('✦ Evaluating answer with AI...');
                const evalResult = await evaluateOpenEndedAnswer(question, input.trim(), profile);
                spinner.stop(`Evaluated (Score: ${evalResult.scorePercentage}%):`);
                if (evalResult.isCorrect) {
                    playChime();
                    const earned = evalResult.xpEarned ?? 15;
                    console.log(chalk.hex('#10B981').bold(`[PASS] Correct! +${earned} XP`));
                    console.log(chalk.hex('#6EE7B7')(`  Feedback: ${evalResult.feedback}`));
                    awardXp(profile, earned);
                }
                else {
                    console.log(chalk.hex('#F87171').bold('[FAIL] Needs Improvement.'));
                    console.log(chalk.hex('#FCA5A5')(`  Feedback: ${evalResult.feedback}`));
                    console.log(chalk.hex('#94A3B8')(`  Model Answer: ${question.explanation}`));
                }
            }
            else if (question.options) {
                const selected = await p.select({
                    message: `Practice Drill: ${question.prompt}`,
                    options: question.options.map((opt, i) => ({ value: i, label: opt })),
                });
                if (p.isCancel(selected))
                    return;
                if (Number(selected) === question.correctIndex) {
                    console.log(chalk.hex('#10B981').bold('[PASS] Correct. Well done.'));
                    awardXp(profile, 10);
                }
                else {
                    console.log(chalk.hex('#CBD5E1')(`Explanation: ${question.explanation}`));
                }
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
