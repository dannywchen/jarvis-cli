import { Command } from 'commander';
import chalk from 'chalk';
import { startJarvisCliRepl } from './cli/repl.js';
import { parseDocument } from './core/parser.js';
import { generateCourse } from './core/generator.js';
import { loadUserProfile, saveUserProfile, loadCourse, saveCourse, } from './core/storage.js';
import { renderRoadmap } from './cli/views/roadmapView.js';
import { renderStats } from './cli/views/statsView.js';
import { runLesson } from './cli/views/lessonView.js';
import { runPracticeSession } from './cli/views/reviewView.js';
import { decomposeTopicIntoConcepts } from './core/topicEngine.js';
const program = new Command();
program
    .name('jarvis')
    .description('Jarvis CLI: a terminal-native learning and agentic study harness')
    .version('1.0.0');
// Default action: Interactive REPL
program
    .action(async () => {
    try {
        await startJarvisCliRepl();
    }
    catch (err) {
        console.error(chalk.red(`\n[Jarvis CLI Error] ${err.message}`));
        process.exit(1);
    }
});
// Command: load <file>
program
    .command('load <file>')
    .description('Ingest a PDF, Markdown, or text document and build a gamified skill tree')
    .option('-p, --pace <pace>', 'Roadmap pace: accelerated, standard, or deep', 'standard')
    .action(async (file, options) => {
    try {
        console.log(chalk.cyan(`\n✦ Jarvis CLI Ingestion: Reading "${file}"...`));
        const doc = await parseDocument(file);
        const pace = (['accelerated', 'standard', 'deep'].includes(options.pace)
            ? options.pace
            : 'standard');
        console.log(chalk.dim(`✦ Generating ${pace.toUpperCase()} curriculum from ${doc.wordCount} words...`));
        const course = await generateCourse(doc, pace);
        await saveCourse(course);
        const profile = await loadUserProfile();
        profile.activeCourseId = course.id;
        await saveUserProfile(profile);
        console.log(chalk.green.bold(`\n✓ Roadmap created successfully: "${course.title}" (${course.nodes.length} nodes)`));
        renderRoadmap(course);
        console.log(chalk.yellow(`Run 'jarvis learn' or 'jarvis' to start your first lesson!\n`));
    }
    catch (err) {
        console.error(chalk.red(`\nError: ${err.message}\n`));
        process.exit(1);
    }
});
// Command: topic <topic>
program
    .command('topic <topic...>')
    .description('Decompose any technical topic into bite-sized Duolingo-style micro-concepts and learn')
    .action(async (topicParts) => {
    const topic = Array.isArray(topicParts) ? topicParts.join(' ') : topicParts;
    try {
        console.log(chalk.cyan(`\n✦ Decomposing topic: "${topic}" into progressive micro-concepts...`));
        const profile = await loadUserProfile();
        const result = await decomposeTopicIntoConcepts(topic, profile);
        await saveCourse(result.course);
        profile.activeCourseId = result.course.id;
        await saveUserProfile(profile);
        console.log(chalk.green.bold(`\n✓ Roadmap created successfully: "${result.topic}" (${result.concepts.length} micro-concepts)`));
        renderRoadmap(result.course);
        console.log(chalk.yellow(`Starting first lesson...\n`));
        const activeNode = result.course.nodes[0];
        const lesson = activeNode.lessons[0];
        const lessonRes = await runLesson(lesson, activeNode, result.course, profile);
        if (lessonRes.success) {
            await saveCourse(result.course);
            await saveUserProfile(profile);
        }
    }
    catch (err) {
        console.error(chalk.red(`\nError: ${err.message}\n`));
        process.exit(1);
    }
});
// Command: roadmap
program
    .command('roadmap')
    .description('Display the skill tree and progress of the active course')
    .action(async () => {
    const profile = await loadUserProfile();
    if (!profile.activeCourseId) {
        console.log(chalk.yellow('\nNo active course found. Run "jarvis load <file>" to create one!\n'));
        return;
    }
    const course = await loadCourse(profile.activeCourseId);
    if (!course) {
        console.log(chalk.red('\nCourse data not found.\n'));
        return;
    }
    renderRoadmap(course);
});
// Command: learn
program
    .command('learn')
    .description('Resume your next active lesson on the roadmap')
    .action(async () => {
    const profile = await loadUserProfile();
    if (!profile.activeCourseId) {
        console.log(chalk.yellow('\nNo active course found. Run "jarvis load <file>" first!\n'));
        return;
    }
    const course = await loadCourse(profile.activeCourseId);
    if (!course) {
        console.log(chalk.red('\nCourse data not found.\n'));
        return;
    }
    const activeNode = course.nodes.find((n) => n.status === 'active') || course.nodes[0];
    const lesson = activeNode.lessons.find((l) => !l.isCompleted) || activeNode.lessons[0];
    const result = await runLesson(lesson, activeNode, course, profile);
    if (result.success) {
        await saveCourse(course);
        await saveUserProfile(profile);
    }
});
// Command: stats
program
    .command('stats')
    .description('View your XP, streak, energy hearts, and unlocked achievements')
    .action(async () => {
    const profile = await loadUserProfile();
    await renderStats(profile);
});
// Command: practice
program
    .command('practice')
    .description('Practice due concepts and restore depleted energy shields (hearts)')
    .action(async () => {
    const profile = await loadUserProfile();
    let course = null;
    if (profile.activeCourseId) {
        course = await loadCourse(profile.activeCourseId);
    }
    await runPracticeSession(profile, course);
    await saveUserProfile(profile);
});
// Command: tutor
program
    .command('tutor')
    .description('Launch Jarvis CLI conversational tutoring session')
    .action(async () => {
    const profile = await loadUserProfile();
    let course = null;
    if (profile.activeCourseId) {
        course = await loadCourse(profile.activeCourseId);
    }
    const { runAiTutorSession } = await import('./cli/views/tutorView.js');
    await runAiTutorSession(profile, course);
    await saveUserProfile(profile);
});
// Agent command group (for Antigravity, Claude Code, and ChatGPT programmatic interaction)
const agent = program
    .command('agent')
    .description('Machine-readable interface for AI agents (Antigravity, Claude Code, ChatGPT)');
agent
    .command('status')
    .description('Output JSON state of user profile and active course')
    .action(async () => {
    const { handleAgentStatus } = await import('./cli/agentMode.js');
    await handleAgentStatus();
});
agent
    .command('ingest <file>')
    .description('Ingest a document and return JSON course structure')
    .option('-p, --pace <pace>', 'accelerated, standard, or deep', 'standard')
    .action(async (file, opts) => {
    const { handleAgentIngest } = await import('./cli/agentMode.js');
    await handleAgentIngest(file, opts.pace);
});
agent
    .command('lesson')
    .description('Fetch active lesson payload in JSON for agent tutoring')
    .option('-n, --node <nodeId>', 'Optional node id')
    .action(async (opts) => {
    const { handleAgentLesson } = await import('./cli/agentMode.js');
    await handleAgentLesson(opts.node);
});
agent
    .command('submit')
    .description('Submit an answer and get JSON grading and XP updates')
    .requiredOption('-q, --question <questionId>', 'Question ID')
    .requiredOption('-a, --answer <answer>', 'Learner answer text or index')
    .option('-n, --node <nodeId>', 'Node ID')
    .option('-l, --lesson <lessonId>', 'Lesson ID')
    .action(async (opts) => {
    const { handleAgentSubmitAnswer } = await import('./cli/agentMode.js');
    await handleAgentSubmitAnswer({
        questionId: opts.question,
        answer: opts.answer,
        nodeId: opts.node,
        lessonId: opts.lesson,
    });
});
agent
    .command('decompose <topic...>')
    .description('Decompose a topic into micro-concepts in JSON for agent tutoring')
    .action(async (topicParts) => {
    const topic = Array.isArray(topicParts) ? topicParts.join(' ') : topicParts;
    const { handleAgentDecompose } = await import('./cli/agentMode.js');
    await handleAgentDecompose(topic);
});
program.parse(process.argv);
