import { Command } from 'commander';
import chalk from 'chalk';
import { startDuoCodeRepl } from './cli/repl.js';
import { parseDocument } from './core/parser.js';
import { generateCourse } from './core/generator.js';
import { loadUserProfile, saveUserProfile, loadCourse, saveCourse, } from './core/storage.js';
import { renderRoadmap } from './cli/views/roadmapView.js';
import { renderStats } from './cli/views/statsView.js';
import { runLesson } from './cli/views/lessonView.js';
import { runPracticeSession } from './cli/views/reviewView.js';
const program = new Command();
program
    .name('duocode')
    .description('Duolingo-gamified terminal learning CLI powered by Claude Code vibes')
    .version('1.0.0');
// Default action: Interactive REPL
program
    .action(async () => {
    try {
        await startDuoCodeRepl();
    }
    catch (err) {
        console.error(chalk.red(`\n[DuoCode Error] ${err.message}`));
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
        console.log(chalk.cyan(`\n✦ DuoCode Ingestion: Reading "${file}"...`));
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
        console.log(chalk.yellow(`Run 'duocode learn' or 'duocode' to start your first lesson!\n`));
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
        console.log(chalk.yellow('\nNo active course found. Run "duocode load <file>" to create one!\n'));
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
        console.log(chalk.yellow('\nNo active course found. Run "duocode load <file>" first!\n'));
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
    .description('Launch conversational agentic AI tutoring session with Byte the Cyber-Owl')
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
program.parse(process.argv);
