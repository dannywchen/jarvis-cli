import assert from 'node:assert';
import path from 'node:path';
import { parseDocument } from '../src/core/parser.js';
import { generateCourse } from '../src/core/generator.js';
import {
  calculateLevel,
  getLevelProgress,
  awardXp,
  updateStreak,
  checkNewAchievements,
} from '../src/core/gamification.js';
import { calculateNextReview } from '../src/core/spacedRepetition.js';
import { UserProfile, SpacedReviewItem } from '../src/types/index.js';

async function runTests() {
  console.log('🧪 Starting Jarvis CLI Test Suite...\n');

  // Test 1: Parser - Markdown
  console.log('▶ Test 1: Ingesting Markdown document...');
  const mdPath = path.resolve('demo/quantum-computing.md');
  const mdDoc = await parseDocument(mdPath);
  assert.strictEqual(mdDoc.fileType, 'markdown');
  assert(mdDoc.sections.length >= 3, 'Should extract at least 3 sections');
  assert(mdDoc.wordCount > 100, 'Word count should exceed 100');
  console.log(`  ✓ Markdown parsed successfully (${mdDoc.wordCount} words, ${mdDoc.sections.length} sections)`);

  // Test 2: Parser - PDF
  console.log('▶ Test 2: Ingesting PDF document...');
  const pdfPath = path.resolve('demo/quantum-computing.pdf');
  const pdfDoc = await parseDocument(pdfPath);
  assert.strictEqual(pdfDoc.fileType, 'pdf');
  assert(pdfDoc.wordCount > 20, 'PDF word count should be detected');
  console.log(`  ✓ PDF parsed successfully (${pdfDoc.wordCount} words)`);

  // Test 3: Course Generation - Accelerated vs Standard vs Deep
  console.log('▶ Test 3: Generating Curriculums at Accelerated, Standard, and Deep paces...');
  const acceleratedCourse = await generateCourse(mdDoc, 'accelerated');
  assert(acceleratedCourse.nodes.length >= 3 && acceleratedCourse.nodes.length <= 4, 'Accelerated should have 3-4 nodes');
  assert.strictEqual(acceleratedCourse.nodes[0].status, 'active');
  assert.strictEqual(acceleratedCourse.nodes[1].status, 'locked');

  const standardCourse = await generateCourse(mdDoc, 'standard');
  assert(standardCourse.nodes.length >= 5, 'Standard should have >= 5 nodes');

  const deepCourse = await generateCourse(mdDoc, 'deep');
  assert(deepCourse.nodes.length >= 8, 'Deep dive should have >= 8 nodes');
  console.log(`  ✓ Curriculums synthesized: Accelerated (${acceleratedCourse.nodes.length} nodes), Standard (${standardCourse.nodes.length} nodes), Deep (${deepCourse.nodes.length} nodes)`);

  // Test 4: Questions generation
  console.log('▶ Test 4: Validating Question Types & Structures...');
  const lesson = acceleratedCourse.nodes[0].lessons[0];
  assert(lesson.questions.length >= 2, 'Lesson must contain multiple questions');
  const types = lesson.questions.map((q) => q.type);
  assert(types.includes('multiple-choice') || types.includes('scenario'), 'Should include multiple-choice');
  assert(types.includes('cloze'), 'Should include cloze question');
  console.log(`  ✓ Questions verified: ${types.join(', ')}`);

  // Test 5: Gamification - Leveling & XP
  console.log('▶ Test 5: Gamification Engine (XP, Levels, Streaks)...');
  assert.strictEqual(calculateLevel(0), 1);
  assert.strictEqual(calculateLevel(99), 1);
  assert.strictEqual(calculateLevel(100), 2);
  assert.strictEqual(calculateLevel(160), 2);
  assert.strictEqual(calculateLevel(250), 3);
  assert.strictEqual(calculateLevel(500), 4);
  assert.strictEqual(calculateLevel(850), 5);

  const profile: UserProfile = {
    name: 'Ada Lovelace',
    xp: 0,
    level: 1,
    hearts: 5,
    maxHearts: 5,
    streak: 1,
    lastActiveDate: new Date().toISOString().split('T')[0],
    zenMode: false,
    completedLessonsCount: 0,
    masteredSkillsCount: 0,
    achievements: [],
  };

  const xpResult = awardXp(profile, 100);
  assert.strictEqual(profile.xp, 100);
  assert(profile.level >= 2, 'Level should increase with 100 XP');

  // Test achievements
  profile.completedLessonsCount = 1;
  const newBadges = checkNewAchievements(profile);
  assert(newBadges.some((b) => b.id === 'first_byte'), 'Should unlock First Byte badge');
  assert(newBadges.some((b) => b.id === 'xp_100'), 'Should unlock Centurion badge');
  console.log(`  ✓ Gamification verified: Level ${profile.level}, Badges unlocked: ${newBadges.map((b) => b.name).join(', ')}`);

  // Test 6: Spaced Repetition (SM-2)
  console.log('▶ Test 6: Spaced Repetition (SM-2 Algorithm)...');
  const initialItem: SpacedReviewItem = {
    id: 'rev_1',
    nodeId: 'node_1',
    courseId: 'course_1',
    questionId: 'q_1',
    conceptTitle: 'Qubits & Superposition',
    dueDate: '2026-09-05',
    intervalDays: 1,
    repetitionCount: 0,
    easeFactor: 2.5,
  };

  const review1 = calculateNextReview(initialItem, 5); // Perfect recall
  assert.strictEqual(review1.intervalDays, 1);
  assert.strictEqual(review1.repetitionCount, 1);

  const review2 = calculateNextReview(review1, 4); // Good recall
  assert.strictEqual(review2.intervalDays, 3);
  assert.strictEqual(review2.repetitionCount, 2);

  const review3 = calculateNextReview(review2, 5);
  assert(review3.intervalDays >= 7, 'Next interval should scale to >= 7 days');
  console.log(`  ✓ Spaced repetition verified: Intervals scaled 1d → 3d → ${review3.intervalDays}d`);

  console.log('\n✨ ALL TESTS PASSED SUCCESSFULLY! ✨\n');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
