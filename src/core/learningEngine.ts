import { Course, CourseProgress, LearningIntent, Lesson, SkillNode, UserProfile } from '../types/index.js';

const DEFAULT_MINUTES_PER_LESSON = 12;

export function getCourseProgress(course: Course, dueReviewCount = 0): CourseProgress {
  const allLessons = course.nodes.flatMap((node) => node.lessons);
  const completedNodes = course.nodes.filter((node) => node.status === 'completed' || node.status === 'mastered').length;
  const completedLessons = allLessons.filter((lesson) => lesson.isCompleted).length;
  const totalLessons = allLessons.length;
  const activeNode = course.nodes.find((node) => node.status === 'active') || course.nodes.find((node) => node.lessons.some((lesson) => !lesson.isCompleted));
  const currentLesson = activeNode?.lessons.find((lesson) => !lesson.isCompleted) || activeNode?.lessons[0];
  const nextAction = completedLessons >= totalLessons && totalLessons > 0
    ? 'complete'
    : dueReviewCount > 0
      ? 'review'
      : 'lesson';

  return {
    completedNodes,
    totalNodes: course.nodes.length,
    completedLessons,
    totalLessons,
    progressPercentage: totalLessons ? Math.round((completedLessons / totalLessons) * 100) : 0,
    currentNodeId: activeNode?.id,
    currentLessonId: currentLesson?.id,
    nextAction,
    dueReviewCount,
    estimatedMinutesRemaining: Math.max(0, (totalLessons - completedLessons) * DEFAULT_MINUTES_PER_LESSON),
  };
}

export function getNextCourseLesson(course: Course): { node: SkillNode; lesson: Lesson } | null {
  const node = course.nodes.find((item) => item.status === 'active' && item.lessons.some((lesson) => !lesson.isCompleted))
    || course.nodes.find((item) => item.lessons.some((lesson) => !lesson.isCompleted));
  if (!node) return null;
  const lesson = node.lessons.find((item) => !item.isCompleted) || node.lessons[0];
  return lesson ? { node, lesson } : null;
}

export function activateCourse(profile: UserProfile, course: Course): void {
  profile.activeCourseId = course.id;
  course.lastStudiedAt = new Date().toISOString();
  const next = getNextCourseLesson(course);
  if (next) course.currentNodeId = next.node.id;
}

export function selectCourse(courses: Course[], selector = ''): Course | null {
  const clean = selector.trim();
  if (!clean) return courses[0] || null;
  const numeric = Number.parseInt(clean, 10);
  if (Number.isInteger(numeric) && String(numeric) === clean) return courses[numeric - 1] || null;
  return courses.find((course) => course.id === clean || course.id.startsWith(clean) || course.title.toLowerCase() === clean.toLowerCase()) || null;
}

export function normalizeLearningIntent(intent?: Partial<LearningIntent>, fallbackTopic = 'this subject'): LearningIntent {
  const goal = intent?.goal?.trim() || `Build a working understanding of ${fallbackTopic}`;
  return {
    goal,
    targetOutcome: intent?.targetOutcome?.trim() || goal,
    level: intent?.level || 'intermediate',
    preferredMode: intent?.preferredMode || 'conceptual',
    weeklyMinutes: intent?.weeklyMinutes && intent.weeklyMinutes > 0 ? Math.round(intent.weeklyMinutes) : 90,
    constraints: intent?.constraints?.filter(Boolean),
  };
}

/**
 * Small, explicit contract for the tutor. It keeps free-form chat flexible
 * while making every response aware of the learner's current mastery path.
 */
export function buildLearningContext(course: Course | null | undefined, dueReviewCount = 0): string {
  if (!course) {
    return 'No course is active. If the learner names a subject, propose a compact roadmap and ask for the desired outcome only when it changes the plan.';
  }

  const progress = getCourseProgress(course, dueReviewCount);
  const next = getNextCourseLesson(course);
  const intent = normalizeLearningIntent(course.intent, course.title);
  const completedTitles = course.nodes
    .filter((node) => node.status === 'completed' || node.status === 'mastered')
    .slice(-4)
    .map((node) => node.title.replace(/^[⚔️\s]+/, ''));

  return [
    `ACTIVE COURSE: ${course.title}`,
    `LEARNER GOAL: ${intent.goal}`,
    `TARGET OUTCOME: ${intent.targetOutcome}`,
    `LEVEL / MODE: ${intent.level} / ${intent.preferredMode}`,
    `PROGRESS: ${progress.progressPercentage}% (${progress.completedLessons}/${progress.totalLessons} lessons; ${progress.completedNodes}/${progress.totalNodes} nodes)`,
    `NEXT LESSON: ${next ? `${next.node.title} → ${next.lesson.title}` : 'Course complete; consolidate and apply.'}`,
    `DUE REVIEWS: ${dueReviewCount}`,
    `RECENTLY MASTERED: ${completedTitles.length ? completedTitles.join(' | ') : 'None yet'}`,
    '',
    'TUTOR CONTRACT:',
    '1. Interpret the learner request by intent: teach, clarify, quiz, apply, debug, compare, plan, or review.',
    '2. Anchor the response to the active course when relevant. If the request is ambiguous, make the most useful course-aligned assumption and state it briefly.',
    '3. Prefer retrieval before re-explaining: ask for a prediction, explanation, example, or trade-off when the learner is ready.',
    '4. Correct misconceptions precisely, then give one actionable next step. Adapt difficulty to the stated level and observed mastery.',
    '5. Respect the roadmap order unless the learner explicitly asks to jump; if they jump, connect the prerequisite gap instead of blocking them.',
  ].join('\n');
}
