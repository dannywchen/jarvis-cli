import { AgentToolCall, AgentToolName } from './agentTools.js';
import { decomposeTopicIntoConcepts } from './topicEngine.js';
import { activateCourse, getCourseProgress, getNextCourseLesson, normalizeLearningIntent, selectCourse } from './learningEngine.js';
import {
  deleteAllCourses,
  deleteCourse,
  listSavedCourses,
  loadCourse,
  saveCourse,
  saveUserProfile,
} from './storage.js';
import { Course, LearningIntent, SkillNode, UserProfile } from '../types/index.js';

export const COURSE_AGENT_TOOLS: AgentToolName[] = [
  'list_courses',
  'create_course',
  'switch_course',
  'delete_course',
  'delete_all_courses',
  'add_course_content',
];

const COURSE_MUTATING_TOOLS = new Set<AgentToolName>([
  'create_course',
  'switch_course',
  'delete_course',
  'delete_all_courses',
  'add_course_content',
]);

export function isCourseAgentTool(tool: string): tool is AgentToolName {
  return COURSE_AGENT_TOOLS.includes(tool as AgentToolName);
}

export function isCourseMutatingTool(tool: string): boolean {
  return COURSE_MUTATING_TOOLS.has(tool as AgentToolName);
}

function stringInput(input: Record<string, unknown>, key: string): string {
  return typeof input[key] === 'string' ? String(input[key]).trim() : '';
}

function intentFromInput(input: Record<string, unknown>, fallbackTopic: string): LearningIntent {
  const level = stringInput(input, 'level');
  return normalizeLearningIntent({
    goal: stringInput(input, 'goal') || undefined,
    targetOutcome: stringInput(input, 'targetOutcome') || undefined,
    level: level === 'beginner' || level === 'advanced' ? level : 'intermediate',
    preferredMode: stringInput(input, 'preferredMode') as LearningIntent['preferredMode'] || undefined,
  }, fallbackTopic);
}

function courseSummary(course: Course, activeCourseId?: string): Record<string, unknown> {
  return {
    id: course.id,
    title: course.title,
    active: course.id === activeCourseId,
    progress: getCourseProgress(course),
    nextLesson: getNextCourseLesson(course)?.lesson.title || null,
  };
}

async function listCourses(profile: UserProfile): Promise<string> {
  const courses = await listSavedCourses();
  return JSON.stringify({
    activeCourseId: profile.activeCourseId || null,
    courses: courses.map((course) => courseSummary(course, profile.activeCourseId)),
  });
}

async function createCourse(profile: UserProfile, input: Record<string, unknown>): Promise<string> {
  const topic = stringInput(input, 'topic');
  if (!topic) throw new Error('create_course requires a topic.');
  const result = await decomposeTopicIntoConcepts(topic, profile, { intent: intentFromInput(input, topic) });
  activateCourse(profile, result.course);
  await saveCourse(result.course);
  await saveUserProfile(profile);
  return JSON.stringify({
    success: true,
    action: 'created_and_activated',
    course: courseSummary(result.course, profile.activeCourseId),
    nodeCount: result.course.nodes.length,
  });
}

async function switchCourse(profile: UserProfile, input: Record<string, unknown>): Promise<string> {
  const selector = stringInput(input, 'selector');
  if (!selector) throw new Error('switch_course requires a course number, id, or title.');
  const courses = await listSavedCourses();
  const selected = selectCourse(courses, selector);
  if (!selected) throw new Error(`Course "${selector}" was not found.`);
  activateCourse(profile, selected);
  await saveCourse(selected);
  await saveUserProfile(profile);
  return JSON.stringify({ success: true, action: 'switched', course: courseSummary(selected, profile.activeCourseId) });
}

async function removeCourse(profile: UserProfile, input: Record<string, unknown>): Promise<string> {
  const selector = stringInput(input, 'selector');
  if (!selector) throw new Error('delete_course requires a course number, id, or title.');
  const courses = await listSavedCourses();
  const selected = selectCourse(courses, selector);
  if (!selected) throw new Error(`Course "${selector}" was not found.`);
  await deleteCourse(selected.id);

  const remaining = await listSavedCourses();
  if (profile.activeCourseId === selected.id) {
    profile.activeCourseId = undefined;
    const next = remaining[0];
    if (next) {
      activateCourse(profile, next);
      await saveCourse(next);
    }
  }
  await saveUserProfile(profile);
  return JSON.stringify({
    success: true,
    action: 'deleted',
    deletedCourseId: selected.id,
    deletedTitle: selected.title,
    activeCourseId: profile.activeCourseId || null,
    remaining: remaining.map((course) => courseSummary(course, profile.activeCourseId)),
  });
}

async function removeAllCourses(profile: UserProfile): Promise<string> {
  const courses = await listSavedCourses();
  const removedCount = await deleteAllCourses();
  profile.activeCourseId = undefined;
  await saveUserProfile(profile);
  return JSON.stringify({
    success: true,
    action: 'deleted_all',
    removedCount: Math.max(removedCount, courses.length),
    activeCourseId: null,
  });
}

function rekeyNode(node: SkillNode, courseId: string, index: number): SkillNode {
  const nodeId = `${courseId}_added_node_${Date.now()}_${index}_${node.id}`;
  return {
    ...node,
    id: nodeId,
    status: 'locked',
    order: index + 1,
    lessons: node.lessons.map((lesson, lessonIndex) => ({
      ...lesson,
      id: `${nodeId}_lesson_${lessonIndex + 1}`,
      isCompleted: false,
      crownCount: 0,
      completedQuestionIds: [],
      attemptCount: 0,
      masteryScore: 0,
    })),
  };
}

async function addCourseContent(profile: UserProfile, input: Record<string, unknown>): Promise<string> {
  const topic = stringInput(input, 'topic');
  if (!topic) throw new Error('add_course_content requires the topic or module to add.');
  const courses = await listSavedCourses();
  const target = stringInput(input, 'selector')
    ? selectCourse(courses, stringInput(input, 'selector'))
    : await loadCourse(profile.activeCourseId || '');
  if (!target) throw new Error('No target course is active. Create or switch to a course first.');

  const result = await decomposeTopicIntoConcepts(topic, profile, { intent: intentFromInput(input, topic) });
  const additions = result.course.nodes.map((node, index) => rekeyNode(node, target.id, index));
  const existingNext = getNextCourseLesson(target);
  target.nodes = [...target.nodes, ...additions];
  if (!existingNext && additions[0]) {
    additions[0].status = 'active';
    target.currentNodeId = additions[0].id;
  }
  await saveCourse(target);
  if (profile.activeCourseId === target.id) await saveUserProfile(profile);
  return JSON.stringify({
    success: true,
    action: 'content_added',
    course: courseSummary(target, profile.activeCourseId),
    addedTopic: topic,
    addedNodeCount: additions.length,
  });
}

export async function executeCourseAgentTool(call: AgentToolCall, profile: UserProfile): Promise<string> {
  const input = call.input || {};
  switch (call.tool) {
    case 'list_courses': return listCourses(profile);
    case 'create_course': return createCourse(profile, input);
    case 'switch_course': return switchCourse(profile, input);
    case 'delete_course': return removeCourse(profile, input);
    case 'delete_all_courses': return removeAllCourses(profile);
    case 'add_course_content': return addCourseContent(profile, input);
    default: throw new Error(`Unknown course tool: ${String(call.tool)}`);
  }
}

export interface DirectCourseCommandResult {
  text: string;
  changed: boolean;
}

/** Handles unambiguous course commands even when no LLM credentials are configured. */
export async function executeDirectCourseCommand(query: string, profile: UserProfile): Promise<DirectCourseCommandResult | null> {
  const clean = query.trim().replace(/[\n\r]+/g, ' ');
  if (!clean) return null;

  if (/\b(?:remove|delete|clear|wipe)\s+(?:all|every)\s+(?:of\s+)?(?:the\s+)?(?:my\s+)?(?:saved\s+)?courses?\b/i.test(clean)) {
    const result = JSON.parse(await removeAllCourses(profile)) as { removedCount: number };
    return { changed: true, text: `All saved courses have been removed (${result.removedCount} course${result.removedCount === 1 ? '' : 's'}). No active course remains.` };
  }

  const removeMatch = clean.match(/^(?:can you|could you|please|i want you to|go ahead and)?\s*(?:remove|delete)\s+(?:my\s+)?(?:course\s+)?["']?(.+?)["']?[.!?]?$/i);
  const selector = removeMatch?.[1]?.trim() || '';
  if (removeMatch && !/^(?:all\s+courses?|a\s+course|the\s+course|one\s+course)$/i.test(selector)) {
    const result = JSON.parse(await removeCourse(profile, { selector })) as { deletedTitle: string; activeCourseId: string | null };
    return { changed: true, text: `Removed course "${result.deletedTitle}".${result.activeCourseId ? ' The next saved course is now active.' : ' No active course remains.'}` };
  }

  const learnMatch = clean.match(/^(?:i\s+(?:want\s+to|wanna|would\s+like\s+to)\s+learn|teach\s+me|help\s+me\s+learn|create\s+(?:a\s+)?course\s+(?:for|on)|build\s+(?:a\s+)?(?:course|roadmap)\s+(?:for|on)|(?:study|master))\s+(.+?)[.!?]?$/i);
  if (learnMatch) {
    const topic = learnMatch[1].trim();
    const result = JSON.parse(await createCourse(profile, { topic })) as { course: { title: string; progress: { totalNodes: number } } };
    return { changed: true, text: `Prepared the full "${result.course.title}" course with ${result.course.progress.totalNodes} modules and switched to it as the active course. Your next lesson is loaded.` };
  }

  return null;
}
