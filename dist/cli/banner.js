import chalk from 'chalk';
import os from 'node:os';
export function stripAnsi(str) {
    return str.replace(/\u001B\[[0-9;]*m/g, '');
}
export function normalizeModelName(rawModel) {
    if (!rawModel)
        return 'Gemini 3.8 Flash';
    const lower = rawModel.toLowerCase();
    if (lower.includes('gemini-3.8-flash'))
        return 'Gemini 3.8 Flash';
    if (lower.includes('gemini-2.5-flash') || lower.includes('gemini-2.0-flash'))
        return 'Gemini 2.5 Flash';
    if (lower.includes('gemini-2.5-pro') || lower.includes('gemini-3-pro'))
        return 'Gemini 3 Pro';
    if (lower.includes('gpt-5.6') || lower.includes('luna'))
        return 'GPT-5.6 Luna';
    if (lower.includes('gpt-4o'))
        return 'GPT-4o';
    if (lower.includes('claude-3-5-sonnet') || lower.includes('claude-3.5-sonnet'))
        return 'Sonnet 3.5';
    if (lower.includes('claude-3-7-sonnet') || lower.includes('claude-3.7-sonnet'))
        return 'Sonnet 3.7';
    if (lower.includes('sonnet-4.5') || lower.includes('claude-4.5-sonnet'))
        return 'Sonnet 4.5';
    return rawModel;
}
export function formatCwd(dir) {
    const target = dir || process.cwd();
    const home = os.homedir();
    if (target === home)
        return '~';
    if (target.startsWith(home + '/')) {
        return '~' + target.slice(home.length);
    }
    return target;
}
export function relativeAge(timestamp) {
    const elapsed = Math.max(0, Date.now() - new Date(timestamp).getTime());
    const minutes = Math.floor(elapsed / 60_000);
    if (minutes < 1)
        return '1m ago';
    if (minutes < 60)
        return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24)
        return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7)
        return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    return `${weeks}w ago`;
}
/**
 * Builds the exact pixel-perfect Claude Code box layout from Screenshot 2:
 *
 * ╭┈┈┈┈┈┈┈ Jarvis CLI v1.0.0 ┈┈┈┈┈┈┈┈┬┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈╮
 * ┊                                  ┊ Recent activity                          ┊
 * ┊       Welcome back Danny!        ┊ 1m ago   Updated project memory          ┊
 * ┊                                  ┊ 8m ago   Updated claw'd feet             ┊
 * ┊             ▄▄   ▄▄              ┊ 2d ago   Add new words to spinner        ┊
 * ┊             ████████             ┊ 1w ago   Update unit tests               ┊
 * ┊             ██▄██▄██             ┊ ... /resume for more                     ┊
 * ┊             ████████             ┊                                          ┊
 * ┊             █ █  █ █             ├┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┤
 * ┊                                  ┊ What's new                               ┊
 * ┊                                  ┊ /topic to break down & learn any topic   ┊
 * ┊Gemini 3.8 Flash • Level 1 (0 XP) ┊ /learn to start bite-sized lesson        ┊
 * ┊  ~/Documents/GitHub/jarvis-cli   ┊ /quiz for challenge drills               ┊
 * ┊                                  ┊ ... /help for more                       ┊
 * ╰┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┴┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈╯
 */
export function buildClaudeCodeBox(context = {}, termWidth = 88) {
    const coral = chalk.hex('#D97757');
    const coralBold = chalk.hex('#D97757').bold;
    const white = chalk.hex('#E5E5E5');
    const boldWhite = chalk.hex('#FFFFFF').bold;
    const gray = chalk.hex('#888888');
    const dim = chalk.hex('#555555');
    const leftW = 34;
    const rightW = 42;
    const indent = termWidth >= 83 ? '  ' : termWidth >= 80 ? ' ' : '';
    const userName = context.userName || 'Danny';
    const model = normalizeModelName(context.modelName);
    const level = context.level ?? 1;
    const xp = context.xp ?? 0;
    const cwd = formatCwd(context.cwd);
    const version = context.version || 'v1.0.0';
    const center = (text, width) => {
        const raw = stripAnsi(text);
        if (raw.length >= width)
            return text.slice(0, width);
        const leftPad = Math.floor((width - raw.length) / 2);
        const rightPad = width - raw.length - leftPad;
        return ' '.repeat(leftPad) + text + ' '.repeat(rightPad);
    };
    const padRightAnsi = (styledText, width) => {
        const rawLen = stripAnsi(styledText).length;
        if (rawLen >= width)
            return styledText;
        return styledText + ' '.repeat(width - rawLen);
    };
    const truncate = (text, width) => {
        if (text.length <= width)
            return text;
        return `${text.slice(0, Math.max(0, width - 1))}…`;
    };
    const truncatePath = (path, width) => {
        if (path.length <= width)
            return path;
        return `…${path.slice(-(width - 1))}`;
    };
    const leftLines = [
        ' '.repeat(leftW),
        boldWhite(center(`Welcome back ${userName}!`, leftW)),
        ' '.repeat(leftW),
        coral(center('  ▄▄   ▄▄  ', leftW)),
        coral(center(' ████████ ', leftW)),
        coral(center(' ██▄██▄██ ', leftW)),
        coral(center(' ████████ ', leftW)),
        coral(center(' █ █  █ █ ', leftW)),
        ' '.repeat(leftW),
        ' '.repeat(leftW),
        gray(center(truncate(xp > 0 ? `${model} • Lvl ${level} (${xp} XP)` : `${model} • Level ${level}`, leftW), leftW)),
        dim(center(truncatePath(cwd, leftW - 2), leftW)),
        ' '.repeat(leftW),
    ];
    const recentLines = [];
    recentLines.push(coral(' Recent activity'));
    const threads = context.recentThreads || [];
    if (threads.length > 0) {
        for (let i = 0; i < Math.min(4, threads.length); i++) {
            const t = threads[i];
            const age = relativeAge(t.updatedAt).padEnd(8);
            const title = truncate(t.title, 31);
            recentLines.push(gray(` ${age} `) + white(title));
        }
    }
    else {
        recentLines.push(gray(' 1m ago   ') + white('Updated project memory'));
        recentLines.push(gray(' 8m ago   ') + white("Updated claw'd feet"));
        recentLines.push(gray(' 2d ago   ') + white('Add new words to spinner'));
        recentLines.push(gray(' 1w ago   ') + white('Update unit tests'));
    }
    while (recentLines.length < 5) {
        recentLines.push(' '.repeat(rightW));
    }
    recentLines.push(gray(' ... /resume for more'));
    recentLines.push(' '.repeat(rightW));
    const whatNewLines = [
        coral(" What's new"),
        gray(' /topic to break down & learn any topic'),
        gray(' /learn to start bite-sized lesson'),
        gray(' /quiz for challenge drills'),
        gray(' ... /help for more'),
    ];
    const rightLines = [
        ...recentLines,
        'DIVIDER',
        ...whatNewLines,
    ];
    const lines = [];
    // Top border: ╭┈┈┈┈┈┈┈ Jarvis CLI v1.0.0 ┈┈┈┈┈┈┈┈┬┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈╮
    lines.push(indent +
        coral('╭' + '┈'.repeat(7)) +
        ' ' + coralBold('Jarvis CLI') + ' ' + gray(version) + ' ' +
        coral('┈'.repeat(8) + '┬' + '┈'.repeat(rightW) + '╮'));
    for (let i = 0; i < 13; i++) {
        const l = leftLines[i];
        if (i === 7) {
            lines.push(indent + coral('┊') + l + coral('├' + '┈'.repeat(rightW) + '┤'));
        }
        else {
            const r = padRightAnsi(rightLines[i] || '', rightW);
            lines.push(indent + coral('┊') + l + coral('┊') + r + coral('┊'));
        }
    }
    lines.push(indent + coral('╰' + '┈'.repeat(leftW) + '┴' + '┈'.repeat(rightW) + '╯'));
    return lines;
}
export function renderBanner(context) {
    const lines = buildClaudeCodeBox(context || {});
    console.log('');
    lines.forEach((line) => console.log(line));
    console.log('');
}
export function renderJarvisChatBox(currentInput, _profile, _activeCourse) {
    const width = Math.max(36, Math.min(process.stdout.columns || 88, 96));
    const hr = chalk.hex('#353535')('─'.repeat(width));
    const promptChar = chalk.hex('#D97757')('>');
    const placeholder = chalk.hex('#666666')('say what you want to learn, or ask any question...');
    const promptLine = currentInput
        ? `  ${promptChar} ${chalk.hex('#F0F0F0')(currentInput)}`
        : `  ${promptChar} ${placeholder}`;
    console.log(hr);
    console.log(promptLine);
    console.log('');
}
export function renderStatusRibbon(profile, activeCourse) {
    renderJarvisChatBox('', profile, activeCourse);
}
// Compatibility export for integrations that used earlier helper names.
export const renderOpenCodeChatBox = renderJarvisChatBox;
