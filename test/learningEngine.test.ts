import test from 'node:test';
import assert from 'node:assert/strict';
import { activateCourse, buildLearningContext, getCourseProgress, normalizeLearningIntent, selectCourse } from '../src/core/learningEngine.js';
import { Course, UserProfile } from '../src/types/index.js';

function course(id: string, title: string, completed = false): Course {
  return {
    id,
    title,
    sourceFileName: `Topic: ${title}`,
    pace: 'standard',
    createdAt: new Date().toISOString(),
    summary: `Learn ${title}`,
    nodes: [
      {
        id: `${id}_node_1`, unitId: 'unit_1', unitTitle: 'Foundations', title: 'Foundations', description: 'Start here', order: 1,
        status: completed ? 'completed' : 'active',
        lessons: [{ id: `${id}_lesson_1`, title: 'First lesson', conceptDigest: 'Digest', keyTakeaway: 'Rule', questions: [], xpAwarded: 0, isCompleted: completed, crownCount: completed ? 1 : 0 }],
      },
    ],
  };
}

test('course progress selects the next lesson and estimates remaining time', () => {
  const progress = getCourseProgress(course('a', 'Alpha'));
  assert.equal(progress.progressPercentage, 0);
  assert.equal(progress.nextAction, 'lesson');
  assert.equal(progress.currentLessonId, 'a_lesson_1');
  assert.equal(progress.estimatedMinutesRemaining, 12);
});

test('course selector supports number, id prefix, and title', () => {
  const courses = [course('a', 'Alpha'), course('b', 'Beta')];
  assert.equal(selectCourse(courses, '2')?.id, 'b');
  assert.equal(selectCourse(courses, 'a')?.title, 'Alpha');
  assert.equal(selectCourse(courses, 'beta')?.id, 'b');
});

test('activating a course updates the profile and resumable cursor', () => {
  const profile: UserProfile = {
    name: 'Learner', xp: 0, level: 1, hearts: 5, maxHearts: 5, streak: 1, lastActiveDate: '', zenMode: false,
    completedLessonsCount: 0, masteredSkillsCount: 0, achievements: [],
  };
  const selected = course('b', 'Beta');
  activateCourse(profile, selected);
  assert.equal(profile.activeCourseId, 'b');
  assert.equal(selected.currentNodeId, 'b_node_1');
  assert.ok(selected.lastStudiedAt);
});

test('learning context gives the agent a clear mastery contract', () => {
  const selected = course('a', 'Alpha');
  selected.intent = normalizeLearningIntent({ goal: 'ship a small project', level: 'beginner' }, selected.title);
  const context = buildLearningContext(selected, 2);
  assert.match(context, /LEARNER GOAL: ship a small project/);
  assert.match(context, /DUE REVIEWS: 2/);
  assert.match(context, /Interpret the learner request by intent/);
});
