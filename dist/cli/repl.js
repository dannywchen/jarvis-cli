import chalk from 'chalk';
import * as p from '@clack/prompts';
import boxen from 'boxen';
import os from 'node:os';
import { parseDocument } from '../core/parser.js';
import { generateCourse } from '../core/generator.js';
import { decomposeTopicIntoConcepts } from '../core/topicEngine.js';
import { loadUserProfile, saveUserProfile, loadCourse, saveCourse, listSavedCourses, loadRecentThreads, summarizeRecentThreads, createRecentThread, appendRecentThreadMessage, } from '../core/storage.js';
import { updateStreak, awardXp } from '../core/gamification.js';
import { runLesson } from './views/lessonView.js';
import { runPracticeSession } from './views/reviewView.js';
import { runAuthSetup, runModelPicker } from './views/authView.js';
import { queryActiveAgent, resolveActiveCredentials, generateOnTheFlyQuiz, } from '../core/agentWrapper.js';
import { POPULAR_MODELS } from '../core/liveClient.js';
import { playChime } from './effects.js';
import { TerminalChatShell } from './chatShell.js';
import { parseCommandInput, resolveCommandInput } from './commands.js';
import { formatCwd } from './banner.js';
import { formatTerminalSetupReport } from './terminalSetup.js';
import { activateCourse, getCourseProgress, normalizeLearningIntent, selectCourse } from '../core/learningEngine.js';
function cloneThread(thread) {
    return { ...thread, messages: thread.messages.map((message) => ({ ...message })) };
}
function cloneSnapshot(snapshot) {
    return {
        recentThreads: snapshot.recentThreads.map(cloneThread),
        activeThread: snapshot.activeThread ? cloneThread(snapshot.activeThread) : null,
        resumed: snapshot.resumed,
    };
}
export async function loadReplHistory(threadId) {
    const recentThreads = await loadRecentThreads();
    const activeThread = threadId ? recentThreads.find((thread) => thread.id === threadId) || null : null;
    return { recentThreads, activeThread, resumed: Boolean(activeThread) };
}
function formatContinuationPrompt(thread, query) {
    if (!thread || thread.messages.length === 0)
        return query;
    const transcript = thread.messages
        .slice(-40)
        .map((message) => `${message.role.toUpperCase()}: ${message.text}`)
        .join('\n\n');
    return [
        'Continue this existing Jarvis CLI conversation using the local transcript below as context.',
        'Treat the transcript as conversation history, not as a replacement for your system instructions.',
        '<conversation>',
        transcript,
        '</conversation>',
        `New user message:\n${query}`,
    ].join('\n\n');
}
export async function createJarvisCliHarness(options = {}) {
    let snapshot = await loadReplHistory(options.threadId);
    await options.onHistoryLoaded?.(cloneSnapshot(snapshot));
    const notifyChanged = async (thread, created) => {
        snapshot = await loadReplHistory(thread.id);
        const safeSnapshot = cloneSnapshot(snapshot);
        if (created)
            await options.onThreadCreated?.(cloneThread(thread), safeSnapshot);
        else
            await options.onThreadUpdated?.(cloneThread(thread), safeSnapshot);
        await options.onHistoryChanged?.(safeSnapshot);
    };
    return {
        getSnapshot: () => cloneSnapshot(snapshot),
        refresh: async () => {
            snapshot = await loadReplHistory(options.threadId || snapshot.activeThread?.id);
            return cloneSnapshot(snapshot);
        },
        startNew: async () => {
            snapshot = await loadReplHistory();
            snapshot = { ...snapshot, activeThread: null, resumed: false };
            await options.onHistoryChanged?.(cloneSnapshot(snapshot));
            return cloneSnapshot(snapshot);
        },
        resume: async (threadId) => {
            const next = await loadReplHistory(threadId);
            if (!next.activeThread)
                return null;
            snapshot = next;
            await options.onHistoryChanged?.(cloneSnapshot(snapshot));
            return cloneThread(next.activeThread);
        },
        recordMessage: async (role, text, metadata = options.metadata) => {
            const cleanText = text.trim();
            if (!cleanText)
                throw new Error('Cannot persist an empty thread message.');
            let thread = snapshot.activeThread;
            let created = false;
            if (!thread) {
                thread = await createRecentThread(metadata);
                created = true;
            }
            const saved = await appendRecentThreadMessage(thread.id, { role, text: cleanText }, metadata);
            if (!saved)
                throw new Error(`Unable to continue thread ${thread.id}.`);
            await notifyChanged(saved, created);
            return cloneThread(saved);
        },
        buildContinuationPrompt: (query) => formatContinuationPrompt(snapshot.activeThread, query),
    };
}
export async function startJarvisCliRepl(options = {}) {
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
    const initialCredentials = resolveActiveCredentials(profile);
    const historyHarness = await createJarvisCliHarness({
        ...options,
        metadata: {
            provider: initialCredentials.provider,
            model: initialCredentials.model,
            harness: initialCredentials.harnessName,
            ...options.metadata,
        },
    });
    let shell;
    shell = new TerminalChatShell({
        getContext: () => ({
            model: resolveActiveCredentials(profile).model,
            userName: displayName(profile.name),
            courseTitle: activeCourse?.title,
            streak: profile.streak,
            xp: profile.xp,
            level: profile.level,
            cwd: formatCwd(process.cwd()),
            nextLesson: activeCourse?.nodes.find((node) => node.status === 'active')?.lessons.find((lesson) => !lesson.isCompleted)?.title,
            recentThreads: summarizeRecentThreads(historyHarness.getSnapshot().recentThreads, 4),
        }),
        onClear: () => undefined,
        onSubmit: async (rawInput) => {
            try {
                const query = rawInput.trim();
                const creds = resolveActiveCredentials(profile);
                const parsed = parseCommandInput(query);
                const command = resolveCommandInput(query);
                if (!creds.apiKey && (query.startsWith('AIzaSy') || query.startsWith('sk-') || query.startsWith('sk-proj-') || query.startsWith('sk-ant-'))) {
                    const provider = query.startsWith('AIzaSy') ? 'gemini' : query.startsWith('sk-ant') ? 'anthropic' : 'openai';
                    if (!profile.apiKeys)
                        profile.apiKeys = {};
                    profile.apiKeys[provider] = query;
                    profile.apiProvider = provider;
                    profile.activeModel = POPULAR_MODELS[provider][0].id;
                    await saveUserProfile(profile);
                    shell.add('system', `Connected to ${provider.toUpperCase()}.`);
                    return;
                }
                // A leading slash is reserved for commands. Catching typos here keeps
                // them from silently becoming an AI prompt and gives the palette a
                // clear, keyboard-friendly recovery path.
                if (query.startsWith('/') && !command) {
                    shell.add('system', parsed?.command ? `Unknown command /${parsed.command}. Type / to browse.` : 'Type /, then choose a command.');
                    return;
                }
                const commandName = command?.name || '';
                const args = parsed?.args || '';
                if (!command && !query.startsWith('/')) {
                    const requestedTopic = inferCourseCreationTopic(query);
                    if (requestedTopic) {
                        await shell.suspend(async () => {
                            await handleTopicLearning(requestedTopic, profile, (course) => {
                                activeCourse = course;
                            });
                        });
                        shell.add('system', `Learning plan ready for ${requestedTopic}.`);
                        return;
                    }
                }
                if (commandName === 'exit') {
                    shell.add('system', 'Session closed.');
                    shell.close();
                    return;
                }
                if (commandName === 'terminal-setup') {
                    shell.add('system', formatTerminalSetupReport());
                    return;
                }
                if (commandName === 'clear') {
                    await historyHarness.startNew();
                    shell.clear();
                    shell.add('system', 'Fresh thread ready. Type a question whenever you are.');
                    return;
                }
                if (commandName === 'auth') {
                    try {
                        await shell.suspend(() => runAuthSetup(profile));
                        shell.add('system', 'Connection settings updated.');
                    }
                    catch (err) {
                        shell.add('system', `Auth notice: ${err?.message || err}`);
                    }
                    return;
                }
                if (commandName === 'model') {
                    try {
                        await shell.suspend(() => runModelPicker(profile));
                        shell.add('system', `Using ${resolveActiveCredentials(profile).model}.`);
                    }
                    catch (err) {
                        shell.add('system', `Model notice: ${err?.message || err}`);
                    }
                    return;
                }
                if (commandName === 'roadmap') {
                    if (!activeCourse)
                        shell.add('system', 'No course yet. Use /load <file> or /topic <name>.');
                    else
                        shell.add('assistant', formatRoadmap(activeCourse));
                    return;
                }
                if (commandName === 'courses') {
                    const courses = await listSavedCourses();
                    if (!courses.length) {
                        shell.add('system', 'No saved courses yet. Use /topic <subject> or /load <file> to build your first roadmap.');
                        return;
                    }
                    const selector = args.replace(/^to\s+/i, '').trim();
                    let selected = selector ? selectCourse(courses, selector) : null;
                    if (selector && !selected) {
                        shell.add('system', 'Course not found. Use /courses to see the numbered course library.');
                        return;
                    }
                    if (!selector) {
                        const choice = await shell.suspend(() => p.select({
                            message: 'Choose a course to focus on:',
                            options: courses.map((course, index) => ({
                                value: course.id,
                                label: `${index + 1}. ${course.title}${course.id === activeCourse?.id ? ' (active)' : ''}`,
                            })),
                        }));
                        if (p.isCancel(choice))
                            return;
                        selected = courses.find((course) => course.id === choice) || null;
                    }
                    if (selected) {
                        activateCourse(profile, selected);
                        activeCourse = selected;
                        await saveCourse(selected);
                        await saveUserProfile(profile);
                        const progress = getCourseProgress(selected);
                        shell.add('system', `Focused course: ${selected.title} · ${progress.progressPercentage}% complete. ${progress.currentLessonId ? 'Your next lesson is loaded.' : 'Course complete.'}`);
                    }
                    return;
                }
                if (commandName === 'quiz') {
                    try {
                        await shell.suspend(() => handleOnTheFlyQuiz(args, activeCourse, profile));
                        shell.add('system', 'Practice session complete.');
                    }
                    catch (err) {
                        shell.add('system', `Quiz notice: ${err?.message || err}`);
                    }
                    return;
                }
                if (commandName === 'learn') {
                    try {
                        if (args.trim()) {
                            await shell.suspend(async () => {
                                await handleTopicLearning(args.trim(), profile, (course) => {
                                    activeCourse = course;
                                });
                            });
                            shell.add('system', 'Topic learning session complete.');
                            return;
                        }
                        const activeNode = activeCourse?.nodes.find((node) => node.status === 'active') || activeCourse?.nodes[0];
                        if (!activeCourse || !activeNode)
                            shell.add('system', 'No course yet. Use /topic <name> or /load <file>.');
                        else {
                            await shell.suspend(async () => {
                                const lesson = activeNode.lessons.find((item) => !item.isCompleted) || activeNode.lessons[0];
                                const result = await runLesson(lesson, activeNode, activeCourse, profile);
                                if (result.success) {
                                    await saveCourse(activeCourse);
                                    await saveUserProfile(profile);
                                }
                            });
                            shell.add('system', 'Lesson complete.');
                        }
                    }
                    catch (err) {
                        shell.add('system', `Lesson notice: ${err?.message || err}`);
                    }
                    return;
                }
                if (commandName === 'load') {
                    if (!args)
                        shell.add('system', 'Add a file path: /load notes.pdf');
                    else {
                        try {
                            const newCourse = await shell.suspend(() => handleIngestPath(args, profile));
                            if (newCourse) {
                                activeCourse = newCourse;
                                shell.add('system', `Course ready: ${newCourse.title}.`);
                            }
                        }
                        catch (err) {
                            shell.add('system', `Load notice: ${err?.message || err}`);
                        }
                    }
                    return;
                }
                if (commandName === 'stats') {
                    shell.add('assistant', `Level ${profile.level} · ${profile.xp} XP · ${profile.streak}-day streak.`);
                    return;
                }
                if (commandName === 'threads') {
                    const threads = summarizeRecentThreads(historyHarness.getSnapshot().recentThreads, 8);
                    if (!threads.length) {
                        shell.add('assistant', 'No saved conversations yet. Ask a question and Jarvis will keep the thread here.');
                    }
                    else {
                        shell.add('assistant', [
                            '**Recent conversations**',
                            ...threads.map((thread, index) => `${index + 1}. ${thread.title} · ${thread.messageCount} messages · ${thread.id}`),
                            '',
                            'Use /resume <number> or /resume <thread id> to continue one.',
                        ].join('\n'));
                    }
                    return;
                }
                if (commandName === 'resume') {
                    const threads = summarizeRecentThreads(historyHarness.getSnapshot().recentThreads, 20);
                    const selected = selectThread(threads, args);
                    if (!selected) {
                        shell.add('system', threads.length ? 'Choose a recent thread with /resume <number> or /resume <thread id>.' : 'No saved conversations yet.');
                        return;
                    }
                    const resumed = await historyHarness.resume(selected.id);
                    if (!resumed) {
                        shell.add('system', 'That conversation is no longer available. Type /threads to refresh the list.');
                        return;
                    }
                    shell.clear();
                    for (const message of resumed.messages)
                        shell.add(message.role, message.text);
                    shell.add('system', `Resumed “${resumed.title}”. Your next message will continue this thread.`);
                    return;
                }
                if (commandName === 'topic') {
                    try {
                        let topicName = args.trim();
                        if (!topicName) {
                            const prompted = await shell.suspend(async () => {
                                return await p.text({
                                    message: 'What topic would you like to master?',
                                    placeholder: 'e.g. Quantum Superposition, Rust Concurrency, Docker Networking',
                                });
                            });
                            if (p.isCancel(prompted) || !prompted)
                                return;
                            topicName = String(prompted).trim();
                        }
                        if (!topicName)
                            return;
                        await shell.suspend(async () => {
                            await handleTopicLearning(topicName, profile, (course) => {
                                activeCourse = course;
                            });
                        });
                        shell.add('system', 'Topic learning session complete.');
                    }
                    catch (err) {
                        shell.add('system', `Topic notice: ${err?.message || err}`);
                    }
                    return;
                }
                if (commandName === 'flashcards') {
                    try {
                        await shell.suspend(async () => {
                            await handleFlashcardReview(args, activeCourse, profile);
                            await saveUserProfile(profile);
                        });
                        shell.add('system', 'Flashcard review complete.');
                    }
                    catch (err) {
                        shell.add('system', `Flashcards notice: ${err?.message || err}`);
                    }
                    return;
                }
                if (commandName === 'help') {
                    shell.add('assistant', formatHelpGuide());
                    return;
                }
                if (commandName === 'practice') {
                    try {
                        await shell.suspend(async () => {
                            await runPracticeSession(profile, activeCourse);
                            await saveUserProfile(profile);
                        });
                        shell.add('system', 'Review complete.');
                    }
                    catch (err) {
                        shell.add('system', `Practice notice: ${err?.message || err}`);
                    }
                    return;
                }
                const credentials = resolveActiveCredentials(profile);
                const metadata = {
                    provider: credentials.provider,
                    model: credentials.model,
                    harness: credentials.harnessName,
                };
                const prompt = historyHarness.buildContinuationPrompt(query);
                await historyHarness.recordMessage('user', query, metadata);
                try {
                    const aiResponse = await queryActiveAgent(prompt, profile, activeCourse, {
                        onActivity: (event) => shell.addActivity(event),
                        userQuery: query,
                    });
                    // Agent course tools persist their changes. Refresh the in-memory
                    // session as well so a newly prepared course is immediately used by
                    // /learn, /roadmap, quizzes, and the next agent turn.
                    const refreshedProfile = await loadUserProfile();
                    Object.assign(profile, refreshedProfile);
                    activeCourse = profile.activeCourseId ? await loadCourse(profile.activeCourseId) : null;
                    const role = aiResponse.requiresAuth ? 'system' : 'assistant';
                    shell.add(role, aiResponse.text);
                    await historyHarness.recordMessage(role, aiResponse.text, {
                        provider: aiResponse.provider,
                        model: aiResponse.model,
                        harness: aiResponse.harnessName,
                    });
                    if (aiResponse.requiresAuth)
                        return;
                    if (aiResponse.xpAwarded > 0) {
                        awardXp(profile, aiResponse.xpAwarded);
                        await saveUserProfile(profile);
                        playChime();
                        const reasonNote = aiResponse.relevanceReason ? ` (${aiResponse.relevanceReason})` : '';
                        shell.add('system', `+${aiResponse.xpAwarded} XP${reasonNote}`);
                    }
                }
                catch (error) {
                    const message = error?.message || 'Something went wrong.';
                    shell.add('system', message);
                    await historyHarness.recordMessage('system', message, metadata);
                }
            }
            catch (err) {
                shell.add('system', `Notice: ${err?.message || err}`);
            }
        },
    });
    const resumedThread = historyHarness.getSnapshot().activeThread;
    if (resumedThread) {
        for (const message of resumedThread.messages)
            shell.add(message.role, message.text);
        shell.add('system', `Resumed “${resumedThread.title}”. Your next message will continue this thread.`);
    }
    else {
        shell.add('system', 'Ready when you are. Type / to browse commands.');
    }
    const uncaughtHandler = (err) => {
        if (shell && !shell.isClosed()) {
            shell.add('system', `Notice: ${err?.message || String(err)}`);
        }
        else {
            console.error(`[Jarvis CLI Notice]`, err?.message || err);
        }
    };
    const unhandledHandler = (reason) => {
        const msg = reason instanceof Error ? reason.message : String(reason);
        if (shell && !shell.isClosed()) {
            shell.add('system', `Notice: ${msg}`);
        }
        else {
            console.error(`[Jarvis CLI Notice]`, msg);
        }
    };
    process.on('uncaughtException', uncaughtHandler);
    process.on('unhandledRejection', unhandledHandler);
    try {
        while (!shell.isClosed()) {
            try {
                await shell.start();
                break;
            }
            catch (err) {
                if (shell.isClosed())
                    break;
                shell.add('system', `Session recovered: ${err?.message || err}`);
            }
        }
    }
    finally {
        process.off('uncaughtException', uncaughtHandler);
        process.off('unhandledRejection', unhandledHandler);
    }
}
// Backward-compatible name for callers that still import the legacy entry point.
export const startDuoCodeRepl = startJarvisCliRepl;
function displayName(name) {
    const cleanName = name?.trim();
    if (cleanName && cleanName.toLowerCase() !== 'learner')
        return cleanName;
    const accountName = os.userInfo().username.split(/[._-]/)[0];
    if (!accountName)
        return 'friend';
    if (accountName.toLowerCase() === 'dannywchen')
        return 'Danny';
    return accountName.charAt(0).toUpperCase() + accountName.slice(1);
}
function inferCourseCreationTopic(query) {
    const match = query.trim().match(/^(?:i\s+(?:want\s+to|wanna)\s+learn|teach\s+me|help\s+me\s+learn|build\s+(?:me\s+)?a\s+roadmap\s+for|create\s+(?:a\s+)?course\s+for|i\s+need\s+to\s+master)\s+(.+)$/i);
    return match?.[1]?.replace(/[.!?]+$/, '').trim() || null;
}
function selectThread(threads, selector) {
    const cleanSelector = selector.trim();
    if (!cleanSelector)
        return threads[0] || null;
    const index = Number.parseInt(cleanSelector, 10);
    if (Number.isInteger(index) && String(index) === cleanSelector)
        return threads[index - 1] || null;
    return threads.find((thread) => thread.id === cleanSelector || thread.id.startsWith(cleanSelector)) || null;
}
function formatRoadmap(course) {
    const progress = getCourseProgress(course);
    const intent = normalizeLearningIntent(course.intent, course.title);
    const nodeRows = course.nodes.map((node) => {
        const marker = node.status === 'active' ? '→' : node.status === 'completed' || node.status === 'mastered' ? '✓' : '·';
        return `${marker} ${node.title.replace(/^[⚔️\s]+/, '')}`;
    });
    return [
        course.title,
        `Goal: ${intent.goal}`,
        `Progress: ${progress.progressPercentage}% · ${progress.completedLessons}/${progress.totalLessons} lessons · ~${progress.estimatedMinutesRemaining} min left`,
        '',
        ...nodeRows,
    ].join('\n');
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
async function handleIngestPath(filePath, profile, intent) {
    const spinner = p.spinner();
    spinner.start(`Reading ${filePath}…`);
    try {
        const doc = await parseDocument(filePath);
        spinner.message('Building your course…');
        const course = await generateCourse(doc, 'standard', {
            provider: profile.apiProvider,
            apiKey: profile.apiKey,
            intent: intent || normalizeLearningIntent(undefined, doc.title),
        });
        activateCourse(profile, course);
        await saveCourse(course);
        profile.activeCourseId = course.id;
        await saveUserProfile(profile);
        spinner.stop(chalk.hex('#10B981').bold(`Course ready: "${course.title}" · ${course.nodes.length} lessons`));
        return course;
    }
    catch (err) {
        spinner.stop(chalk.hex('#F87171')(`Could not build course: ${err.message}`));
        return null;
    }
}
function formatHelpGuide() {
    return [
        chalk.hex('#F8FAFC').bold('Jarvis CLI Command Guide & Shortcuts'),
        '',
        chalk.hex('#E07A5F').bold('Learning Commands:'),
        `  ${chalk.hex('#F1F1F1')('/topic <topic>'.padEnd(22))} ${chalk.hex('#94A3B8')('Decompose any topic into bite-sized concepts & learn')}`,
        `  ${chalk.hex('#F1F1F1')('/learn'.padEnd(22))} ${chalk.hex('#94A3B8')('Start or continue your next bite-sized lesson')}`,
        `  ${chalk.hex('#F1F1F1')('/flashcards [topic]'.padEnd(22))} ${chalk.hex('#94A3B8')('Review active recall flashcards with flip-to-reveal')}`,
        `  ${chalk.hex('#F1F1F1')('/quiz [topic]'.padEnd(22))} ${chalk.hex('#94A3B8')('Challenge yourself with interactive questions & AI feedback')}`,
        `  ${chalk.hex('#F1F1F1')('/practice'.padEnd(22))} ${chalk.hex('#94A3B8')('Review spaced repetition items (SM-2 queue) to earn XP')}`,
        `  ${chalk.hex('#F1F1F1')('/roadmap'.padEnd(22))} ${chalk.hex('#94A3B8')('View your active learning path and completed skills')}`,
        `  ${chalk.hex('#F1F1F1')('/courses [number]'.padEnd(22))} ${chalk.hex('#94A3B8')('Browse saved courses or switch your focus')}`,
        `  ${chalk.hex('#F1F1F1')('/load <file>'.padEnd(22))} ${chalk.hex('#94A3B8')('Turn PDF or Markdown notes into a full course')}`,
        `  ${chalk.hex('#F1F1F1')('/stats'.padEnd(22))} ${chalk.hex('#94A3B8')('View Level, XP progression, streak, and achievements')}`,
        '',
        chalk.hex('#E07A5F').bold('Session & Model Management:'),
        `  ${chalk.hex('#F1F1F1')('/model'.padEnd(22))} ${chalk.hex('#94A3B8')('Choose your AI tutor (Gemini 3.8 Flash, GPT-5.6, Claude)')}`,
        `  ${chalk.hex('#F1F1F1')('/auth'.padEnd(22))} ${chalk.hex('#94A3B8')('Connect local CLI harnesses or set API credentials')}`,
        `  ${chalk.hex('#F1F1F1')('/threads'.padEnd(22))} ${chalk.hex('#94A3B8')('Browse recent conversations and saved sessions')}`,
        `  ${chalk.hex('#F1F1F1')('/resume <id>'.padEnd(22))} ${chalk.hex('#94A3B8')('Continue a previous conversation thread')}`,
        `  ${chalk.hex('#F1F1F1')('/clear'.padEnd(22))} ${chalk.hex('#94A3B8')('Start a clean chat thread')}`,
        `  ${chalk.hex('#F1F1F1')('/terminal-setup'.padEnd(22))} ${chalk.hex('#94A3B8')('Configure VS Code / Cursor terminal for Shift+Enter')}`,
        `  ${chalk.hex('#F1F1F1')('/exit'.padEnd(22))} ${chalk.hex('#94A3B8')('Leave the session')}`,
        '',
        chalk.hex('#E07A5F').bold('Keyboard Shortcuts:'),
        `  ${chalk.hex('#F1F1F1')('Shift+Enter'.padEnd(22))} ${chalk.hex('#94A3B8')('Insert newline in prompt (also \\+Enter or Ctrl+J)')}`,
        `  ${chalk.hex('#F1F1F1')('/'.padEnd(22))} ${chalk.hex('#94A3B8')('Open slash command palette')}`,
        `  ${chalk.hex('#F1F1F1')('↑ / ↓'.padEnd(22))} ${chalk.hex('#94A3B8')('Navigate command palette options')}`,
        `  ${chalk.hex('#F1F1F1')('Tab'.padEnd(22))} ${chalk.hex('#94A3B8')('Autocomplete selected command')}`,
        `  ${chalk.hex('#F1F1F1')('Ctrl+U'.padEnd(22))} ${chalk.hex('#94A3B8')('Clear current prompt')}`,
        `  ${chalk.hex('#F1F1F1')('Ctrl+C'.padEnd(22))} ${chalk.hex('#94A3B8')('Cancel active prompt / hit twice to exit')}`,
        `  ${chalk.hex('#F1F1F1')('Ctrl+D'.padEnd(22))} ${chalk.hex('#94A3B8')('Exit session cleanly')}`,
    ].join('\n');
}
async function handleTopicLearning(topic, profile, onCourseCreated) {
    const spinner = p.spinner();
    spinner.start(chalk.hex('#E07A5F')(`✦ Decomposing "${topic}" into bite-sized micro-concepts...`));
    try {
        const goalInput = await p.text({
            message: 'What do you want to be able to do with this topic?',
            placeholder: `e.g. Build a real project, pass an interview, or explain ${topic} confidently`,
        });
        const levelInput = await p.select({
            message: 'What is your current level?',
            options: [
                { value: 'beginner', label: 'Beginner — start from first principles' },
                { value: 'intermediate', label: 'Intermediate — connect and apply concepts' },
                { value: 'advanced', label: 'Advanced — sharpen depth and edge cases' },
            ],
            initialValue: 'intermediate',
        });
        const intent = normalizeLearningIntent({
            goal: p.isCancel(goalInput) || !goalInput ? undefined : String(goalInput),
            level: p.isCancel(levelInput) ? 'intermediate' : levelInput,
        }, topic);
        const result = await decomposeTopicIntoConcepts(topic, profile, { intent });
        const course = result.course;
        activateCourse(profile, course);
        await saveCourse(course);
        await saveUserProfile(profile);
        onCourseCreated(course);
        spinner.stop(chalk.hex('#10B981').bold(`Decomposed "${course.title}" into ${course.nodes.length} progressive concepts!`));
        const overview = course.nodes.map((n, i) => `${i + 1}. ${n.title} - ${n.description}`).join('\n');
        p.note(overview, 'Micro-Curriculum Roadmap');
        const startChoice = await p.confirm({
            message: `Start the first lesson: "${course.nodes[0]?.lessons[0]?.title || course.title}"?`,
            initialValue: true,
        });
        if (!p.isCancel(startChoice) && startChoice) {
            const firstNode = course.nodes[0];
            const firstLesson = firstNode.lessons[0];
            const lessonResult = await runLesson(firstLesson, firstNode, course, profile);
            if (lessonResult.success) {
                await saveCourse(course);
                await saveUserProfile(profile);
            }
        }
    }
    catch (err) {
        spinner.stop(chalk.hex('#F87171')(`Could not decompose topic: ${err.message}`));
    }
}
async function handleFlashcardReview(topicArg, activeCourse, profile) {
    console.clear();
    console.log('\n  ' + chalk.hex('#F8FAFC').bold('[FLASHCARDS] ACTIVE RECALL REVIEW'));
    let targetCards = [];
    if (activeCourse) {
        for (const node of activeCourse.nodes) {
            for (const lesson of node.lessons) {
                for (const q of lesson.questions) {
                    if (q.type === 'flashcard' && q.flashcardBack) {
                        targetCards.push({ front: q.prompt, back: q.flashcardBack, hint: q.hint });
                    }
                }
            }
        }
    }
    if (topicArg.trim()) {
        const filterTerm = topicArg.trim().toLowerCase();
        targetCards = targetCards.filter((c) => c.front.toLowerCase().includes(filterTerm) || c.back.toLowerCase().includes(filterTerm));
    }
    if (targetCards.length === 0) {
        const subject = topicArg.trim() || activeCourse?.title || 'Core Engineering';
        targetCards = [
            {
                front: `What is the core principle of Separation of Concerns in ${subject}?`,
                back: 'Decomposing a program into distinct sections where each section addresses a separate concern or responsibility, preventing ripple effects upon changes.',
                hint: 'Think modularity and maintenance.',
            },
            {
                front: `What invariant must be preserved during concurrent mutations in ${subject}?`,
                back: 'State consistency across thread and process boundaries, guaranteed via atomic operations, mutexes, or immutable memory.',
                hint: 'Think synchronization and race conditions.',
            },
            {
                front: `Why are pure functions and immutability favored in ${subject}?`,
                back: 'They eliminate hidden side effects, simplify reasoning, and allow safe parallel execution without locks.',
                hint: 'Think reproducibility and testability.',
            },
        ];
    }
    p.intro(chalk.hex('#38BDF8')(`Reviewing ${targetCards.length} flashcard(s)...`));
    let reviewed = 0;
    let mastered = 0;
    for (let i = 0; i < targetCards.length; i++) {
        const card = targetCards[i];
        console.log(boxen(chalk.hex('#64748B')(`CARD ${i + 1}/${targetCards.length}\n\n`) +
            chalk.hex('#F8FAFC').bold(card.front) +
            (card.hint ? '\n\n' + chalk.hex('#94A3B8')(`Tip: ${card.hint}`) : ''), { padding: 1, borderColor: 'gray', borderStyle: 'round' }));
        const flip = await p.confirm({
            message: 'Ready to flip and reveal answer?',
            initialValue: true,
        });
        if (p.isCancel(flip))
            break;
        console.log(boxen(chalk.hex('#10B981').bold('REVEALED EXPLANATION\n\n') + chalk.hex('#E2E8F0')(card.back), { padding: 1, borderColor: 'green', borderStyle: 'round' }));
        const rating = await p.select({
            message: 'Rate your recall confidence:',
            options: [
                { value: '2', label: '2 - Got it! (+10 XP)' },
                { value: '1', label: '1 - Need more review (+5 XP)' },
            ],
        });
        if (p.isCancel(rating))
            break;
        reviewed++;
        if (rating === '2') {
            mastered++;
            awardXp(profile, 10);
            console.log(chalk.hex('#10B981')('  ✓ Mastered! +10 XP'));
        }
        else {
            awardXp(profile, 5);
            console.log(chalk.hex('#F59E0B')('  · Marked for review soon. +5 XP'));
        }
    }
    if (reviewed > 0) {
        if (profile.hearts < profile.maxHearts) {
            profile.hearts = Math.min(profile.maxHearts, profile.hearts + 1);
            console.log(chalk.hex('#38BDF8')(`  [RESTORED] +1 HP shield (${profile.hearts}/${profile.maxHearts})`));
        }
        playChime();
        p.outro(chalk.hex('#10B981').bold(`Flashcard review complete: ${mastered}/${reviewed} cards mastered.`));
    }
    else {
        p.outro(chalk.hex('#64748B')('Flashcard review exited.'));
    }
}
