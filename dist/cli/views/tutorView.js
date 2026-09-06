import chalk from 'chalk';
import boxen from 'boxen';
import * as p from '@clack/prompts';
import { awardXp } from '../../core/gamification.js';
import { playChime } from '../effects.js';
import { chatWithAgentTutor, detectAgentEnvironment } from '../../core/agentBridge.js';
export async function runAiTutorSession(profile, activeCourse) {
    console.clear();
    const agentInfo = detectAgentEnvironment();
    console.log('\n  ' + chalk.hex('#F8FAFC').bold(`[TUTOR] AGENT DIALOGUE MODE`));
    console.log(chalk.hex('#64748B')(`  Active Engine: ${agentInfo.badge} · Course: ${activeCourse ? activeCourse.title : 'General Systems'}\n`));
    console.log(boxen(chalk.hex('#F8FAFC').bold('Agent Dialogue Active\n\n') +
        chalk.hex('#CBD5E1')(`Connected Course: ${activeCourse ? activeCourse.title : 'General Computer Science'}\n`) +
        chalk.hex('#64748B')('Ask for concept breakdowns, system trade-offs, analogies, or targeted drills.\n') +
        chalk.hex('#475569')('Type "exit" or "done" to return to the hub.'), { padding: 1, borderColor: 'gray', borderStyle: 'round' }));
    let active = true;
    while (active) {
        const userInput = await p.text({
            message: chalk.hex('#38BDF8').bold('│ ') + chalk.white('Query:'),
            placeholder: 'e.g. "Explain runtime polymorphism with an analogy" or "exit"',
        });
        if (p.isCancel(userInput) || !userInput || ['exit', 'quit', 'done'].includes(userInput.trim().toLowerCase())) {
            active = false;
            break;
        }
        const query = userInput.trim();
        const spinner = p.spinner();
        spinner.start(`✦ ${agentInfo.badge} synthesizing explanation...`);
        const result = await chatWithAgentTutor(query, profile, activeCourse);
        spinner.stop('Response synthesized:');
        console.log(boxen(result.text, {
            padding: 1,
            borderColor: 'gray',
            borderStyle: 'round',
        }));
        awardXp(profile, result.xpAwarded);
        playChime();
        console.log(chalk.hex('#38BDF8')(`  +${result.xpAwarded} XP awarded · Total: ${profile.xp}\n`));
    }
    p.outro(chalk.hex('#10B981')('Tutoring session completed.'));
}
