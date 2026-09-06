import chalk from 'chalk';
import { getLevelProgress } from '../core/gamification.js';
import { resolveActiveCredentials } from '../core/agentWrapper.js';
export function renderBanner() {
    const gray = (s) => chalk.hex('#64748B')(s);
    const white = (s) => chalk.hex('#F8FAFC').bold(s);
    // Exact OpenCode pixel block logo
    const logo = [
        gray('     █ ') + gray('        ') + gray(' ▄▄▄▄  ') + white(' ▄▄▄▄ ') + white(' ▄▄▄▄  ') + white('     █ ') + white(' ▄▄▄▄ '),
        gray(' ▄▄▄▄█ ') + gray('█    █  ') + gray('█    █ ') + white('█     ') + white('█    █ ') + white(' ▄▄▄▄█ ') + white('█▄▄▄▄ '),
        gray('█    █ ') + gray('█    █  ') + gray('█    █ ') + white('█     ') + white('█    █ ') + white('█    █ ') + white('█     '),
        gray(' ▀▀▀▀▀ ') + gray(' ▀▀▀▀▀  ') + gray(' ▀▀▀▀  ') + white(' ▀▀▀▀ ') + white(' ▀▀▀▀  ') + white(' ▀▀▀▀▀ ') + white(' ▀▀▀▀ '),
    ];
    console.log('');
    logo.forEach((line) => console.log('  ' + line));
    console.log('');
}
export function renderOpenCodeChatBox(currentInput, profile, activeCourse) {
    const creds = resolveActiveCredentials(profile);
    const leftBar = chalk.hex('#38BDF8').bold('▌');
    const levelInfo = getLevelProgress(profile.xp);
    const modeBadge = chalk.hex('#38BDF8').bold('Build');
    const modelBadge = chalk.hex('#E2E8F0')(`${creds.model}`);
    const harnessBadge = creds.connectedAccount
        ? chalk.hex('#10B981')(`● ${creds.harnessName.replace(' (OAuth)', '')}: ${creds.connectedAccount}`)
        : chalk.hex('#64748B')(`○ ${creds.harnessName}`);
    const zenBadge = profile.zenMode ? chalk.hex('#38BDF8')('OpenCode Zen') : chalk.hex('#64748B')(`Streak: ${profile.streak}d · XP: ${profile.xp} (Lvl ${levelInfo.currentLevel})`);
    const hpDisplay = chalk.hex('#94A3B8')(`HP [${'■'.repeat(profile.hearts)}${'·'.repeat(Math.max(0, profile.maxHearts - profile.hearts))}]`);
    // Prompt input line
    const promptLine = currentInput ? chalk.white(currentInput) : chalk.hex('#475569')('Ask anything, solve code, or type /roadmap, /quiz, /model...');
    console.log(`  ${leftBar} ${promptLine}`);
    console.log(`  ${leftBar}`);
    console.log(`  ${leftBar} ${modeBadge}  ${modelBadge}  ${harnessBadge}`);
    console.log(`  ${leftBar} ${zenBadge}  ${hpDisplay}`);
    console.log(chalk.hex('#475569')('                                            /model switch   /roadmap   /auth'));
    console.log('');
}
export function renderStatusRibbon(profile, activeCourse) {
    renderOpenCodeChatBox('', profile, activeCourse);
}
