import { parseDocument } from '../core/parser.js';
import { generateCourse } from '../core/generator.js';
import { decomposeTopicIntoConcepts } from '../core/topicEngine.js';
import {
  loadUserProfile,
  saveUserProfile,
  loadCourse,
  saveCourse,
  listSavedCourses,
  loadReviewItems,
} from '../core/storage.js';
import { awardXp, checkNewAchievements, updateStreak } from '../core/gamification.js';
import { evaluateAnswerWithAi } from '../core/ai.js';
import { getDueReviews } from '../core/spacedRepetition.js';
import { registerReviewItem } from '../core/spacedRepetition.js';
import { LearningIntent, Pace } from '../types/index.js';
import { activateCourse, buildLearningContext, getCourseProgress, normalizeLearningIntent, selectCourse } from '../core/learningEngine.js';

export async function handleAgentStatus(): Promise<void> {
  const profile = await loadUserProfile();
  updateStreak(profile);
  await saveUserProfile(profile);

  let activeCourse = null;
  if (profile.activeCourseId) {
    activeCourse = await loadCourse(profile.activeCourseId);
  }

  const dueReviews = await getDueReviews();
  const progress = activeCourse ? getCourseProgress(activeCourse, dueReviews.length) : null;

  const status = {
    profile: {
      name: profile.name,
      xp: profile.xp,
      level: profile.level,
      hearts: profile.hearts,
      maxHearts: profile.maxHearts,
      streak: profile.streak,
      zenMode: profile.zenMode,
      completedLessonsCount: profile.completedLessonsCount,
      masteredSkillsCount: profile.masteredSkillsCount,
      achievements: profile.achievements,
    },
    activeCourse: activeCourse
      ? {
          id: activeCourse.id,
          title: activeCourse.title,
          pace: activeCourse.pace,
          totalNodes: activeCourse.nodes.length,
          completedNodes: activeCourse.nodes.filter((n) => n.status === 'completed' || n.status === 'mastered').length,
          currentNode: activeCourse.nodes.find((n) => n.status === 'active') || null,
          intent: activeCourse.intent,
          progress,
        }
      : null,
    dueReviewsCount: dueReviews.length,
    learningContext: buildLearningContext(activeCourse, dueReviews.length),
  };

  console.log(JSON.stringify(status, null, 2));
}

export async function handleAgentIngest(filePath: string, pace: Pace = 'standard', intent?: LearningIntent): Promise<void> {
  const doc = await parseDocument(filePath);
  const profile = await loadUserProfile();

  const course = await generateCourse(doc, pace, {
    provider: profile.apiProvider,
    apiKey: profile.apiKey,
    intent: normalizeLearningIntent(intent, doc.title),
  });

  activateCourse(profile, course);
  await saveCourse(course);
  await saveUserProfile(profile);

  const result = {
    success: true,
    courseId: course.id,
    title: course.title,
    pace: course.pace,
    nodeCount: course.nodes.length,
    summary: course.summary,
    firstNode: course.nodes[0],
  };

  console.log(JSON.stringify(result, null, 2));
}

export async function handleAgentLesson(nodeId?: string): Promise<void> {
  const profile = await loadUserProfile();
  if (!profile.activeCourseId) {
    console.log(JSON.stringify({ error: 'No active course' }));
    return;
  }

  const course = await loadCourse(profile.activeCourseId);
  if (!course) {
    console.log(JSON.stringify({ error: 'Course not found' }));
    return;
  }

  const targetNode = nodeId
    ? course.nodes.find((n) => n.id === nodeId)
    : course.nodes.find((n) => n.status === 'active') || course.nodes[0];

  if (!targetNode) {
    console.log(JSON.stringify({ error: 'Node not found' }));
    return;
  }

  const lesson = targetNode.lessons.find((l) => !l.isCompleted) || targetNode.lessons[0];

  console.log(
    JSON.stringify(
      {
        courseId: course.id,
        courseTitle: course.title,
        intent: course.intent,
        progress: getCourseProgress(course),
        node: {
          id: targetNode.id,
          title: targetNode.title,
          order: targetNode.order,
          status: targetNode.status,
          isBossCheckpoint: targetNode.isBossCheckpoint,
        },
        lesson: {
          id: lesson.id,
          title: lesson.title,
          conceptDigest: lesson.conceptDigest,
          keyTakeaway: lesson.keyTakeaway,
          analogies: lesson.analogies,
          questions: lesson.questions.map((q) => ({
            id: q.id,
            type: q.type,
            prompt: q.prompt,
            options: q.options,
            hint: q.hint,
            xpReward: q.xpReward,
          })),
        },
      },
      null,
      2
    )
  );
}

export async function handleAgentSubmitAnswer(options: {
  nodeId?: string;
  lessonId?: string;
  questionId: string;
  answer: string;
}): Promise<void> {
  const profile = await loadUserProfile();
  if (!profile.activeCourseId) {
    console.log(JSON.stringify({ error: 'No active course' }));
    return;
  }

  const course = await loadCourse(profile.activeCourseId);
  if (!course) {
    console.log(JSON.stringify({ error: 'Course not found' }));
    return;
  }

  const node = options.nodeId
    ? course.nodes.find((n) => n.id === options.nodeId)
    : course.nodes.find((n) => n.status === 'active') || course.nodes[0];

  if (!node) {
    console.log(JSON.stringify({ error: 'Node not found' }));
    return;
  }

  const lesson = options.lessonId
    ? node.lessons.find((l) => l.id === options.lessonId)
    : node.lessons.find((l) => !l.isCompleted) || node.lessons[0];

  if (!lesson) {
    console.log(JSON.stringify({ error: 'Lesson not found' }));
    return;
  }

  const question = lesson?.questions.find((q) => q.id === options.questionId);
  if (!question) {
    console.log(JSON.stringify({ error: 'Question not found' }));
    return;
  }

  const evalResult = await evaluateAnswerWithAi(question, options.answer, {
    provider: profile.apiProvider,
    apiKey: profile.apiKey,
    model: profile.activeModel,
  });

  let xpEarned = 0;
  const now = new Date().toISOString();
  lesson.attemptCount = (lesson.attemptCount || 0) + 1;
  lesson.lastAttemptAt = now;
  if (evalResult.isCorrect) {
    xpEarned = Math.round((question.xpReward * evalResult.scorePercentage) / 100);
    awardXp(profile, xpEarned);
    const completedQuestionIds = new Set(lesson.completedQuestionIds || []);
    completedQuestionIds.add(question.id);
    lesson.completedQuestionIds = [...completedQuestionIds];
  } else {
    if (!profile.zenMode) {
      profile.hearts = Math.max(0, profile.hearts - 1);
    }
    await registerReviewItem({
      id: `review_${course.id}_${question.id}`,
      nodeId: node.id,
      courseId: course.id,
      questionId: question.id,
      conceptTitle: node.title,
    });
  }

  lesson.masteryScore = Math.round(((lesson.completedQuestionIds || []).length / Math.max(1, lesson.questions.length)) * 100);
  if (lesson.completedQuestionIds?.length === lesson.questions.length && !lesson.isCompleted) {
    lesson.isCompleted = true;
    lesson.crownCount += 1;
    profile.completedLessonsCount += 1;
    node.status = 'completed';
    const currentIndex = course.nodes.findIndex((item) => item.id === node.id);
    const nextNode = currentIndex >= 0 ? course.nodes[currentIndex + 1] : undefined;
    if (nextNode) {
      nextNode.status = nextNode.status === 'locked' ? 'active' : nextNode.status;
      course.currentNodeId = nextNode.id;
    }
  }
  course.lastStudiedAt = now;

  const achievements = checkNewAchievements(profile);
  await saveCourse(course);
  await saveUserProfile(profile);

  console.log(
    JSON.stringify(
      {
        questionId: question.id,
        isCorrect: evalResult.isCorrect,
        scorePercentage: evalResult.scorePercentage,
        xpEarned,
        totalXp: profile.xp,
        level: profile.level,
        heartsRemaining: profile.hearts,
        feedback: evalResult.feedback,
        suggestedImprovement: evalResult.suggestedImprovement,
        lessonProgress: {
          completed: lesson.isCompleted,
          masteryScore: lesson.masteryScore,
          completedQuestionCount: lesson.completedQuestionIds?.length || 0,
          totalQuestionCount: lesson.questions.length,
        },
        unlockedAchievements: achievements,
      },
      null,
      2
    )
  );
}

export async function handleAgentDecompose(topic: string, intent?: LearningIntent): Promise<void> {
  const profile = await loadUserProfile();
  const result = await decomposeTopicIntoConcepts(topic, profile, { intent: normalizeLearningIntent(intent, topic) });
  activateCourse(profile, result.course);
  await saveCourse(result.course);
  await saveUserProfile(profile);

  console.log(
    JSON.stringify(
      {
        success: true,
        topic: result.topic,
        overview: result.overview,
        courseId: result.course.id,
        conceptCount: result.concepts.length,
        concepts: result.concepts.map((c) => ({
          id: c.id,
          order: c.order,
          title: c.title,
          digest: c.digest,
          analogy: c.analogy,
          keyTakeaway: c.keyTakeaway,
          flashcards: c.flashcards,
          questions: c.questions.map((q) => ({
            id: q.id,
            type: q.type,
            prompt: q.prompt,
            options: q.options,
            hint: q.hint,
            xpReward: q.xpReward,
            minSentences: q.minSentences,
          })),
        })),
      },
      null,
      2
    )
  );
}

/** Machine-readable course library and active-course switcher. */
export async function handleAgentCourses(selector?: string): Promise<void> {
  const profile = await loadUserProfile();
  const courses = await listSavedCourses();
  if (!courses.length) {
    console.log(JSON.stringify({ courses: [], activeCourseId: null, message: 'No saved courses.' }, null, 2));
    return;
  }

  if (selector) {
    const selected = selectCourse(courses, selector);
    if (!selected) {
      console.log(JSON.stringify({ error: 'Course not found', selector, availableCourseIds: courses.map((course) => course.id) }, null, 2));
      return;
    }
    activateCourse(profile, selected);
    await saveCourse(selected);
    await saveUserProfile(profile);
  }

  console.log(JSON.stringify({
    activeCourseId: profile.activeCourseId || null,
    courses: courses.map((course, index) => ({
      index: index + 1,
      id: course.id,
      title: course.title,
      pace: course.pace,
      intent: course.intent,
      progress: getCourseProgress(course),
      active: course.id === profile.activeCourseId,
    })),
  }, null, 2));
}
