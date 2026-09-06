import assert from 'node:assert';
import { loadUserProfile, saveUserProfile, loadCourse, saveCourse } from '../src/core/storage.js';
import { awardXp, checkNewAchievements } from '../src/core/gamification.js';

async function testLessonSimulation() {
  console.log('▶ Testing Lesson Completion Simulation...');
  const profile = await loadUserProfile();
  assert(profile.activeCourseId, 'Must have active course');

  const course = await loadCourse(profile.activeCourseId!);
  assert(course, 'Course must exist');

  const node1 = course.nodes[0];
  const lesson1 = node1.lessons[0];

  assert.strictEqual(node1.status, 'active');
  assert.strictEqual(lesson1.isCompleted, false);

  // Complete lesson with perfect score
  const xpEarned = 70; // 3 questions + flawless bonus
  const xpResult = awardXp(profile, xpEarned);
  profile.completedLessonsCount += 1;
  lesson1.isCompleted = true;
  lesson1.crownCount = 1;

  // Next node unlocks
  course.nodes[0].status = 'completed';
  course.nodes[1].status = 'active';

  const newBadges = checkNewAchievements(profile, { isFlawless: true });
  await saveCourse(course);
  await saveUserProfile(profile);

  console.log(`  ✓ Simulated lesson 1 complete: +${xpEarned} XP awarded`);
  console.log(`  ✓ Node 1 status: ${course.nodes[0].status}, Node 2 status: ${course.nodes[1].status}`);
  console.log(`  ✓ Badges unlocked: ${newBadges.map((b) => b.name).join(', ')}`);

  // Verify reload from disk
  const reloadedCourse = await loadCourse(course.id);
  assert.strictEqual(reloadedCourse?.nodes[1].status, 'active');
  assert.strictEqual(reloadedCourse?.nodes[0].lessons[0].isCompleted, true);

  const reloadedProfile = await loadUserProfile();
  assert(reloadedProfile.xp >= 70);
  assert(reloadedProfile.completedLessonsCount >= 1);
  console.log('  ✓ Persistence verified!\n');
}

testLessonSimulation().catch((err) => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
