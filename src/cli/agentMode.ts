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
import { Pace } from '../types/index.js';

export async function handleAgentStatus(): Promise<void> {
  const profile = await loadUserProfile();
  updateStreak(profile);
  await saveUserProfile(profile);

  let activeCourse = null;
  if (profile.activeCourseId) {
    activeCourse = await loadCourse(profile.activeCourseId);
  }

  const dueReviews = await getDueReviews();

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
        }
      : null,
    dueReviewsCount: dueReviews.length,
  };

  console.log(JSON.stringify(status, null, 2));
}

export async function handleAgentIngest(filePath: string, pace: Pace = 'standard'): Promise<void> {
  const doc = await parseDocument(filePath);
  const profile = await loadUserProfile();

  const course = await generateCourse(doc, pace, {
    provider: profile.apiProvider,
    apiKey: profile.apiKey,
  });

  await saveCourse(course);
  profile.activeCourseId = course.id;
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

  const question = lesson?.questions.find((q) => q.id === options.questionId);
  if (!question) {
    console.log(JSON.stringify({ error: 'Question not found' }));
    return;
  }

  const evalResult = await evaluateAnswerWithAi(question, options.answer, {
    provider: profile.apiProvider,
    apiKey: profile.apiKey,
  });

  let xpEarned = 0;
  if (evalResult.isCorrect) {
    xpEarned = Math.round((question.xpReward * evalResult.scorePercentage) / 100);
    awardXp(profile, xpEarned);
  } else {
    if (!profile.zenMode) {
      profile.hearts = Math.max(0, profile.hearts - 1);
    }
  }

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
        unlockedAchievements: achievements,
      },
      null,
      2
    )
  );
}

export async function handleAgentDecompose(topic: string): Promise<void> {
  const profile = await loadUserProfile();
  const result = await decomposeTopicIntoConcepts(topic, profile);
  await saveCourse(result.course);
  profile.activeCourseId = result.course.id;
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
