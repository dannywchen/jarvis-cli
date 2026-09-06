import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  appendRecentThreadMessage,
  createRecentThread,
  loadRecentThreads,
} from '../src/core/storage.js';
import { createJarvisCliHarness, loadReplHistory } from '../src/cli/repl.js';

async function withTemporaryStorage<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-history-'));
  const previous = process.env.JARVIS_CLI_DATA_DIR;
  process.env.JARVIS_CLI_DATA_DIR = directory;
  try {
    return await run(directory);
  } finally {
    if (previous === undefined) delete process.env.JARVIS_CLI_DATA_DIR;
    else process.env.JARVIS_CLI_DATA_DIR = previous;
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test('recent threads persist and can be reopened with continuation context', async () => {
  await withTemporaryStorage(async () => {
    const created = await createRecentThread({ id: 'thread_resume', model: 'gpt-5.6-luna', harness: 'Jarvis CLI' });
    const withUser = await appendRecentThreadMessage(created.id, { role: 'user', text: 'Explain durable local history.' });
    assert(withUser);
    const saved = await appendRecentThreadMessage(created.id, { role: 'assistant', text: 'Store versioned records and append atomically.' });
    assert(saved);

    const reopened = await createJarvisCliHarness({ threadId: created.id });
    assert.equal(reopened.getSnapshot().resumed, true);
    assert.equal(reopened.getSnapshot().activeThread?.messages.length, 2);
    assert.match(reopened.buildContinuationPrompt('How do I reopen it?'), /Explain durable local history/);
    assert.match(reopened.buildContinuationPrompt('How do I reopen it?'), /How do I reopen it\?/);

    await reopened.recordMessage('user', 'How do I reopen it?');
    const persisted = await loadRecentThreads();
    assert.equal(persisted[0]?.id, created.id);
    assert.equal(persisted[0]?.messages.length, 3);
    assert.equal(persisted[0]?.title, 'Explain durable local history.');

    const snapshot = await loadReplHistory(created.id);
    assert.equal(snapshot.activeThread?.messages.at(-1)?.text, 'How do I reopen it?');
  });
});

test('legacy history migrates without deleting the source file', async () => {
  await withTemporaryStorage(async (directory) => {
    const legacyPath = path.join(directory, 'history.json');
    await fs.writeFile(
      legacyPath,
      JSON.stringify({
        version: 0,
        sessions: [
          {
            sessionId: 'legacy_session',
            name: 'Migrated conversation',
            messages: [
              { author: 'human', content: 'Keep my old thread.' },
              { author: 'bot', content: 'It is still available.' },
            ],
          },
        ],
      }),
      'utf-8'
    );

    const migrated = await loadRecentThreads();
    assert.equal(migrated.length, 1);
    assert.equal(migrated[0]?.id, 'legacy_session');
    assert.equal(migrated[0]?.messages[0]?.role, 'user');
    assert.equal(migrated[0]?.messages[1]?.role, 'assistant');
    assert.equal(await fs.stat(legacyPath).then(() => true), true);

    const canonical = JSON.parse(await fs.readFile(path.join(directory, 'recent-threads.json'), 'utf-8')) as { version: number };
    assert.equal(canonical.version, 1);
  });
});
