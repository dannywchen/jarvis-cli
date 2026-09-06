import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import chalk from 'chalk';

export interface SetupResult {
  editor: string;
  path: string;
  status: 'already-configured' | 'updated' | 'not-found';
  message: string;
}

export function detectAndConfigureKeybindings(): SetupResult[] {
  const home = os.homedir();
  const platform = os.platform();
  const results: SetupResult[] = [];

  const candidates: { editor: string; dir: string }[] = [];

  if (platform === 'darwin') {
    candidates.push(
      { editor: 'Antigravity IDE', dir: path.join(home, 'Library/Application Support/Antigravity/User') },
      { editor: 'VS Code', dir: path.join(home, 'Library/Application Support/Code/User') },
      { editor: 'Cursor', dir: path.join(home, 'Library/Application Support/Cursor/User') },
      { editor: 'Windsurf', dir: path.join(home, 'Library/Application Support/Windsurf/User') },
      { editor: 'VSCodium', dir: path.join(home, 'Library/Application Support/VSCodium/User') }
    );
  } else if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    candidates.push(
      { editor: 'Antigravity IDE', dir: path.join(appData, 'Antigravity/User') },
      { editor: 'VS Code', dir: path.join(appData, 'Code/User') },
      { editor: 'Cursor', dir: path.join(appData, 'Cursor/User') },
      { editor: 'Windsurf', dir: path.join(appData, 'Windsurf/User') }
    );
  } else {
    // Linux
    candidates.push(
      { editor: 'Antigravity IDE', dir: path.join(home, '.config/Antigravity/User') },
      { editor: 'VS Code', dir: path.join(home, '.config/Code/User') },
      { editor: 'Cursor', dir: path.join(home, '.config/Cursor/User') }
    );
  }

  for (const item of candidates) {
    if (!fs.existsSync(item.dir)) continue;
    const filePath = path.join(item.dir, 'keybindings.json');
    try {
      let bindings: any[] = [];
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        try {
          const clean = content.replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, '$1');
          bindings = JSON.parse(clean);
          if (!Array.isArray(bindings)) bindings = [];
        } catch {
          bindings = [];
        }
      }

      const hasShiftEnter = bindings.some(
        (b) =>
          typeof b?.key === 'string' &&
          b.key.toLowerCase().replace(/\s+/g, '') === 'shift+enter' &&
          (b.when?.includes('terminal') || b.command?.includes('terminal'))
      );

      if (hasShiftEnter) {
        results.push({
          editor: item.editor,
          path: filePath,
          status: 'already-configured',
          message: `${chalk.hex('#4ADE80')('✓')} ${item.editor}: Shift+Enter keybinding is active.`,
        });
      } else {
        bindings.push({
          key: 'shift+enter',
          command: 'workbench.action.terminal.sendSequence',
          args: { text: '\\\r\n' },
          when: 'terminalFocus',
        });
        fs.writeFileSync(filePath, JSON.stringify(bindings, null, 2), 'utf-8');
        results.push({
          editor: item.editor,
          path: filePath,
          status: 'updated',
          message: `${chalk.hex('#4ADE80')('✓')} ${item.editor}: Added Shift+Enter terminal shortcut to ${filePath}`,
        });
      }
    } catch (e: any) {
      results.push({
        editor: item.editor,
        path: filePath,
        status: 'not-found',
        message: `${chalk.hex('#F87171')('✕')} ${item.editor}: Error updating keybindings (${e.message})`,
      });
    }
  }

  return results;
}

export function formatTerminalSetupReport(): string {
  const results = detectAndConfigureKeybindings();
  const lines: string[] = [
    chalk.hex('#F8FAFC').bold('Terminal Setup & Multiline Keybindings'),
    '',
  ];

  if (results.length === 0) {
    lines.push(chalk.hex('#94A3B8')('No supported GUI editor configurations detected on this machine.'));
  } else {
    for (const r of results) {
      lines.push(`  ${r.message}`);
    }
  }

  lines.push('');
  lines.push(chalk.hex('#E07A5F').bold('Supported Multiline Shortcuts:'));
  lines.push(`  ${chalk.hex('#F1F1F1')('Shift + Enter'.padEnd(20))} ${chalk.hex('#94A3B8')('Insert new line (in VS Code, Cursor, Kitty, Ghostty, iTerm)')}`);
  lines.push(`  ${chalk.hex('#F1F1F1')('\\ + Enter'.padEnd(20))} ${chalk.hex('#94A3B8')('Universal line continuation (works in every terminal)')}`);
  lines.push(`  ${chalk.hex('#F1F1F1')('Option + Enter'.padEnd(20))} ${chalk.hex('#94A3B8')('Insert new line (macOS Alt/Option)')}`);
  lines.push(`  ${chalk.hex('#F1F1F1')('Ctrl + J'.padEnd(20))} ${chalk.hex('#94A3B8')('Universal ASCII Line Feed (works everywhere without setup)')}`);
  lines.push(`  ${chalk.hex('#F1F1F1')('Ctrl + U'.padEnd(20))} ${chalk.hex('#94A3B8')('Clear current input buffer')}`);

  return lines.join('\n');
}
