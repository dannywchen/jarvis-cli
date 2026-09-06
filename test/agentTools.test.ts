import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executeAgentTool, workspacePath } from '../src/core/agentTools.js';

async function withTempWorkspace(run: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-agent-tools-'));
  try {
    await run(cwd);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
}

test('workspace tools read and write only inside the workspace', async () => {
  await withTempWorkspace(async (cwd) => {
    await fs.writeFile(path.join(cwd, 'notes.md'), 'agent notes');
    const listed = await executeAgentTool({ type: 'tool_call', tool: 'list_files' }, cwd);
    assert.match(listed, /notes\.md/);

    const read = await executeAgentTool({ type: 'tool_call', tool: 'read_file', input: { path: 'notes.md' } }, cwd);
    assert.equal(read, 'agent notes');

    await executeAgentTool({ type: 'tool_call', tool: 'write_file', input: { path: 'src/result.ts', content: 'export const ok = true;\n' } }, cwd);
    assert.equal(await fs.readFile(path.join(cwd, 'src/result.ts'), 'utf8'), 'export const ok = true;\n');
    assert.throws(() => workspacePath('../outside.txt', cwd), /outside the current workspace/);
  });
});

test('run_command permits inspection and rejects shell chaining', async () => {
  await withTempWorkspace(async (cwd) => {
    await assert.rejects(
      executeAgentTool({ type: 'tool_call', tool: 'run_command', input: { command: 'pwd; rm -rf .' } }, cwd),
      /Command not allowed/,
    );
    const pwd = await executeAgentTool({ type: 'tool_call', tool: 'run_command', input: { command: 'pwd' } }, cwd);
    assert.equal(pwd, await fs.realpath(cwd));
  });
});
