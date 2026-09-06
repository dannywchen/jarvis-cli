import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executeDirectCourseCommand } from '../src/core/courseAgentTools.js';
import { queryActiveAgent } from '../src/core/agentWrapper.js';
import { loadUserProfile, listSavedCourses } from '../src/core/storage.js';

test('explicit course commands mutate storage and activate a newly prepared topic', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-course-actions-'));
  const previousDirectory = process.env.JARVIS_CLI_DATA_DIR;
  const previousOffline = process.env.JARVIS_TEST_OFFLINE;
  process.env.JARVIS_CLI_DATA_DIR = directory;
  process.env.JARVIS_TEST_OFFLINE = '1';

  try {
    const profile = await loadUserProfile();
    const created = await executeDirectCourseCommand('I wanna learn Java OOP', profile);
    assert.ok(created);
    assert.equal(created.changed, true);
    assert.match(created.text, /Java OOP/);

    const firstCourses = await listSavedCourses();
    assert.equal(firstCourses.length, 1);
    assert.equal(profile.activeCourseId, firstCourses[0].id);

    const second = await executeDirectCourseCommand('create a course for Rust ownership', profile);
    assert.ok(second);
    assert.equal((await listSavedCourses()).length, 2);

    const removed = await executeDirectCourseCommand(`remove course ${firstCourses[0].title}`, profile);
    assert.ok(removed);
    assert.equal((await listSavedCourses()).length, 1);
    assert.notEqual(profile.activeCourseId, firstCourses[0].id);

    const agentResponse = await queryActiveAgent('can you remove all courses', profile, null, {
      userQuery: 'can you remove all courses',
    });
    assert.equal(agentResponse.requiresAuth, undefined);
    assert.match(agentResponse.text, /All saved courses have been removed/);
    assert.equal((await listSavedCourses()).length, 0);
    assert.equal(profile.activeCourseId, undefined);
  } finally {
    if (previousDirectory === undefined) delete process.env.JARVIS_CLI_DATA_DIR;
    else process.env.JARVIS_CLI_DATA_DIR = previousDirectory;
    if (previousOffline === undefined) delete process.env.JARVIS_TEST_OFFLINE;
    else process.env.JARVIS_TEST_OFFLINE = previousOffline;
    await fs.rm(directory, { recursive: true, force: true });
  }
});
