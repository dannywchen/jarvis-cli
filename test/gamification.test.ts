import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateLevel,
  getXpForLevel,
  getXpForNextLevel,
  getLevelProgress,
  awardXp,
  LEVEL_THRESHOLDS,
} from '../src/core/gamification.js';
import { sanitizeLoadedProfile } from '../src/core/storage.js';
import { evaluateQueryRelevance } from '../src/core/agentWrapper.js';
import { UserProfile } from '../src/types/index.js';

test('Level 1 and 0 XP baseline initialization and clean migration', () => {
  // Test clean profile starts at Level 1 and 0 XP
  const freshProfile = sanitizeLoadedProfile({});
  assert.equal(freshProfile.level, 1, 'Default profile level must be 1');
  assert.equal(freshProfile.xp, 0, 'Default profile XP must be 0');

  // Test migration: loaded profile with artificial XP but 0 completed authentic lessons is reset to Level 1 / 0 XP
  const legacyArtificialProfile = sanitizeLoadedProfile({
    name: 'Learner',
    xp: 250,
    level: 3,
    completedLessonsCount: 0,
    masteredSkillsCount: 0,
  });
  assert.equal(legacyArtificialProfile.xp, 0, 'Artificial XP with 0 completed lessons must be reset to 0');
  assert.equal(legacyArtificialProfile.level, 1, 'Artificial level with 0 completed lessons must be reset to 1');

  // Test profile with authentic completed lessons preserves valid XP and recalculates level
  const authenticProfile = sanitizeLoadedProfile({
    name: 'Ada',
    xp: 300,
    level: 1,
    completedLessonsCount: 4,
    masteredSkillsCount: 1,
  });
  assert.equal(authenticProfile.xp, 300, 'Authentic XP must be preserved');
  assert.equal(authenticProfile.level, 3, 'Level must be recalculated based on authentic XP curve (300 XP -> Level 3)');

  // Test malformed / negative XP resets cleanly
  const malformedProfile = sanitizeLoadedProfile({
    xp: -50,
    level: 99,
  });
  assert.equal(malformedProfile.xp, 0);
  assert.equal(malformedProfile.level, 1);
});

test('realistic level progression curve', () => {
  // Level 1: 0 - 100 XP
  assert.equal(calculateLevel(0), 1);
  assert.equal(calculateLevel(25), 1);
  assert.equal(calculateLevel(99), 1);

  // Level 2: 100 - 250 XP
  assert.equal(calculateLevel(100), 2);
  assert.equal(calculateLevel(160), 2);
  assert.equal(calculateLevel(249), 2);

  // Level 3: 250 - 500 XP
  assert.equal(calculateLevel(250), 3);
  assert.equal(calculateLevel(350), 3);
  assert.equal(calculateLevel(499), 3);

  // Level 4: 500 - 850 XP
  assert.equal(calculateLevel(500), 4);
  assert.equal(calculateLevel(650), 4);
  assert.equal(calculateLevel(849), 4);

  // Level 5: 850 - 1300 XP
  assert.equal(calculateLevel(850), 5);
  assert.equal(calculateLevel(1000), 5);
  assert.equal(calculateLevel(1299), 5);

  // Level 6+
  assert.equal(calculateLevel(1300), 6);
  assert.equal(calculateLevel(1850), 7);

  // Level thresholds helper
  assert.equal(getXpForLevel(1), 0);
  assert.equal(getXpForLevel(2), 100);
  assert.equal(getXpForLevel(3), 250);
  assert.equal(getXpForLevel(4), 500);
  assert.equal(getXpForLevel(5), 850);
  assert.equal(getXpForLevel(6), 1300);
  assert.equal(getXpForNextLevel(1), 100);
  assert.equal(getXpForNextLevel(2), 250);

  // Level progress percentages
  const prog0 = getLevelProgress(0);
  assert.equal(prog0.currentLevel, 1);
  assert.equal(prog0.nextLevel, 2);
  assert.equal(prog0.progressPercent, 0);

  const prog50 = getLevelProgress(50);
  assert.equal(prog50.currentLevel, 1);
  assert.equal(prog50.progressPercent, 50);

  const prog100 = getLevelProgress(100);
  assert.equal(prog100.currentLevel, 2);
  assert.equal(prog100.targetXp, 250);
  assert.equal(prog100.progressPercent, 0);

  const prog175 = getLevelProgress(175);
  assert.equal(prog175.currentLevel, 2);
  assert.equal(prog175.progressPercent, 50);
});

test('awardXp advances level and detects level up accurately', () => {
  const profile: UserProfile = {
    name: 'Learner',
    xp: 0,
    level: 1,
    hearts: 5,
    maxHearts: 5,
    streak: 1,
    lastActiveDate: '2026-09-06',
    zenMode: false,
    completedLessonsCount: 0,
    masteredSkillsCount: 0,
    achievements: [],
  };

  const step1 = awardXp(profile, 50);
  assert.equal(step1.didLevelUp, false);
  assert.equal(profile.level, 1);
  assert.equal(profile.xp, 50);

  const step2 = awardXp(profile, 50);
  assert.equal(step2.didLevelUp, true);
  assert.equal(step2.oldLevel, 1);
  assert.equal(step2.newLevel, 2);
  assert.equal(profile.level, 2);
  assert.equal(profile.xp, 100);

  const step3 = awardXp(profile, 150);
  assert.equal(step3.didLevelUp, true);
  assert.equal(profile.level, 3);
  assert.equal(profile.xp, 250);
});

test('agentic relevance evaluation: casual banter, greetings, gibberish award 0 XP', () => {
  const banterQueries = [
    'helo',
    'hey',
    'asdf',
    'asdfghjkl',
    'lol',
    'what model are you',
    'who are you',
    'hi',
    'yo',
    'good morning',
    'thanks',
    'lmao',
    'cool',
    'ok',
    'bye',
    'what can you do',
  ];

  for (const query of banterQueries) {
    const result = evaluateQueryRelevance(query);
    assert.equal(
      result.xpAwarded,
      0,
      `Query "${query}" should award 0 XP but awarded ${result.xpAwarded}`
    );
    assert.equal(result.category, 'banter');
    assert.equal(result.relevanceReason, undefined);
  }
});

test('agentic relevance evaluation: basic technical questions award 5 XP', () => {
  const basicQueries = [
    'what is a variable in python',
    'how to write an if statement',
    'what does const do in javascript',
    'what is an array',
    'explain syntax for for loop',
    'how to print in python',
  ];

  for (const query of basicQueries) {
    const result = evaluateQueryRelevance(query);
    assert.equal(
      result.xpAwarded,
      5,
      `Basic query "${query}" should award 5 XP but awarded ${result.xpAwarded}`
    );
    assert.equal(result.category, 'basic');
    assert.ok(result.relevanceReason, 'Basic query should have a relevanceReason');
  }
});

test('agentic relevance evaluation: in-depth technical inquiry awards 10 to 25 XP with reason', () => {
  const q1 = 'how does quantum superposition collapse during measurement';
  const r1 = evaluateQueryRelevance(q1);
  assert.ok(r1.xpAwarded >= 10 && r1.xpAwarded <= 25, `Expected 10-25 XP, got ${r1.xpAwarded}`);
  assert.equal(r1.category, 'in-depth');
  assert.ok(
    r1.relevanceReason?.includes('quantum superposition'),
    `Expected reason to reference quantum superposition, got "${r1.relevanceReason}"`
  );

  const q2 = 'compare interface vs abstract class in terms of memory layout and vtable';
  const r2 = evaluateQueryRelevance(q2);
  assert.ok(r2.xpAwarded >= 15 && r2.xpAwarded <= 25, `Expected 15-25 XP, got ${r2.xpAwarded}`);
  assert.equal(r2.category, 'in-depth');
  assert.ok(
    r2.relevanceReason?.includes('interface vs abstract class') || r2.relevanceReason?.includes('inquiry'),
    `Expected reason to reference concept, got "${r2.relevanceReason}"`
  );

  const q3 = 'How does the Raft consensus algorithm handle network partitions and split brain?';
  const r3 = evaluateQueryRelevance(q3);
  assert.ok(r3.xpAwarded >= 15 && r3.xpAwarded <= 25, `Expected 15-25 XP, got ${r3.xpAwarded}`);
  assert.equal(r3.category, 'in-depth');
  assert.ok(
    r3.relevanceReason?.includes('raft') || r3.relevanceReason?.includes('inquiry'),
    `Expected reason to reference raft or inquiry, got "${r3.relevanceReason}"`
  );

  const q4 = 'How does Rust borrow checker prevent data races at compile time without a garbage collector?';
  const r4 = evaluateQueryRelevance(q4);
  assert.ok(r4.xpAwarded >= 15 && r4.xpAwarded <= 25, `Expected 15-25 XP, got ${r4.xpAwarded}`);
  assert.equal(r4.category, 'in-depth');
});
