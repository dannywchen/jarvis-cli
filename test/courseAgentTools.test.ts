import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executeDirectCourseCommand, parseLearningRequest } from '../src/core/courseAgentTools.js';
import { generateOnTheFlyFlashcards, generateOnTheFlyQuiz, queryActiveAgent, rememberGeneratedLearning } from '../src/core/agentWrapper.js';
import { loadUserProfile, listSavedCourses } from '../src/core/storage.js';
import { Course, UserProfile } from '../src/types/index.js';

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

test('natural learning requests keep the subject and infer learner level without a prompt flow', () => {
  const parsed = parseLearningRequest('i wanna learn java OOP in detail. im an intro to cs student');
  assert.equal(parsed?.topic, 'java OOP');
  assert.equal(parsed?.intent.level, 'beginner');
  assert.match(parsed?.intent.goal || '', /java OOP in detail/i);
});

test('offline study activities stay course-grounded and rotate through unused prompts', async () => {
  const profile: UserProfile = {
    name: 'Learner', xp: 0, level: 1, hearts: 5, maxHearts: 5, streak: 1, lastActiveDate: '',
    zenMode: false, completedLessonsCount: 0, masteredSkillsCount: 0, achievements: [],
  };
  const course: Course = {
    id: 'java-oop', title: 'Java OOP', sourceFileName: 'Topic: Java OOP', pace: 'standard',
    createdAt: new Date().toISOString(), summary: 'Java objects and classes',
    nodes: [{
      id: 'classes', unitId: 'unit_1', unitTitle: 'Foundations', title: 'Classes and Objects',
      description: 'Create objects from classes and use fields and methods.', order: 1, status: 'active',
      lessons: [{
        id: 'classes-lesson', title: 'Classes', conceptDigest: 'A class describes object shape.', keyTakeaway: 'Objects hold state and behavior.',
        questions: [1, 2, 3, 4].map((n) => ({
          id: `q${n}`, type: 'multiple-choice' as const, prompt: `Java OOP question ${n}: what is object behavior?`,
          options: ['State and behavior', 'Only comments', 'Only files', 'Only packages'], correctIndex: 0,
          explanation: 'Objects combine state with behavior.', xpReward: 10,
        })), xpAwarded: 0, isCompleted: false, crownCount: 0,
      }],
    }],
  };

  const firstQuiz = await generateOnTheFlyQuiz('Java OOP', course, profile, { forceOffline: true });
  rememberGeneratedLearning(profile, 'quiz', 'Java OOP', firstQuiz.map((question) => question.prompt));
  const secondQuiz = await generateOnTheFlyQuiz('Java OOP', course, profile, { forceOffline: true });

  assert.equal(firstQuiz.length, 3);
  assert.equal(secondQuiz.length, 1);
  assert.equal(firstQuiz.some((first) => secondQuiz.some((second) => second.prompt === first.prompt)), false);

  const cards = await generateOnTheFlyFlashcards('Java OOP', course, profile, { forceOffline: true });
  assert.equal(cards.length, 0, 'A course without flashcards should not invent unrelated cards offline.');
});
