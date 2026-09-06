import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { TerminalChatShell } from '../src/cli/chatShell.js';
import { detectAndConfigureKeybindings, formatTerminalSetupReport } from '../src/cli/terminalSetup.js';
import { resolveSlashCommand } from '../src/cli/commands.js';

interface TestShellContext {
  shell: TerminalChatShell;
  stdin: PassThrough;
  stdout: PassThrough;
  submitted: string[];
}

function createTestShell(): TestShellContext {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  // Simulate TTY properties
  (stdin as any).isTTY = true;
  (stdin as any).setRawMode = () => stdin;
  (stdout as any).isTTY = true;
  (stdout as any).columns = 80;
  (stdout as any).rows = 24;

  const submitted: string[] = [];

  const shell = new TerminalChatShell({
    getContext: () => ({
      model: 'gemini-3.8-flash',
      userName: 'Danny',
    }),
    onSubmit: async (input) => {
      submitted.push(input);
    },
    onClear: () => undefined,
    stdin,
    stdout,
  });

  // Start shell event loop
  void shell.start();

  return { shell, stdin, stdout, submitted };
}

test('Shift+Enter via VS Code / Cursor sendSequence (\\ + \\r\\n) inserts newline and does not submit', async () => {
  const { shell, stdin, submitted } = createTestShell();

  stdin.write('hello');
  stdin.write('\\\r\n');
  assert.equal(shell.getInput(), 'hello\n');
  assert.equal(submitted.length, 0);

  stdin.write('hello');
  assert.equal(shell.getInput(), 'hello\nhello');
  assert.equal(submitted.length, 0);

  stdin.write('\r');
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0], 'hello\nhello');
  assert.equal(shell.getInput(), '');

  shell.close();
});

test('Manual backslash continuation (hello\\ followed by Enter) inserts newline and does not submit', async () => {
  const { shell, stdin, submitted } = createTestShell();

  stdin.write('hello\\');
  stdin.write('\r');
  assert.equal(shell.getInput(), 'hello\n');
  assert.equal(submitted.length, 0);

  stdin.write('world');
  stdin.write('\r');
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0], 'hello\nworld');
  assert.equal(shell.getInput(), '');

  shell.close();
});

test('Kitty keyboard protocol Shift+Enter (CSI 13;2u) inserts newline', async () => {
  const { shell, stdin, submitted } = createTestShell();

  stdin.write('line1');
  stdin.write('\u001B[13;2u');
  assert.equal(shell.getInput(), 'line1\n');
  assert.equal(submitted.length, 0);

  stdin.write('line2');
  stdin.write('\r');
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0], 'line1\nline2');

  shell.close();
});

test('Kitty keyboard protocol Ctrl+Enter (CSI 13;5u) and Alt+Enter (CSI 13;3u) insert newlines', async () => {
  const { shell, stdin, submitted } = createTestShell();

  stdin.write('part1');
  stdin.write('\u001B[13;5u');
  assert.equal(shell.getInput(), 'part1\n');

  stdin.write('part2');
  stdin.write('\u001B[13;3u');
  assert.equal(shell.getInput(), 'part1\npart2\n');
  assert.equal(submitted.length, 0);

  stdin.write('part3');
  stdin.write('\r');
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0], 'part1\npart2\npart3');

  shell.close();
});

test('xterm modifyOtherKeys Shift+Enter (CSI 27;2;13~) is normalized to newline without corrupting text', async () => {
  const { shell, stdin, submitted } = createTestShell();

  stdin.write('query');
  stdin.write('\u001B[27;2;13~');
  assert.equal(shell.getInput(), 'query\n');
  assert.equal(submitted.length, 0);

  stdin.write('more');
  stdin.write('\r');
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0], 'query\nmore');

  shell.close();
});

test('Option+Enter / Meta+Enter (\\u001B\\r) inserts newline', async () => {
  const { shell, stdin, submitted } = createTestShell();

  stdin.write('option1');
  stdin.write('\u001B\r');
  assert.equal(shell.getInput(), 'option1\n');
  assert.equal(submitted.length, 0);

  stdin.write('option2');
  stdin.write('\r');
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0], 'option1\noption2');

  shell.close();
});

test('Ctrl+J / raw Line Feed (\\n) inserts newline without submitting', async () => {
  const { shell, stdin, submitted } = createTestShell();

  stdin.write('ctrl');
  stdin.write('\n');
  assert.equal(shell.getInput(), 'ctrl\n');
  assert.equal(submitted.length, 0);

  stdin.write('sub');
  stdin.write('\r');
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0], 'ctrl\nsub');

  shell.close();
});

test('Backspace removes newline character cleanly', async () => {
  const { shell, stdin } = createTestShell();

  stdin.write('a');
  stdin.write('\\\r\n');
  assert.equal(shell.getInput(), 'a\n');

  stdin.write('b');
  assert.equal(shell.getInput(), 'a\nb');

  // Backspace b
  stdin.write('\x7f');
  assert.equal(shell.getInput(), 'a\n');

  // Backspace newline
  stdin.write('\x7f');
  assert.equal(shell.getInput(), 'a');

  shell.close();
});

test('Ctrl+U clears current multiline buffer', async () => {
  const { shell, stdin } = createTestShell();

  stdin.write('hello');
  stdin.write('\\\r\n');
  stdin.write('world');
  assert.equal(shell.getInput(), 'hello\nworld');

  // Ctrl+U is ASCII 21 (\x15)
  stdin.write('\x15');
  assert.equal(shell.getInput(), '');

  shell.close();
});

test('Bracketed paste preserves newlines and does not submit early', async () => {
  const { shell, stdin, submitted } = createTestShell();

  stdin.write('\u001B[200~hello\nworld\r\nmultiline\u001B[201~');
  assert.equal(shell.getInput(), 'hello\nworld\nmultiline');
  assert.equal(submitted.length, 0);

  stdin.write('\r');
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0], 'hello\nworld\nmultiline');

  shell.close();
});

test('history scroll moves the transcript without changing the composer input', async () => {
  const { shell, stdin } = createTestShell();

  for (let index = 0; index < 30; index += 1) {
    shell.add('assistant', `message ${index}`);
  }

  const getScrollOffset = () => (shell as any).transcriptScrollOffset as number;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(getScrollOffset(), 0);

  stdin.write('\u001B[5~'); // PageUp
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.ok(getScrollOffset() > 0);
  assert.equal(shell.getInput(), '');

  stdin.write('\u001B[6~'); // PageDown
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(getScrollOffset(), 0);

  stdin.write('\u001B[<64;10;10M'); // SGR wheel up
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.ok(getScrollOffset() > 0);
  assert.equal(shell.getInput(), '');

  stdin.write('\u001B[5~'); // PageUp again, then End returns to latest.
  stdin.write('\u001B[F');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(getScrollOffset(), 0);

  shell.close();
});

test('composer rule does not reach the terminal right margin', async () => {
  const { shell, stdout } = createTestShell();

  await new Promise<void>((resolve) => setImmediate(resolve));
  const frame = stdout.read()?.toString() || '';
  const visibleLines = frame
    .replace(/\u001B\[[0-9;?<>]*[ -/]*[@-~]/g, '')
    .split('\n');
  const rules = visibleLines.filter((line) => /^─+$/.test(line));

  assert.ok(rules.length >= 2);
  assert.ok(rules.every((line) => line.length < 80));
  assert.ok(frame.includes('manual mode'));

  shell.add('assistant', 'A response after sending a message.');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.ok((stdout.read()?.toString() || '').includes('manual mode'));

  shell.close();
});

test('terminal-setup slash command resolves and detects keybindings', () => {
  const cmd = resolveSlashCommand('/terminal-setup');
  assert.equal(cmd?.name, 'terminal-setup');

  const report = formatTerminalSetupReport();
  assert.equal(report.includes('Terminal Setup & Multiline Keybindings'), true);
  assert.equal(report.includes('Shift + Enter'), true);
  assert.equal(report.includes('\\ + Enter'), true);
});
