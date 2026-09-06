import chalk from 'chalk';
import readline from 'node:readline';
import { completeSlashCommand, filterSlashCommands, SlashCommand } from './commands.js';
import type { RecentThreadSummary } from '../types/index.js';
import { buildClaudeCodeBox, stripAnsi } from './banner.js';

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatEntry {
  role: ChatRole;
  text: string;
}

export interface ChatShellContext {
  model: string;
  userName?: string;
  courseTitle?: string;
  streak?: number;
  xp?: number;
  level?: number;
  cwd?: string;
  nextLesson?: string;
  recentThreads?: RecentThreadSummary[];
}

export interface ChatShellOptions {
  getContext: () => ChatShellContext;
  onSubmit: (input: string) => Promise<void>;
  onClear: () => void;
}

const ESC = '\u001B[';
const MAX_COMMANDS = 9;
const UNICODE_AGENT_FRAMES = ['[◐_◐]', '[◓_◓]', '[◑_◑]', '[◒_◒]'];
const ASCII_AGENT_FRAMES = ['[|_|]', '[/|\\]', '[-|-]', '[\\|/]'];
const WORKING_PHRASES = ['thinking softly', 'connecting the dots', 'making it click', 'polishing a reply'];

function agentFrames(): string[] {
  // Keep the animation legible in screen readers and terminals that do not
  // render Unicode reliably. The status text below is always present too.
  return process.env.TERM === 'dumb' || process.env.JARVIS_CLI_ASCII === '1' || process.env.DUOCODE_ASCII === '1'
    ? ASCII_AGENT_FRAMES
    : UNICODE_AGENT_FRAMES;
}

function terminalWidth(): number {
  // The composer and transcript should use the full terminal viewport. The
  // terminal emits `resize` and render() is already subscribed to it.
  return Math.max(36, process.stdout.columns || 88);
}

function wrapAnsi(text: string, width: number): string[] {
  const output: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (!paragraph) {
      output.push('');
      continue;
    }
    let rest = paragraph;
    while (stripAnsi(rest).length > width) {
      let visible = 0;
      let lastSpaceIdx = -1;
      let splitIdx = rest.length;
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '\u001B') {
          const end = rest.indexOf('m', i);
          if (end !== -1) {
            i = end;
            continue;
          }
        }
        visible++;
        if (rest[i] === ' ') lastSpaceIdx = i;
        if (visible === width) {
          splitIdx = lastSpaceIdx > 0 ? lastSpaceIdx : i + 1;
          break;
        }
      }
      output.push(rest.slice(0, splitIdx));
      rest = rest.slice(splitIdx).trimStart();
    }
    output.push(rest);
  }
  return output;
}

function wrap(text: string, width: number): string[] {
  return wrapAnsi(text, width);
}

function formatMarkdownAssistant(text: string, width: number): string[] {
  const lines: string[] = [];
  const rawLines = text.split('\n');
  let inCode = false;

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith('```')) {
      inCode = !inCode;
      const tag = trimmed.slice(3).trim();
      lines.push(chalk.hex('#404040')('───' + (tag ? ` [${tag}] ` : '') + '─'.repeat(Math.max(10, width - 20))));
      continue;
    }

    if (inCode) {
      lines.push(chalk.hex('#A5D6FF')('  ' + rawLine));
      continue;
    }

    if (rawLine.startsWith('### ')) {
      lines.push('');
      lines.push(chalk.hex('#F1F1F1').bold(rawLine.slice(4)));
      continue;
    }
    if (rawLine.startsWith('## ')) {
      lines.push('');
      lines.push(chalk.hex('#F1F1F1').bold(rawLine.slice(3)));
      continue;
    }
    if (rawLine.startsWith('# ')) {
      lines.push('');
      lines.push(chalk.hex('#F1F1F1').bold(rawLine.slice(2)));
      continue;
    }

    // Inline formatting: code, bold, italic
    const formatted = rawLine
      .replace(/\`([^\`]+)\`/g, (_, c) => chalk.hex('#84A7FF')(c))
      .replace(/\*\*([^*]+)\*\*/g, (_, b) => chalk.bold(b))
      .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_, i) => chalk.italic(i));

    const listMatch = formatted.match(/^(\s*)([0-9]+\.|\-|\*)\s+(.*)$/);
    if (listMatch) {
      const [, ind, bullet, item] = listMatch;
      const bulletColored = chalk.hex('#D97757')(bullet);
      const wrapped = wrapAnsi(`${bulletColored} ${item}`, width - 4);
      for (const w of wrapped) {
        lines.push(ind + w);
      }
      continue;
    }

    const wrapped = wrapAnsi(chalk.hex('#E6E6E6')(formatted), width);
    for (const w of wrapped) {
      lines.push(w);
    }
  }
  return lines;
}

function truncate(text: string, width: number): string {
  if (width <= 0) return '';
  return text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text;
}

/**
 * A tiny terminal chat surface: it owns raw keypress input and redraws a
 * transcript above a permanently-present composer. No external TUI runtime is
 * required, which keeps Jarvis CLI usable in ordinary terminals.
 */
export class TerminalChatShell {
  private transcript: ChatEntry[] = [];
  private input = '';
  private selectedCommand = 0;
  private paletteDismissed = false;
  private isWorking = false;
  private queue: string[] = [];
  private closed = false;
  private suspended = false;
  private animationFrame = 0;
  private animationTimer?: ReturnType<typeof setInterval>;
  private keepAliveTimer?: ReturnType<typeof setInterval>;
  private renderQueued = false;
  private screenActive = false;
  private lastCtrlCTime = 0;
  private finish?: () => void;
  private composerCursorLine = 1;
  private composerCursorColumn = 5;
  private boundKeypress = (_: string, key: readline.Key) => this.handleKeypress(key);
  private sigintHandler = () => {
    if (this.closed) return;
    const now = Date.now();
    if (now - this.lastCtrlCTime < 2000) {
      this.close();
    } else {
      this.lastCtrlCTime = now;
      this.input = '';
      this.add('system', 'Press Ctrl+C again to exit, or type /exit');
    }
  };

  constructor(private readonly options: ChatShellOptions) {}

  async start(): Promise<void> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      await this.startLineFallback();
      return;
    }

    if (!this.keepAliveTimer) {
      this.keepAliveTimer = setInterval(() => {}, 60_000);
      this.keepAliveTimer.ref?.();
    }

    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.off('keypress', this.boundKeypress);
    process.stdin.on('keypress', this.boundKeypress);
    process.stdout.on('resize', this.render);
    process.on('SIGINT', this.sigintHandler);
    this.enterScreen();
    this.render();

    await new Promise<void>((resolve) => {
      this.finish = resolve;
    });
  }

  add(role: ChatRole, text: string): void {
    this.transcript.push({ role, text });
    if (!process.stdout.isTTY) {
      const label = role === 'user' ? 'you' : role === 'assistant' ? 'jarvis' : 'status';
      process.stdout.write(`${label}  ${text}\n`);
      return;
    }
    this.render();
  }

  setWorking(isWorking: boolean): void {
    this.isWorking = isWorking;
    if (isWorking) this.startAnimation();
    else this.stopAnimation();
    this.render();
  }

  clear(): void {
    this.transcript = [];
    this.options.onClear();
    this.render();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stopAnimation();
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = undefined;
    }
    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(false);
      } catch {}
    }
    process.stdin.off('keypress', this.boundKeypress);
    process.stdout.off('resize', this.render);
    process.off('SIGINT', this.sigintHandler);
    this.leaveScreen();
    this.finish?.();
  }

  isClosed(): boolean {
    return this.closed;
  }

  /** Temporarily yields the terminal to an existing interactive view. */
  async suspend<T>(run: () => Promise<T>): Promise<T> {
    if (!process.stdin.isTTY) return run();
    this.suspended = true;
    try {
      process.stdin.setRawMode(false);
    } catch {}
    process.stdin.off('keypress', this.boundKeypress);
    this.leaveScreen();
    try {
      return await run();
    } finally {
      this.suspended = false;
      if (!this.closed) {
        try {
          process.stdin.resume();
          readline.emitKeypressEvents(process.stdin);
          if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
            process.stdin.setRawMode(true);
          }
          process.stdin.off('keypress', this.boundKeypress);
          process.stdin.on('keypress', this.boundKeypress);
        } catch {}
        this.enterScreen();
        this.render();
      }
    }
  }

  private async startLineFallback(): Promise<void> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    while (!this.closed) {
      const value = await new Promise<string>((resolve) => rl.question('› ', resolve));
      if (value.trim() === '/exit') this.close();
      else await this.options.onSubmit(value);
    }
    rl.close();
  }

  private handleKeypress(key: readline.Key): void {
    if (key.ctrl && key.name === 'c') {
      if (this.isWorking) {
        this.isWorking = false;
        this.queue = [];
        this.add('system', 'Operation cancelled.');
        return;
      }
      const now = Date.now();
      if (now - this.lastCtrlCTime < 2000) {
        this.close();
        return;
      }
      this.lastCtrlCTime = now;
      this.input = '';
      this.paletteDismissed = false;
      this.add('system', 'Press Ctrl+C again to exit, or type /exit');
      return;
    }

    if (key.ctrl && key.name === 'd') {
      if (!this.input) {
        this.close();
        return;
      }
      return;
    }

    const commands = this.hasOpenPalette() ? filterSlashCommands(this.input) : [];
    if (key.name === 'escape') {
      this.paletteDismissed = true;
      this.selectedCommand = 0;
      this.render();
      return;
    }
    if (key.name === 'up' && commands.length) {
      this.selectedCommand = (this.selectedCommand - 1 + commands.length) % commands.length;
      this.render();
      return;
    }
    if (key.name === 'down' && commands.length) {
      this.selectedCommand = (this.selectedCommand + 1) % commands.length;
      this.render();
      return;
    }
    if (key.name === 'tab' && commands.length) {
      this.input = completeSlashCommand(this.input, commands[this.selectedCommand]);
      this.selectedCommand = 0;
      this.paletteDismissed = true;
      this.render();
      return;
    }
    if (key.name === 'return' || key.name === 'enter') {
      if (key.shift) {
        this.input += '\n';
        this.paletteDismissed = false;
        this.selectedCommand = 0;
        this.render();
        return;
      }
      const submitted = this.input.trim();
      if (!submitted) return;
      this.input = '';
      this.selectedCommand = 0;
      this.paletteDismissed = false;
      this.queue.push(submitted);
      this.add('user', submitted);
      void this.drainQueue();
      return;
    }
    if (key.name === 'backspace') this.input = this.input.slice(0, -1);
    else if (!key.ctrl && key.sequence && key.sequence >= ' ') this.input += key.sequence;
    this.paletteDismissed = false;
    this.selectedCommand = Math.min(this.selectedCommand, Math.max(0, filterSlashCommands(this.input).length - 1));
    this.render();
  }

  private async drainQueue(): Promise<void> {
    if (this.isWorking) return;
    this.setWorking(true);
    while (this.queue.length && !this.closed) {
      const input = this.queue.shift()!;
      try {
        await this.options.onSubmit(input);
      } catch (error: any) {
        this.add('system', error?.message || 'Something went wrong.');
      }
    }
    this.setWorking(false);
  }

  /**
   * Queue one redraw for the current event loop turn. Keypresses, response
   * persistence, resize events, and the working indicator can all arrive
   * together; repainting once prevents the terminal emulator from visibly
   * chasing several intermediate cursor positions.
   */
  private render = (): void => {
    if (this.renderQueued) return;
    this.renderQueued = true;
    setImmediate(() => {
      this.renderQueued = false;
      this.renderNow();
    });
  };

  private renderNow = (): void => {
    if (this.closed || this.suspended || !process.stdout.isTTY) return;
    const width = terminalWidth();
    const contentWidth = width - 8;
    const context = this.options.getContext();
    const rows = Math.max(16, process.stdout.rows || 30);

    const composer = this.renderComposer(width);
    const allCommands = this.hasOpenPalette() ? filterSlashCommands(this.input) : [];
    const composerRows = composer.length;
    const paletteRowsAvailable = Math.max(0, rows - composerRows - 4);
    const commands = allCommands.slice(0, Math.min(MAX_COMMANDS, paletteRowsAvailable));
    if (commands.length) this.selectedCommand = Math.min(this.selectedCommand, commands.length - 1);

    const palette = this.renderPalette(commands, width);
    const bodyRows = Math.max(0, rows - palette.length - composer.length);
    const transcriptLines: string[] = [];

    if (this.isWelcomeState()) {
      const boxLines = buildClaudeCodeBox({
        userName: context.userName,
        modelName: context.model,
        level: context.level,
        xp: context.xp,
        cwd: context.cwd,
        recentThreads: context.recentThreads,
        version: 'v1.0.0',
      }, width);

      transcriptLines.push('');
      for (const line of boxLines) {
        transcriptLines.push(line);
      }
      transcriptLines.push('');
    } else {
      for (const entry of this.transcript) {
        if (entry.role === 'user') {
          const userPill = (val: string) => chalk.bgHex('#282828').hex('#F0F0F0')(val);
          const parts = wrapAnsi(`> ${entry.text}`, contentWidth);
          for (const part of parts) {
            transcriptLines.push(`  ${userPill(part)}`);
          }
        } else if (entry.role === 'assistant') {
          const formattedLines = formatMarkdownAssistant(entry.text, contentWidth);
          if (formattedLines.length > 0) {
            transcriptLines.push(`  ${chalk.hex('#D97757')('•')} ${formattedLines[0]}`);
            for (let i = 1; i < formattedLines.length; i++) {
              transcriptLines.push(`    ${formattedLines[i]}`);
            }
          }
        } else {
          // system
          const color = chalk.hex('#8A8A8A');
          const parts = wrapAnsi(entry.text, contentWidth);
          if (parts.length > 0) {
            transcriptLines.push(`  ${chalk.hex('#777777')('·')} ${color(parts[0])}`);
            for (let i = 1; i < parts.length; i++) {
              transcriptLines.push(`    ${color(parts[i])}`);
            }
          }
        }
        transcriptLines.push('');
      }
    }

    const visibleTranscript = transcriptLines.slice(-bodyRows);
    const body = this.isWelcomeState()
      ? [...visibleTranscript, ...Array(Math.max(0, bodyRows - visibleTranscript.length)).fill('')]
      : [...Array(Math.max(0, bodyRows - visibleTranscript.length)).fill(''), ...visibleTranscript];

    let lines = [...body, ...palette, ...composer];
    if (lines.length > rows) lines = lines.slice(-rows);
    while (lines.length < rows) lines.push('');

    const composerStartIndex = lines.length - composer.length;
    const cursorIndex = composerStartIndex + this.composerCursorLine;
    const rowsUp = Math.max(0, lines.length - 1 - cursorIndex);
    const moveToPrompt = `${rowsUp ? `${ESC}${rowsUp}A` : ''}${ESC}${this.composerCursorColumn}G`;

    // One write keeps the clear + paint + cursor placement atomic. The final
    // newline is intentionally omitted: it would create an extra scroll step
    // when the last status row exactly fills the terminal width.
    process.stdout.write(`${ESC}?25l${ESC}H${ESC}2J${lines.join('\n')}${moveToPrompt}${ESC}?25h`);
  };

  /** Keep the chat viewport independent from the terminal's normal scrollback. */
  private enterScreen(): void {
    if (this.screenActive || !process.stdout.isTTY) return;
    // 1049 preserves the user's normal shell screen and gives the chat a
    // fixed viewport, so cursor movement cannot push the shell's scrollback.
    process.stdout.write(`${ESC}?1049h${ESC}?25l`);
    this.screenActive = true;
  }

  private leaveScreen(): void {
    if (!this.screenActive || !process.stdout.isTTY) return;
    process.stdout.write(`${ESC}?25h${ESC}?1049l`);
    this.screenActive = false;
  }

  private renderPalette(commands: SlashCommand[], width: number): string[] {
    if (!this.hasOpenPalette()) return [];
    const lines = [
      chalk.hex('#404040')(`  ${'─'.repeat(width - 4)}`),
      chalk.hex('#D97757').bold('  Commands'),
    ];
    if (!commands.length) lines.push(chalk.hex('#777777')('  No matching commands'));
    commands.forEach((command, index) => lines.push(this.renderCommand(command, index === this.selectedCommand, width)));
    return lines;
  }

  private renderComposer(width: number): string[] {
    const hr = chalk.hex('#353535')('─'.repeat(width));
    const inputWidth = Math.max(12, width - 4);
    const promptChar = chalk.hex('#D97757')('>');
    const placeholder = chalk.hex('#666666')('try "learn quantum computing" or ask any question...');
    const inputLines = this.wrapInput(this.input, inputWidth);
    const lines = [hr];
    inputLines.forEach((line, index) => {
      const prefix = index === 0 ? `  ${promptChar} ` : '    ';
      const value = line || (index === 0 && !this.input ? placeholder : '');
      lines.push(`${prefix}${value === placeholder ? value : chalk.hex('#F0F0F0')(value)}`);
    });

    const lastInputLine = inputLines.length - 1;
    this.composerCursorLine = 1 + lastInputLine;
    this.composerCursorColumn = Math.min(width, 5 + inputLines[lastInputLine].length);

    // Keep the status strip in one stable row below the composer. While Jarvis
    // is responding, the animated activity replaces manual mode in this exact
    // slot so the indicator does not jump vertically or change the composer
    // height.
    lines.push(hr);
    if (this.isWorking) {
      const frame = agentFrames()[this.animationFrame % agentFrames().length];
      const queued = this.queue.length ? ` · ${this.queue.length} queued` : '';
      const activity = `  ${chalk.hex('#D97757')(frame)} ${chalk.hex('#888888')(WORKING_PHRASES[this.animationFrame % WORKING_PHRASES.length])}${queued}`;
      lines.push(truncate(activity, width));
    } else {
      lines.push(chalk.hex('#777777')(truncate('  ↪ manual mode · shift+enter for newline · ↑↓ for commands · ctrl+c to exit', width)));
    }

    return lines;
  }

  private wrapInput(value: string, width: number): string[] {
    const lines: string[] = [];
    for (const logicalLine of value.split('\n')) {
      if (!logicalLine) {
        lines.push('');
        continue;
      }
      for (let offset = 0; offset < logicalLine.length; offset += width) {
        lines.push(logicalLine.slice(offset, offset + width));
      }
    }
    return lines.length ? lines : [''];
  }

  private startAnimation(): void {
    if (this.animationTimer) return;
    this.animationFrame = 0;
    this.animationTimer = setInterval(() => {
      if (this.closed || !this.isWorking) {
        this.stopAnimation();
        return;
      }
      this.animationFrame = (this.animationFrame + 1) % agentFrames().length;
      if (!this.suspended) this.render();
    }, 220);
    this.animationTimer.unref?.();
  }

  private stopAnimation(): void {
    if (this.animationTimer) clearInterval(this.animationTimer);
    this.animationTimer = undefined;
    this.animationFrame = 0;
  }

  private renderCommand(command: SlashCommand, selected: boolean, width: number): string {
    const prefix = selected ? chalk.bgHex('#2C2C2C') : (value: string) => value;
    const marker = selected ? chalk.hex('#D97757')('›') : ' ';
    const label = `/${command.name}${command.acceptsArgument ? ` <${command.argumentHint || 'value'}>` : ''}`;
    const description = truncate(command.description, Math.max(0, width - 26));
    return prefix(`  ${marker} ${chalk.hex('#E7E7E7')(label.padEnd(22))}${chalk.hex('#8B8B8B')(description)}`);
  }

  private hasOpenPalette(): boolean {
    return this.input.startsWith('/') && !/\s/.test(this.input.slice(1)) && !this.paletteDismissed;
  }

  private isWelcomeState(): boolean {
    return !this.transcript.some((e) => e.role === 'user' || e.role === 'assistant');
  }
}
