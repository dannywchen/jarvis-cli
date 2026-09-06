import assert from 'node:assert';
import {
  decomposeTopicIntoConcepts,
  evaluateOpenEndedAnswer,
  topicDecompositionToCourse,
  saveDecomposedCourse,
} from '../src/core/topicEngine.js';
import { loadCourse, loadUserProfile } from '../src/core/storage.js';
import { UserProfile, Question } from '../src/types/index.js';

import os from 'node:os';
import path from 'node:path';

// Ensure deterministic, instant unit test execution without network dependency and isolated storage
process.env.JARVIS_TEST_OFFLINE = '1';
process.env.JARVIS_CLI_DATA_DIR = path.join(os.tmpdir(), `jarvis-test-topic-${Date.now()}`);

async function runTopicEngineTests() {
  console.log('🧪 Testing Jarvis CLI Duolingo-Style Topic Engine & Answer Grader...\n');

  const mockProfile: UserProfile = {
    name: 'Ada Lovelace',
    xp: 150,
    level: 3,
    hearts: 5,
    maxHearts: 5,
    streak: 5,
    lastActiveDate: new Date().toISOString().split('T')[0],
    zenMode: false,
    completedLessonsCount: 2,
    masteredSkillsCount: 1,
    achievements: [],
  };

  // ==========================================
  // Test 1: Decomposing "Quantum Computing"
  // ==========================================
  console.log('▶ Test 1: Decomposing "Quantum Computing" into Micro-Concepts...');
  const qcResult = await decomposeTopicIntoConcepts('Quantum Computing', mockProfile);

  assert(qcResult.decomposition, 'Should include decomposition object');
  assert(qcResult.course, 'Should include structured course object');
  assert.strictEqual(qcResult.topic, 'Quantum Computing');
  assert(qcResult.concepts.length >= 3 && qcResult.concepts.length <= 6, 'Must generate 3-6 progressive Micro-Concepts');
  console.log(`  ✓ Generated ${qcResult.concepts.length} progressive Micro-Concepts for Quantum Computing`);

  // Validate each Micro-Concept's learning materials
  qcResult.concepts.forEach((concept, idx) => {
    assert.strictEqual(concept.order, idx + 1, `Concept order must be sequential (${idx + 1})`);
    assert(concept.title.length > 3, 'Concept must have a descriptive title');

    // 1. Bite-Sized Digest: Concise 2-paragraph mental model
    assert(concept.digest.includes('\n\n'), `Concept ${idx + 1} digest must contain 2 paragraphs separated by \\n\\n`);
    const paragraphs = concept.digest.split('\n\n').filter((p) => p.trim().length > 20);
    assert.strictEqual(paragraphs.length, 2, `Concept ${idx + 1} digest must have exactly 2 concise paragraphs`);

    // 2. Intuitive real-world analogy
    assert(concept.analogy && concept.analogy.length > 15, `Concept ${idx + 1} must include an intuitive analogy`);

    // 3. Sharp takeaway rule
    assert(concept.keyTakeaway && concept.keyTakeaway.length > 15, `Concept ${idx + 1} must include a key takeaway rule`);

    // 4. Interactive Flashcards: Term / mechanism -> key explanation with flip-to-reveal
    assert(concept.flashcards && concept.flashcards.length >= 2, `Concept ${idx + 1} must include at least 2 interactive flashcards`);
    concept.flashcards.forEach((fc) => {
      assert(fc.term && fc.term.length > 1, 'Flashcard must have a term');
      assert(fc.explanation && fc.explanation.length > 5, 'Flashcard must have an explanation');
    });

    // 5. Short MCQs: 4 options with realistic distractors and deep explanations
    const mcqs = concept.questions.filter((q) => q.type === 'multiple-choice');
    assert(mcqs.length >= 1, `Concept ${idx + 1} must include at least 1 multiple-choice question`);
    mcqs.forEach((mcq) => {
      assert.strictEqual(mcq.options?.length, 4, 'MCQ must have exactly 4 options with realistic distractors');
      assert(typeof mcq.correctIndex === 'number' && mcq.correctIndex >= 0 && mcq.correctIndex <= 3, 'MCQ must have valid correctIndex (0-3)');
      assert(mcq.explanation && mcq.explanation.length > 20, 'MCQ must have an instant deep explanation');
      assert(mcq.xpReward > 0, 'MCQ must award XP');
    });

    // 6. Sentence or Multi-Sentence Required Answer Question: open-ended prompt (1-3 sentences)
    const openEnded = concept.questions.filter((q) => q.type === 'open-ended');
    assert(openEnded.length >= 1, `Concept ${idx + 1} must include at least 1 open-ended synthesis question`);
    openEnded.forEach((oe) => {
      assert(oe.prompt && oe.prompt.length > 15, 'Open-ended question must have an actionable prompt');
      assert(oe.explanation && oe.explanation.length > 20, 'Open-ended question must provide an exemplary model explanation');
      assert(oe.rubric && oe.rubric.length > 10, 'Open-ended question must provide a rubric');
      assert(oe.minSentences && oe.minSentences >= 1, 'Open-ended question must require sentence minimum');
      assert(oe.xpReward >= 20, 'Open-ended question must have realistic XP reward');
    });

    // 7. Flashcard question type presence
    const fcQuestions = concept.questions.filter((q) => q.type === 'flashcard');
    assert(fcQuestions.length >= 1, `Concept ${idx + 1} questions array must include flashcard question type for interactive study`);
    fcQuestions.forEach((fcQ) => {
      assert(fcQ.prompt.length > 0, 'Flashcard question must have prompt (front)');
      assert(fcQ.flashcardBack && fcQ.flashcardBack.length > 0, 'Flashcard question must have back explanation');
    });
  });

  console.log('  ✓ Verified 2-paragraph digests, analogies, takeaways, flashcards, MCQs, and open-ended questions');

  // ==========================================
  // Test 2: Course Conversion & Hierarchy
  // ==========================================
  console.log('▶ Test 2: Validating Course conversion & skill node structure...');
  const course = qcResult.course;
  assert.strictEqual(course.nodes.length, qcResult.concepts.length);
  assert.strictEqual(course.nodes[0].status, 'active', 'First node must be active');
  assert.strictEqual(course.nodes[1].status, 'locked', 'Subsequent nodes must be locked initially');
  assert.strictEqual(course.nodes[course.nodes.length - 1].isBossCheckpoint, true, 'Final node must be boss checkpoint');

  const firstLesson = course.nodes[0].lessons[0];
  assert(firstLesson.questions.some((q) => q.type === 'flashcard'), 'Lesson must contain flashcard questions');
  assert(firstLesson.questions.some((q) => q.type === 'multiple-choice'), 'Lesson must contain multiple-choice questions');
  assert(firstLesson.questions.some((q) => q.type === 'open-ended'), 'Lesson must contain open-ended questions');
  console.log(`  ✓ Course structured: ${course.nodes.length} nodes with mixed question gauntlets`);

  // ==========================================
  // Test 3: Other Technical Topics Decomposition
  // ==========================================
  console.log('▶ Test 3: Decomposing "Rust Concurrency", "Docker & Kubernetes", "Linear Algebra"...');
  const rustDecomp = await decomposeTopicIntoConcepts('Rust Concurrency', mockProfile);
  assert(rustDecomp.concepts.length >= 4, 'Rust Concurrency should have >= 4 concepts');
  assert(rustDecomp.concepts.some((c) => c.title.toLowerCase().includes('arc') || c.title.toLowerCase().includes('mutex')));

  const dockerDecomp = await decomposeTopicIntoConcepts('Docker & Kubernetes', mockProfile);
  assert(dockerDecomp.concepts.length >= 4, 'Docker & Kubernetes should have >= 4 concepts');
  assert(dockerDecomp.concepts.some((c) => c.title.toLowerCase().includes('namespace') || c.title.toLowerCase().includes('pod')));

  const linalgDecomp = await decomposeTopicIntoConcepts('Linear Algebra', mockProfile);
  assert(linalgDecomp.concepts.length >= 4, 'Linear Algebra should have >= 4 concepts');
  assert(linalgDecomp.concepts.some((c) => c.title.toLowerCase().includes('eigen') || c.title.toLowerCase().includes('matrix')));
  console.log('  ✓ Curated domains decomposed successfully');

  // ==========================================
  // Test 4: Arbitrary / Novel Topic Decomposition
  // ==========================================
  console.log('▶ Test 4: Procedural Decomposition for arbitrary novel topic...');
  const novelTopic = 'Raft Consensus Protocol';
  const novelDecomp = await decomposeTopicIntoConcepts(novelTopic, mockProfile);
  assert.strictEqual(novelDecomp.topic, novelTopic);
  assert(novelDecomp.concepts.length >= 3 && novelDecomp.concepts.length <= 6);
  novelDecomp.concepts.forEach((concept) => {
    assert(concept.digest.length > 50, 'Digest must have substance');
    assert(concept.analogy.length > 10, 'Analogy must be present');
    assert(concept.flashcards.length >= 2, 'Flashcards must be present');
    assert(concept.questions.some((q) => q.type === 'open-ended'), 'Open-ended question must be present');
  });
  console.log(`  ✓ Procedural fallback handled novel topic: ${novelDecomp.concepts.length} concepts synthesized`);

  // ==========================================
  // Test 5: Open-Ended Answer Grader
  // ==========================================
  console.log('▶ Test 5: Agentic Open-Ended Answer Evaluation & Grading...');
  const sampleQuestion: Question = {
    id: 'test_oe_1',
    type: 'open-ended',
    prompt: 'In 1-3 sentences, explain why quantum entanglement does not allow faster-than-light communication.',
    minSentences: 1,
    rubric: 'Must state that measurement outcomes are fundamentally random and classical communication is required to compare results.',
    explanation: 'Although measuring one entangled qubit instantly collapses the state of the other, each individual outcome is fundamentally random. Because no controllable signal can be chosen without transmitting classical comparison data limited by the speed of light, no faster-than-light communication occurs.',
    hint: 'No-communication theorem.',
    xpReward: 30,
  };

  // 5a. Accurate answer
  const accurateAnswer =
    'Individual quantum measurements produce completely random outcomes, so no controllable message or signal can be transmitted. To extract meaningful correlation data, observers must communicate through classical channels that are constrained by the speed of light.';
  const evalAccurate = await evaluateOpenEndedAnswer(sampleQuestion, accurateAnswer, mockProfile);

  assert.strictEqual(evalAccurate.isCorrect, true, 'Accurate answer should be graded as correct');
  assert(evalAccurate.scorePercentage >= 70, `Score percentage should be >= 70% (received ${evalAccurate.scorePercentage}%)`);
  assert(evalAccurate.xpEarned && evalAccurate.xpEarned >= 20, `Earned XP should be proportional (received ${evalAccurate.xpEarned})`);
  assert(evalAccurate.feedback.length > 10, 'Feedback must provide meaningful assessment');
  console.log(`  ✓ Accurate answer graded: ${evalAccurate.scorePercentage}%, +${evalAccurate.xpEarned} XP, Feedback: "${evalAccurate.feedback.slice(0, 60)}..."`);

  // 5b. Partial answer
  const partialAnswer = 'The qubits are connected, but light speed is the limit for signals.';
  const evalPartial = await evaluateOpenEndedAnswer(sampleQuestion, partialAnswer, mockProfile);
  assert(evalPartial.scorePercentage >= 20 && evalPartial.scorePercentage <= 80, 'Partial answer should receive moderate score');
  assert(evalPartial.suggestedImprovement, 'Partial answer should provide coaching improvement tip');
  console.log(`  ✓ Partial answer graded: ${evalPartial.scorePercentage}%, Coaching: "${evalPartial.suggestedImprovement?.slice(0, 60)}..."`);

  // 5c. Empty / Gibberish answer
  const blankAnswer = '';
  const evalBlank = await evaluateOpenEndedAnswer(sampleQuestion, blankAnswer, mockProfile);
  assert.strictEqual(evalBlank.isCorrect, false, 'Blank answer must fail');
  assert.strictEqual(evalBlank.scorePercentage, 0, 'Blank answer score must be 0%');
  assert.strictEqual(evalBlank.xpEarned, 0, 'Blank answer XP must be 0');
  console.log('  ✓ Blank answer handled gracefully (0% score, 0 XP)');

  // ==========================================
  // Test 6: Storage Persistence & Reload
  // ==========================================
  console.log('▶ Test 6: Saving Decomposed Course & Verifying Persistence...');
  await saveDecomposedCourse(qcResult.course, mockProfile);
  assert.strictEqual(mockProfile.activeCourseId, qcResult.course.id, 'Active course ID must be updated in profile');

  const reloaded = await loadCourse(qcResult.course.id);
  assert(reloaded, 'Course must be reloadable from disk');
  assert.strictEqual(reloaded.title, 'Quantum Computing');
  assert.strictEqual(reloaded.nodes.length, qcResult.concepts.length);
  assert.strictEqual(reloaded.nodes[0].lessons[0].questions.length, qcResult.concepts[0].questions.length);
  console.log('  ✓ Decomposed course successfully persisted and reloaded from disk');

  console.log('\n✨ ALL TOPIC ENGINE & ANSWER GRADER TESTS PASSED! ✨\n');
}

runTopicEngineTests().catch((err) => {
  console.error('❌ Topic engine test failed:', err);
  process.exit(1);
});
