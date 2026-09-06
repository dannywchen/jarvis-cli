import chalk from 'chalk';
import readline from 'node:readline/promises';
import * as p from '@clack/prompts';
import { parseDocument } from '../core/parser.js';
import { generateCourse } from '../core/generator.js';
import { loadUserProfile, saveUserProfile, loadCourse, saveCourse, listSavedCourses, } from '../core/storage.js';
import { updateStreak, awardXp, getLevelProgress } from '../core/gamification.js';
import { renderBanner } from './banner.js';
import { renderRoadmap } from './views/roadmapView.js';
import { runLesson } from './views/lessonView.js';
import { renderStats } from './views/statsView.js';
import { runPracticeSession } from './views/reviewView.js';
import { runAuthSetup, runModelPicker } from './views/authView.js';
import { queryActiveAgent, resolveActiveCredentials, generateOnTheFlyQuiz, } from '../core/agentWrapper.js';
import { POPULAR_MODELS } from '../core/liveClient.js';
import { playChime } from './effects.js';
export async function startDuoCodeRepl() {
    const profile = await loadUserProfile();
    updateStreak(profile);
    await saveUserProfile(profile);
    let activeCourse = null;
    if (profile.activeCourseId) {
        activeCourse = await loadCourse(profile.activeCourseId);
    }
    if (!activeCourse) {
        const courses = await listSavedCourses();
        if (courses.length > 0) {
            activeCourse = courses[0];
            profile.activeCourseId = activeCourse.id;
            await saveUserProfile(profile);
        }
    }
    let running = true;
    while (running) {
        console.clear();
        renderBanner();
        const creds = resolveActiveCredentials(profile);
        const leftBar = chalk.hex('#38BDF8').bold('▌');
        const levelInfo = getLevelProgress(profile.xp);
        const modeText = chalk.hex('#38BDF8').bold('Build');
        const modelText = chalk.hex('#E2E8F0')(creds.model);
        const harnessText = creds.connectedAccount
            ? chalk.hex('#10B981')(`● ${creds.harnessName.replace(' (OAuth)', '')}: ${creds.connectedAccount}`)
            : chalk.hex('#64748B')(`○ ${creds.harnessName}`);
        const zenText = profile.zenMode
            ? chalk.hex('#38BDF8')('OpenCode Zen')
            : chalk.hex('#64748B')(`Streak: ${profile.streak}d · XP: ${profile.xp} (Lvl ${levelInfo.currentLevel})`);
        const hpText = chalk.hex('#94A3B8')(`HP [${'■'.repeat(profile.hearts)}${'·'.repeat(Math.max(0, profile.maxHearts - profile.hearts))}]`);
        // Clean OpenCode Chat Box Card
        console.log(`  ${leftBar} ${chalk.hex('#475569')('add prompt, ask questions, or type /roadmap, /quiz, /model...')}`);
        console.log(`  ${leftBar}`);
        console.log(`  ${leftBar} ${modeText}  ${modelText}  ${harnessText}`);
        console.log(`  ${leftBar} ${zenText}  ${hpText}`);
        console.log(chalk.hex('#475569')('                                            /model switch   /roadmap tree   /auth'));
        console.log('');
        // If unauthenticated and no CLI session
        if (!creds.hasAuth && !creds.apiKey) {
            console.log(chalk.hex('#F59E0B')(`  [Harness Notice] Active harness: ${creds.harnessName}.\n  Run '/auth' or '/login' to connect Google / Gemini CLI or enter a key.`));
            console.log('');
        }
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        let input = '';
        try {
            input = await rl.question(chalk.hex('#38BDF8').bold('  ▌ '));
        }
        finally {
            rl.close();
        }
        const query = input.trim();
        if (!query)
            continue;
        const lower = query.toLowerCase();
        // 1. Direct API Key entry if unauthenticated
        if (!creds.apiKey && (query.startsWith('AIzaSy') || query.startsWith('sk-') || query.startsWith('sk-proj-') || query.startsWith('sk-ant-'))) {
            const provider = query.startsWith('AIzaSy') ? 'gemini' : query.startsWith('sk-ant') ? 'anthropic' : 'openai';
            if (!profile.apiKeys)
                profile.apiKeys = {};
            profile.apiKeys[provider] = query;
            profile.apiProvider = provider;
            profile.activeModel = POPULAR_MODELS[provider][0].id;
            await saveUserProfile(profile);
            console.log(chalk.hex('#10B981')(`\n✓ Connected to ${provider.toUpperCase()} live API (${profile.activeModel})!\n`));
            await new Promise((r) => setTimeout(r, 1200));
            continue;
        }
        // 2. Slash commands
        if (lower === '/exit' || lower === 'exit' || lower === 'quit') {
            running = false;
            console.log(chalk.hex('#64748B')('\nSession terminated.\n'));
            break;
        }
        if (lower === '/auth' || lower === '/connect' || lower === 'connect' || lower === 'auth' || lower === '/harness' || lower === '/login') {
            await runAuthSetup(profile);
            continue;
        }
        if (lower === '/model' || lower === '/agent' || lower === 'model') {
            await runModelPicker(profile);
            continue;
        }
        if (lower === '/roadmap' || lower === 'roadmap') {
            if (!activeCourse) {
                console.log(chalk.hex('#F59E0B')('\nNo active course found. Run /load <file> to build one.\n'));
            }
            else {
                console.clear();
                renderRoadmap(activeCourse);
            }
            const rlWait = readline.createInterface({ input: process.stdin, output: process.stdout });
            await rlWait.question(chalk.dim('\nPress Enter to return...'));
            rlWait.close();
            continue;
        }
        if (lower.startsWith('/quiz') || lower.startsWith('quiz') || lower.startsWith('/drill')) {
            const topic = query.replace(/^\/(?:quiz|drill)\s*/i, '').replace(/^(?:quiz|drill)\s*/i, '').trim();
            await handleOnTheFlyQuiz(topic, activeCourse, profile);
            const rlWait = readline.createInterface({ input: process.stdin, output: process.stdout });
            await rlWait.question(chalk.dim('\nPress Enter to return...'));
            rlWait.close();
            continue;
        }
        if (lower === '/learn' || lower === 'learn') {
            const activeNode = activeCourse?.nodes.find((n) => n.status === 'active') || activeCourse?.nodes[0];
            if (!activeCourse || !activeNode) {
                console.log(chalk.hex('#F59E0B')('\nNo active course found. Ingest a document first with /load <file>.\n'));
            }
            else {
                const lesson = activeNode.lessons.find((l) => !l.isCompleted) || activeNode.lessons[0];
                const result = await runLesson(lesson, activeNode, activeCourse, profile);
                if (result.success) {
                    await saveCourse(activeCourse);
                    await saveUserProfile(profile);
                }
            }
            const rlWait = readline.createInterface({ input: process.stdin, output: process.stdout });
            await rlWait.question(chalk.dim('\nPress Enter to return...'));
            rlWait.close();
            continue;
        }
        if (lower.startsWith('/load') || lower.startsWith('load')) {
            const parts = query.split(/\s+/);
            const targetFile = parts[1];
            if (targetFile) {
                const newCourse = await handleIngestPath(targetFile, profile);
                if (newCourse)
                    activeCourse = newCourse;
            }
            continue;
        }
        if (lower === '/stats' || lower === 'stats') {
            console.clear();
            await renderStats(profile);
            const rlWait = readline.createInterface({ input: process.stdin, output: process.stdout });
            await rlWait.question(chalk.dim('\nPress Enter to return...'));
            rlWait.close();
            continue;
        }
        if (lower === '/practice' || lower === 'practice') {
            await runPracticeSession(profile, activeCourse);
            await saveUserProfile(profile);
            const rlWait = readline.createInterface({ input: process.stdin, output: process.stdout });
            await rlWait.question(chalk.dim('\nPress Enter to return...'));
            rlWait.close();
            continue;
        }
        // 3. Real Live LLM Prompt Execution
        console.log(chalk.hex('#64748B')(`\n  ✦ Dispatching to ${creds.harnessName} (${creds.model})...`));
        const aiResponse = await queryActiveAgent(query, profile, activeCourse);
        if (aiResponse.requiresAuth) {
            console.log(chalk.hex('#F59E0B')(`\n  ${aiResponse.text}\n`));
            const connectNow = await p.confirm({ message: 'Would you like to enter your API key now?' });
            if (!p.isCancel(connectNow) && connectNow) {
                await runAuthSetup(profile);
            }
            continue;
        }
        console.log('\n' + chalk.hex('#F8FAFC')(aiResponse.text) + '\n');
        if (aiResponse.xpAwarded > 0) {
            awardXp(profile, aiResponse.xpAwarded);
            await saveUserProfile(profile);
            playChime();
            console.log(chalk.hex('#38BDF8')(`  [+${aiResponse.xpAwarded} XP] Total: ${profile.xp}\n`));
        }
        const rlWait = readline.createInterface({ input: process.stdin, output: process.stdout });
        await rlWait.question(chalk.dim('Press Enter to continue...'));
        rlWait.close();
    }
}
async function handleOnTheFlyQuiz(topic, activeCourse, profile) {
    const quizTitle = topic ? topic.toUpperCase() : activeCourse ? activeCourse.title : 'TECHNICAL SYNTHESIS';
    const spinner = p.spinner();
    spinner.start(`✦ Generating interactive drill for "${quizTitle}"...`);
    const questions = await generateOnTheFlyQuiz(topic, activeCourse);
    spinner.stop('Drill generated:');
    const tempLesson = {
        id: `drill_${Date.now()}`,
        title: `${quizTitle} Drill`,
        conceptDigest: `On-demand interactive active-recall challenge covering ${quizTitle}.`,
        keyTakeaway: 'Fast feedback accelerates cognitive consolidation.',
        analogies: ['Sparring match to test your reflexes.'],
        questions,
        xpAwarded: 0,
        isCompleted: false,
        crownCount: 0,
    };
    const tempNode = {
        id: `drill_node_${Date.now()}`,
        unitId: 'unit_dynamic',
        unitTitle: 'Dynamic Drills',
        title: `${quizTitle} Gauntlet`,
        description: `Targeted practice challenge on ${quizTitle}`,
        order: 0,
        status: 'active',
        lessons: [tempLesson],
    };
    const tempCourse = activeCourse || {
        id: `dynamic_${Date.now()}`,
        title: quizTitle,
        sourceFileName: 'Dynamic Prompt',
        pace: 'accelerated',
        createdAt: new Date().toISOString(),
        nodes: [tempNode],
        summary: 'Dynamic on-the-fly drill session',
    };
    const result = await runLesson(tempLesson, tempNode, tempCourse, profile);
    if (result.success) {
        await saveUserProfile(profile);
    }
}
async function handleIngestPath(filePath, profile) {
    const spinner = p.spinner();
    spinner.start(`✦ Ingesting "${filePath}"...`);
    try {
        const doc = await parseDocument(filePath);
        spinner.message('✦ Synthesizing standard curriculum...');
        const course = await generateCourse(doc, 'standard', {
            provider: profile.apiProvider,
            apiKey: profile.apiKey,
        });
        await saveCourse(course);
        profile.activeCourseId = course.id;
        await saveUserProfile(profile);
        spinner.stop(chalk.hex('#10B981').bold(`Roadmap Created: "${course.title}" (${course.nodes.length} nodes)`));
        renderRoadmap(course);
        return course;
    }
    catch (err) {
        spinner.stop(chalk.hex('#F87171')(`Failed to ingest: ${err.message}`));
        return null;
    }
}
