import {
  UserProfile,
  Course,
  TopicDecomposition,
  MicroConcept,
  Question,
  AnswerEvaluation,
  Pace,
  SkillNode,
  Lesson,
  LearningIntent,
} from '../types/index.js';
import { resolveActiveCredentials } from './agentWrapper.js';
import { sendLiveLlmPrompt, DEFAULT_OPENAI_REASONING_EFFORT } from './liveClient.js';
import { withPromptConfidentiality } from './promptSecurity.js';
import { getValidGoogleAccessToken } from './cliAuth.js';
import { saveCourse, saveUserProfile } from './storage.js';
import { normalizeLearningIntent } from './learningEngine.js';

export interface TopicDecompositionResult extends TopicDecomposition {
  decomposition: TopicDecomposition;
  course: Course;
}

/**
 * Clean and normalize JSON text extracted from LLM responses.
 */
function extractJsonFromText(text: string): string {
  const jsonBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (jsonBlockMatch && jsonBlockMatch[1]) {
    return jsonBlockMatch[1].trim();
  }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1).trim();
  }
  return text.trim();
}

/**
 * Converts a TopicDecomposition into a structured Course for persistence and practice.
 */
export function topicDecompositionToCourse(
  decomposition: TopicDecomposition,
  pace: Pace = 'standard',
  intent?: LearningIntent
): Course {
  const timestamp = Date.now();
  const totalConcepts = decomposition.concepts.length;
  const unitCount = totalConcepts >= 5 ? 2 : 1;
  const nodesPerUnit = Math.ceil(totalConcepts / unitCount);

  const nodes: SkillNode[] = decomposition.concepts.map((concept, index) => {
    const isBoss = index === totalConcepts - 1;
    const unitIndex = Math.min(unitCount, Math.floor(index / nodesPerUnit) + 1);
    const unitTitle =
      unitIndex === 1
        ? `Unit 1: ${decomposition.topic} Foundations`
        : `Unit 2: Advanced Mechanics & Synthesis`;

    // Ensure questions include flashcards if not already in questions array
    const questions: Question[] = [...concept.questions];
    for (let fcIdx = 0; fcIdx < (concept.flashcards || []).length; fcIdx++) {
      const fc = concept.flashcards[fcIdx];
      const fcId = `${concept.id}_fc_${fcIdx + 1}`;
      if (!questions.some((q) => q.id === fcId || (q.type === 'flashcard' && q.prompt.includes(fc.term)))) {
        questions.unshift({
          id: fcId,
          type: 'flashcard',
          prompt: `Flashcard: ${fc.term}`,
          flashcardBack: fc.explanation,
          hint: fc.hint,
          explanation: `${fc.term}: ${fc.explanation}`,
          xpReward: 10,
        });
      }
    }

    const lesson: Lesson = {
      id: `lesson_${concept.id || index + 1}_1`,
      title: `${concept.title} Fundamentals`,
      conceptDigest: concept.digest,
      keyTakeaway: concept.keyTakeaway,
      analogies: concept.analogy ? [concept.analogy] : [],
      questions,
      xpAwarded: 0,
      isCompleted: false,
      crownCount: 0,
      attemptCount: 0,
      masteryScore: 0,
    };

    return {
      id: `node_${concept.id || index + 1}`,
      unitId: `unit_${unitIndex}`,
      unitTitle,
      title: isBoss ? `⚔️ Mastery: ${concept.title}` : concept.title,
      description: concept.keyTakeaway,
      order: concept.order || index + 1,
      status: index === 0 ? 'active' : 'locked',
      lessons: [lesson],
      isBossCheckpoint: isBoss,
    };
  });

  return {
    id: `course_topic_${timestamp}`,
    title: decomposition.topic,
    sourceFileName: `Topic: ${decomposition.topic}`,
    pace,
    createdAt: new Date().toISOString(),
    summary: decomposition.overview,
    nodes,
    intent: normalizeLearningIntent(intent, decomposition.topic),
    currentNodeId: nodes[0]?.id,
  };
}

/**
 * Saves a decomposed course to storage and optionally sets it as active in the user profile.
 */
export async function saveDecomposedCourse(
  course: Course,
  profile?: UserProfile
): Promise<void> {
  await saveCourse(course);
  if (profile) {
    profile.activeCourseId = course.id;
    await saveUserProfile(profile);
  }
}

/**
 * Breaks any topic into 3-6 progressive Micro-Concepts with Duolingo-style bite-sized materials.
 * Connects to the active agentic LLM (Gemini 3.8 Flash, Claude, OpenAI, Antigravity) with
 * robust offline fallback.
 */
export async function decomposeTopicIntoConcepts(
  topic: string,
  profile: UserProfile,
  options?: { forceOffline?: boolean; timeoutMs?: number; intent?: LearningIntent }
): Promise<TopicDecompositionResult> {
  const cleanTopic = topic.trim() || 'Software Architecture';
  const isOfflineForced =
    options?.forceOffline || process.env.JARVIS_OFFLINE === '1' || process.env.JARVIS_TEST_OFFLINE === '1';

  // 1. Attempt LLM decomposition if active credentials exist and not forced offline
  if (!isOfflineForced) {
    const creds = resolveActiveCredentials(profile);
    if (creds.hasAuth) {
      try {
        let activeToken = creds.authToken;
        if (creds.provider === 'gemini' && (creds.harness === 'antigravity-cli' || creds.harness === 'gemini-cli')) {
          const refreshed = await getValidGoogleAccessToken();
          if (refreshed.token) activeToken = refreshed.token;
        }

        const intent = normalizeLearningIntent(options?.intent, cleanTopic);
        const prompt = `Decompose the technical topic "${cleanTopic}" into 4 to 5 progressive Micro-Concepts for a learner.
Each Micro-Concept must represent a bite-sized, sequential milestone in mastering the topic.

Learner contract:
- Goal: ${intent.goal}
- Target outcome: ${intent.targetOutcome}
- Current level: ${intent.level}
- Preferred mode: ${intent.preferredMode}
- Weekly time budget: ${intent.weeklyMinutes} minutes
Design the sequence so it reaches the target outcome, not just broad topic coverage. Include practical transfer when the preferred mode is practical or project-based.

For each Micro-Concept:
1. Bite-Sized Digest: Exactly 2 concise paragraphs describing the technical mental model clearly and intuitively.
2. Analogy: 1 intuitive real-world analogy.
3. Key Takeaway: 1 sharp, memorable core rule.
4. Interactive Flashcards: 2-3 flashcards with { term, explanation, hint }.
5. Questions:
   - At least 1 multiple-choice question (type: "multiple-choice") with 4 realistic options, correctIndex (0-3), deep explanation, hint, xpReward: 15.
   - At least 1 open-ended synthesis question (type: "open-ended") requiring the learner to explain a core mechanism in 1-3 sentences, with rubric, explanation (exemplary reference answer), hint, minSentences: 1, xpReward: 25.

Respond STRICTLY with valid JSON matching this schema:
{
  "topic": "${cleanTopic}",
  "overview": "A 2-3 sentence overview of this topic and learning journey.",
  "concepts": [
    {
      "id": "concept_1",
      "order": 1,
      "title": "Concept Title",
      "digest": "First paragraph.\\n\\nSecond paragraph.",
      "analogy": "Real-world analogy text...",
      "keyTakeaway": "One sharp core takeaway rule.",
      "flashcards": [
        { "term": "Technical Term", "explanation": "Clear explanation", "hint": "Memory hook" }
      ],
      "questions": [
        {
          "id": "concept_1_q1",
          "type": "multiple-choice",
          "prompt": "Question text?",
          "options": ["Option A", "Option B", "Option C", "Option D"],
          "correctIndex": 0,
          "explanation": "Deep explanation why correct and why others fail",
          "hint": "Coaching hint",
          "xpReward": 15
        },
        {
          "id": "concept_1_q2",
          "type": "open-ended",
          "prompt": "Explain in 1-3 sentences how...",
          "minSentences": 1,
          "rubric": "Must mention key components and data flow",
          "explanation": "Reference exemplary answer explaining the mechanism...",
          "hint": "Think about state transitions",
          "xpReward": 25
        }
      ]
    }
  ]
}`;

        const systemPrompt = withPromptConfidentiality(`You are Jarvis CLI, an agentic AI learning engine fusing Duolingo bite-sized gamification with deep technical precision. Return valid raw JSON only.`);
        const timeoutMs = options?.timeoutMs || 8000;

        const responsePromise = sendLiveLlmPrompt({
          provider: creds.provider,
          model: creds.model,
          apiKey: creds.apiKey,
          authToken: activeToken,
          harness: creds.harness,
          prompt,
          systemPrompt,
          reasoningEffort: creds.provider === 'openai' ? DEFAULT_OPENAI_REASONING_EFFORT : undefined,
        });

        const timeoutPromise = new Promise<{ text: string; error?: string }>((resolve) =>
          setTimeout(() => resolve({ text: '', error: 'LLM request timed out' }), timeoutMs)
        );

        const response = await Promise.race([responsePromise, timeoutPromise]);

      if (response.text && !response.error) {
        const jsonStr = extractJsonFromText(response.text);
        const parsed = JSON.parse(jsonStr);
        if (parsed && Array.isArray(parsed.concepts) && parsed.concepts.length >= 3) {
          const validatedConcepts: MicroConcept[] = parsed.concepts.map((c: any, idx: number) => {
            const conceptId = c.id || `concept_${idx + 1}`;
            const flashcards = Array.isArray(c.flashcards) && c.flashcards.length > 0
              ? c.flashcards
              : [
                  {
                    term: c.title,
                    explanation: c.keyTakeaway || 'Key principle of this concept.',
                    hint: `Focus on ${c.title}`,
                  },
                ];

            // Build questions ensuring flashcard + MCQ + open-ended exist
            const rawQuestions = Array.isArray(c.questions) ? c.questions : [];
            const questions: Question[] = [];

            // Add flashcard question
            flashcards.forEach((fc: any, fcI: number) => {
              questions.push({
                id: `${conceptId}_fc_${fcI + 1}`,
                type: 'flashcard',
                prompt: `Flashcard: ${fc.term}`,
                flashcardBack: fc.explanation,
                hint: fc.hint,
                explanation: `${fc.term}: ${fc.explanation}`,
                xpReward: 10,
              });
            });

            // Add remaining questions
            rawQuestions.forEach((q: any, qI: number) => {
              if (q.type === 'multiple-choice' || q.type === 'scenario') {
                questions.push({
                  id: q.id || `${conceptId}_mcq_${qI + 1}`,
                  type: 'multiple-choice',
                  prompt: q.prompt,
                  options: Array.isArray(q.options) && q.options.length >= 2 ? q.options : ['Option A', 'Option B', 'Option C', 'Option D'],
                  correctIndex: typeof q.correctIndex === 'number' ? q.correctIndex : 0,
                  explanation: q.explanation || 'Verified correct.',
                  hint: q.hint,
                  xpReward: q.xpReward || 15,
                });
              } else if (q.type === 'open-ended') {
                questions.push({
                  id: q.id || `${conceptId}_oe_${qI + 1}`,
                  type: 'open-ended',
                  prompt: q.prompt,
                  minSentences: q.minSentences || 1,
                  rubric: q.rubric || 'Explain the core mechanism clearly.',
                  explanation: q.explanation || 'Exemplary answer explaining the principle.',
                  hint: q.hint,
                  xpReward: q.xpReward || 25,
                });
              } else if (q.type === 'cloze') {
                questions.push({
                  id: q.id || `${conceptId}_cloze_${qI + 1}`,
                  type: 'cloze',
                  prompt: q.prompt,
                  clozeAnswer: q.clozeAnswer || 'principle',
                  explanation: q.explanation || 'Key concept.',
                  hint: q.hint,
                  xpReward: q.xpReward || 15,
                });
              }
            });

            // If no open-ended question was returned by the LLM, synthesize one
            if (!questions.some((q) => q.type === 'open-ended')) {
              questions.push({
                id: `${conceptId}_oe_gen`,
                type: 'open-ended',
                prompt: `In 1-3 sentences, explain the fundamental mechanism of ${c.title} and why it matters in ${cleanTopic}.`,
                minSentences: 1,
                rubric: `Must explain the role of ${c.title} and its primary operational benefit.`,
                explanation: `${c.title} serves to ${c.keyTakeaway.toLowerCase()} By structuring operations this way, the system prevents unexpected faults and ensures invariant consistency.`,
                hint: `Recall the core rule: ${c.keyTakeaway}`,
                xpReward: 25,
              });
            }

            return {
              id: conceptId,
              order: c.order || idx + 1,
              title: c.title || `Concept ${idx + 1}`,
              digest: c.digest || `Foundational overview of ${c.title}. Understanding this is essential for mastering ${cleanTopic}.`,
              analogy: c.analogy || `Think of ${c.title} as an essential architectural building block.`,
              keyTakeaway: c.keyTakeaway || `Mastering ${c.title} unlocks reliable design patterns.`,
              flashcards,
              questions,
            };
          });

          const decomposition: TopicDecomposition = {
            topic: cleanTopic,
            overview: parsed.overview || `Progressive 4-stage technical breakdown of ${cleanTopic}.`,
            concepts: validatedConcepts,
          };

          const course = topicDecompositionToCourse(decomposition, 'standard', intent);
          return {
            ...decomposition,
            decomposition,
            course,
          };
        }
      }
    } catch {
      // Fall through to heuristic fallback
    }
  }
}

  // 2. Offline Heuristic Fallback
  const decomposition = getHeuristicTopicDecomposition(cleanTopic);
  const course = topicDecompositionToCourse(decomposition, 'standard', options?.intent);
  return {
    ...decomposition,
    decomposition,
    course,
  };
}

/**
 * Agentic open-ended answer evaluation.
 * Evaluates factual accuracy & conceptual coverage, what was accurate vs missing,
 * constructive feedback, and realistic XP reward (0 to 30 XP proportional to accuracy).
 */
export async function evaluateOpenEndedAnswer(
  question: Question,
  userAnswer: string,
  profile: UserProfile,
  options?: { forceOffline?: boolean; timeoutMs?: number }
): Promise<AnswerEvaluation> {
  const cleanAnswer = userAnswer.trim();

  // Edge case: Empty or trivially short answer
  if (!cleanAnswer || cleanAnswer.length < 5) {
    return {
      isCorrect: false,
      scorePercentage: 0,
      feedback: 'No substantive explanation provided. Please answer in 1-3 complete sentences.',
      suggestedImprovement: 'Focus on naming the core mechanism and explaining why it operates.',
      xpEarned: 0,
    };
  }

  const isOfflineForced =
    options?.forceOffline || process.env.JARVIS_OFFLINE === '1' || process.env.JARVIS_TEST_OFFLINE === '1';

  // 1. Attempt LLM-based evaluation if active credentials exist and not forced offline
  if (!isOfflineForced) {
    const creds = resolveActiveCredentials(profile);
    if (creds.hasAuth) {
      try {
        let activeToken = creds.authToken;
        if (creds.provider === 'gemini' && (creds.harness === 'antigravity-cli' || creds.harness === 'gemini-cli')) {
          const refreshed = await getValidGoogleAccessToken();
          if (refreshed.token) activeToken = refreshed.token;
        }

        const prompt = `You are Jarvis CLI's AI Grading Agent. Evaluate the learner's answer to this open-ended question.

Question: "${question.prompt}"
Reference / Model Answer: "${question.explanation}"
Rubric / Key Criteria: "${question.rubric || 'Evaluate conceptual correctness, mechanism explanation, and clarity.'}"
Required Length: ${question.minSentences || 1} to 3 sentences.
Learner's Answer: "${cleanAnswer}"

Grade objectively on conceptual understanding.
Evaluate:
1. Factual accuracy & conceptual coverage (scorePercentage: 0-100).
2. What was accurate in the learner's response.
3. What was missing, incomplete, or misunderstood.
4. Specific constructive coaching feedback.
5. Whether the answer demonstrates passing mastery (isCorrect: scorePercentage >= 65).

Respond STRICTLY with valid JSON:
{
  "scorePercentage": 85,
  "isCorrect": true,
  "accuratePoints": "Accurately noted that...",
  "missingPoints": "Did not mention...",
  "feedback": "Concise 1-2 sentence overall coaching feedback.",
  "suggestedImprovement": "Clear actionable improvement tip."
}`;

        const systemPrompt = withPromptConfidentiality('You are an expert technical evaluator in Jarvis CLI. Return valid raw JSON only.');
        const timeoutMs = options?.timeoutMs || 8000;

        const responsePromise = sendLiveLlmPrompt({
          provider: creds.provider,
          model: creds.model,
          apiKey: creds.apiKey,
          authToken: activeToken,
          harness: creds.harness,
          prompt,
          systemPrompt,
          reasoningEffort: creds.provider === 'openai' ? DEFAULT_OPENAI_REASONING_EFFORT : undefined,
        });

        const timeoutPromise = new Promise<{ text: string; error?: string }>((resolve) =>
          setTimeout(() => resolve({ text: '', error: 'LLM request timed out' }), timeoutMs)
        );

        const response = await Promise.race([responsePromise, timeoutPromise]);

      if (response.text && !response.error) {
        const jsonStr = extractJsonFromText(response.text);
        const parsed = JSON.parse(jsonStr);
        if (typeof parsed.scorePercentage === 'number') {
          const score = Math.max(0, Math.min(100, Math.round(parsed.scorePercentage)));
          const isCorrect = typeof parsed.isCorrect === 'boolean' ? parsed.isCorrect : score >= 65;
          const maxReward = question.xpReward || 30;
          const xpEarned = Math.round((maxReward * score) / 100);

          let combinedFeedback = parsed.feedback || (isCorrect ? 'Well explained!' : 'Needs improvement.');
          if (parsed.accuratePoints && parsed.missingPoints) {
            combinedFeedback += ` (Covered: ${parsed.accuratePoints} | Missing: ${parsed.missingPoints})`;
          } else if (parsed.missingPoints) {
            combinedFeedback += ` (Missing: ${parsed.missingPoints})`;
          }

          return {
            isCorrect,
            scorePercentage: score,
            feedback: combinedFeedback,
            suggestedImprovement: parsed.suggestedImprovement || 'Keep practicing conceptual explanations.',
            xpEarned,
          };
        }
      }
    } catch {
      // Fall through to heuristic fuzzy matching
    }
  }
}

  // 2. Offline Heuristic / Fuzzy Keyword Matching Fallback
  return evaluateOpenEndedAnswerHeuristically(question, cleanAnswer);
}

/**
 * Deterministic fuzzy keyword matching and conceptual coverage evaluation.
 */
function evaluateOpenEndedAnswerHeuristically(
  question: Question,
  userAnswer: string
): AnswerEvaluation {
  const reference = `${question.explanation} ${question.rubric || ''} ${question.prompt}`.toLowerCase();
  const lowerAnswer = userAnswer.toLowerCase();

  // Stop words to filter out
  const stopWords = new Set([
    'the', 'this', 'that', 'with', 'from', 'have', 'were', 'which', 'their', 'about',
    'there', 'would', 'could', 'these', 'other', 'after', 'first', 'also', 'where',
    'being', 'using', 'between', 'through', 'during', 'before', 'should', 'under',
    'while', 'when', 'what', 'your', 'will', 'does', 'more', 'into', 'than', 'them',
    'been', 'they', 'explain', 'sentences', 'answer', 'learner', 'question',
  ]);

  // Extract key concept terms (words >= 4 chars, not stop words)
  const rawWords = reference.match(/\b[a-z][a-z0-9_-]{3,20}\b/g) || [];
  const termFreq = new Map<string, number>();
  for (const w of rawWords) {
    if (!stopWords.has(w)) {
      termFreq.set(w, (termFreq.get(w) || 0) + 1);
    }
  }

  const sortedTerms = Array.from(termFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([w]) => w);

  // Take top distinct terms as evaluation rubric anchors
  const rubricTerms = sortedTerms.slice(0, 15);
  const matchedTerms: string[] = [];
  const missingTerms: string[] = [];

  for (const term of rubricTerms) {
    // Check exact or stem match (first 4 letters)
    const stem = term.length > 5 ? term.slice(0, 5) : term;
    if (lowerAnswer.includes(term) || lowerAnswer.includes(stem)) {
      matchedTerms.push(term);
    } else {
      missingTerms.push(term);
    }
  }

  // Count sentences
  const sentenceCount = userAnswer.split(/[.!?]+/).filter((s) => s.trim().length > 5).length;
  const targetSentences = question.minSentences || 1;
  const sentenceBonus = sentenceCount >= targetSentences ? 10 : 0;

  // Calculate coverage percentage
  const totalChecked = Math.max(1, Math.min(rubricTerms.length, 8));
  const coverageRatio = matchedTerms.length / totalChecked;

  let scorePercentage = Math.round(coverageRatio * 80 + sentenceBonus);
  if (lowerAnswer.length > 30 && matchedTerms.length > 0) {
    scorePercentage = Math.max(scorePercentage, 45);
  }
  if (lowerAnswer.length > 60 && matchedTerms.length >= 3) {
    scorePercentage = Math.max(scorePercentage, 75);
  }
  if (matchedTerms.length >= 5) {
    scorePercentage = Math.max(scorePercentage, 90);
  }
  scorePercentage = Math.min(100, Math.max(10, scorePercentage));

  const isCorrect = scorePercentage >= 65;
  const maxReward = question.xpReward || 30;
  const xpEarned = Math.round((maxReward * scorePercentage) / 100);

  const matchedSummary = matchedTerms.length > 0 ? matchedTerms.slice(0, 4).join(', ') : 'general mechanics';
  const missingSummary = missingTerms.length > 0 ? missingTerms.slice(0, 3).join(', ') : 'secondary details';

  const feedback = isCorrect
    ? `Strong recall! You correctly addressed: ${matchedSummary}.`
    : `Partially correct. You addressed ${matchedSummary}, but missed core aspects.`;

  const suggestedImprovement = missingTerms.length > 0
    ? `To deepen this explanation, explicitly incorporate: ${missingSummary}.`
    : 'Refine your explanation by connecting the mechanism directly to system invariants.';

  return {
    isCorrect,
    scorePercentage,
    feedback,
    suggestedImprovement,
    xpEarned,
  };
}

function attachFlashcardQuestions(decomposition: TopicDecomposition): TopicDecomposition {
  for (const concept of decomposition.concepts) {
    for (let fcIdx = 0; fcIdx < (concept.flashcards || []).length; fcIdx++) {
      const fc = concept.flashcards[fcIdx];
      const fcId = `${concept.id}_fc_${fcIdx + 1}`;
      if (!concept.questions.some((q) => q.id === fcId || (q.type === 'flashcard' && q.prompt.includes(fc.term)))) {
        concept.questions.unshift({
          id: fcId,
          type: 'flashcard',
          prompt: `Flashcard: ${fc.term}`,
          flashcardBack: fc.explanation,
          hint: fc.hint,
          explanation: `${fc.term}: ${fc.explanation}`,
          xpReward: 10,
        });
      }
    }
  }
  return decomposition;
}

/**
 * Provides rich, curated progressive micro-concepts for standard topics,
 * or procedurally decomposes arbitrary topics offline.
 */
export function getHeuristicTopicDecomposition(topic: string): TopicDecomposition {
  const lower = topic.toLowerCase().trim();

  let decomp: TopicDecomposition;
  if (lower.includes('quantum')) {
    decomp = getQuantumComputingDecomposition();
  } else if (lower.includes('rust') || lower.includes('concurrency')) {
    decomp = getRustConcurrencyDecomposition();
  } else if (lower.includes('docker') || lower.includes('kubernetes') || lower.includes('k8s')) {
    decomp = getDockerKubernetesDecomposition();
  } else if (lower.includes('linear algebra') || lower.includes('matrix') || lower.includes('vector')) {
    decomp = getLinearAlgebraDecomposition();
  } else {
    decomp = getProceduralTopicDecomposition(topic);
  }

  return attachFlashcardQuestions(decomp);
}

function getQuantumComputingDecomposition(): TopicDecomposition {
  const concepts: MicroConcept[] = [
    {
      id: 'qc_1',
      order: 1,
      title: 'Qubits & Superposition',
      digest:
        'In classical computing, a bit exists strictly in state 0 or 1. A quantum bit (qubit) leverages the quantum mechanical principle of superposition, allowing it to occupy a linear combination of |0⟩ and |1⟩ simultaneously.\n\nMathematically, a qubit is represented as a state vector |ψ⟩ = α|0⟩ + β|1⟩ on the Bloch sphere, where |α|² and |β|² represent the probabilities of measuring 0 or 1 respectively, constrained by the normalization invariant |α|² + |β|² = 1.',
      analogy:
        'A classical bit is a light switch turned either ON or OFF. A qubit in superposition is a coin spinning on a table: while in motion, it is both heads and tails with varying probabilities until caught.',
      keyTakeaway:
        'Superposition lets a qubit exist as a continuous linear combination of states until measurement forces it into a single classical outcome.',
      flashcards: [
        {
          term: 'Superposition',
          explanation: 'The ability of a quantum state to exist simultaneously in multiple basis states (|0⟩ and |1⟩) with probabilistic amplitudes.',
          hint: 'Spinning coin state',
        },
        {
          term: 'Bloch Sphere',
          explanation: 'A geometric representation of the state space of a single qubit as points on the surface of a unit sphere.',
          hint: 'Unit sphere visualization',
        },
      ],
      questions: [
        {
          id: 'qc_1_mcq',
          type: 'multiple-choice',
          prompt: 'What mathematical condition must the probability amplitudes α and β of a normalized qubit |ψ⟩ = α|0⟩ + β|1⟩ satisfy?',
          options: [
            '|α|² + |β|² = 1',
            'α + β = 1',
            '|α| · |β| = 0',
            'α² - β² = 1',
          ],
          correctIndex: 0,
          explanation:
            'The total probability of all possible measurement outcomes must equal 100%, meaning the sum of the squared absolute amplitudes |α|² + |β|² must equal 1.',
          hint: 'Total probability axiom.',
          xpReward: 15,
        },
        {
          id: 'qc_1_oe',
          type: 'open-ended',
          prompt: 'In 1-3 sentences, explain what happens to a qubit in superposition when it is measured by an observer.',
          minSentences: 1,
          rubric: 'Must state that wavefunction collapses to a definite classical state (|0⟩ or |1⟩) and the superposition is destroyed.',
          explanation:
            'When a qubit in superposition is measured, its wavefunction instantly collapses into one of the basis states (|0⟩ or |1⟩). The superposition is irrevocably destroyed, and subsequent measurements yield the exact same collapsed outcome.',
          hint: 'Wavefunction collapse.',
          xpReward: 25,
        },
      ],
    },
    {
      id: 'qc_2',
      order: 2,
      title: 'Quantum Entanglement & Bell States',
      digest:
        'Quantum entanglement is a phenomenon where two or more qubits become correlated such that the physical state of any individual qubit cannot be described independently of the others, regardless of spatial distance.\n\nBell States represent the four maximally entangled two-qubit quantum states. When one qubit in a Bell pair is measured, the outcome instantaneously dictates the measurement outcome of its partner, exhibiting non-local quantum correlations verified by Bell inequality experiments.',
      analogy:
        'Imagine a pair of magic shoes placed in separate sealed boxes shipped to opposite sides of the planet. Opening box A to reveal a left shoe instantly guarantees box B contains the right shoe, with zero delay.',
      keyTakeaway:
        'Entangled qubits share a unified quantum wave function: measuring one qubit instantly determines the state of the other.',
      flashcards: [
        {
          term: 'Entanglement',
          explanation: 'A quantum correlation where composite system states cannot be factored into products of individual subsystem states.',
          hint: 'Non-local correlation',
        },
        {
          term: 'Bell State',
          explanation: 'One of four specific maximally entangled quantum states formed by two qubits, such as (|00⟩ + |11⟩)/√2.',
          hint: 'Maximally entangled pair',
        },
      ],
      questions: [
        {
          id: 'qc_2_mcq',
          type: 'multiple-choice',
          prompt: 'Which mathematical property characterizes an entangled two-qubit state |ψ⟩?',
          options: [
            'It cannot be factored into the tensor product of two independent single-qubit states (|ψ_A⟩ ⊗ |ψ_B⟩)',
            'Both qubits must always measure strictly as |0⟩',
            'The state vector has a norm strictly greater than 1',
            'It can only exist at absolute zero temperature (0 Kelvin)',
          ],
          correctIndex: 0,
          explanation:
            'An entangled state is inseparable: by definition, it cannot be decomposed as a separable product state |ψ_A⟩ ⊗ |ψ_B⟩.',
          hint: 'Inseparability of composite states.',
          xpReward: 15,
        },
        {
          id: 'qc_2_oe',
          type: 'open-ended',
          prompt: 'In 1-3 sentences, explain why quantum entanglement does NOT violate special relativity or allow faster-than-light communication.',
          minSentences: 1,
          rubric: 'Must state that measurement outcomes are fundamentally random, requiring classical communication to decode correlations.',
          explanation:
            'Although measuring one entangled qubit instantly collapses the state of the other, each individual outcome is fundamentally random. Because no controllable signal can be chosen without transmitting classical comparison data (limited by the speed of light), no faster-than-light communication occurs.',
          hint: 'No-communication theorem.',
          xpReward: 25,
        },
      ],
    },
    {
      id: 'qc_3',
      order: 3,
      title: 'Quantum Logic Gates & Unitary Operators',
      digest:
        'Quantum computation proceeds through the manipulation of state vectors using quantum logic gates. Unlike irreversible classical gates (such as AND or OR), quantum operations on closed systems must be reversible, represented by unitary matrices (U†U = I).\n\nKey elementary gates include the Hadamard gate (H), which transforms basis states into balanced superpositions, Pauli-X (quantum NOT), and the Controlled-NOT (CNOT) gate, which flips a target qubit if and only if the control qubit is |1⟩.',
      analogy:
        'A quantum gate is a precise rotation of an object in 3D space: every rotation can be completely reversed by rotating by the exact opposite angle in the opposite direction.',
      keyTakeaway:
        'All quantum gates on closed systems are unitary operators, guaranteeing reversibility and probability conservation.',
      flashcards: [
        {
          term: 'Hadamard Gate (H)',
          explanation: 'A single-qubit gate that maps basis state |0⟩ to (|0⟩ + |1⟩)/√2, creating an equal superposition.',
          hint: 'Superposition creator',
        },
        {
          term: 'CNOT Gate',
          explanation: 'A 2-qubit gate that inverts the target qubit if the control qubit is |1⟩, critical for creating entanglement.',
          hint: 'Controlled inverter',
        },
      ],
      questions: [
        {
          id: 'qc_3_mcq',
          type: 'multiple-choice',
          prompt: 'What happens when a Hadamard gate (H) is applied twice consecutively to state |0⟩ (i.e. H · H |0⟩)?',
          options: [
            'The state returns precisely to |0⟩ because H is unitary and its own inverse (H = H† = H⁻¹)',
            'The state permanently collapses to |1⟩',
            'The state enters an irreversible random phase shift',
            'The qubit is entrained with the environment',
          ],
          correctIndex: 0,
          explanation:
            'The Hadamard matrix is Hermitian and unitary, meaning H² = I. Applying it twice returns the qubit to its initial state.',
          hint: 'Hadamard is self-inverse.',
          xpReward: 15,
        },
        {
          id: 'qc_3_oe',
          type: 'open-ended',
          prompt: 'In 1-3 sentences, describe how a Hadamard gate and a CNOT gate can be combined to generate a Bell entangled state.',
          minSentences: 1,
          rubric: 'Must explain applying Hadamard to the first qubit to create superposition, followed by CNOT targeting the second qubit.',
          explanation:
            'Starting with two qubits initialized to |00⟩, applying a Hadamard gate to the first qubit creates the superposition (|0⟩ + |1⟩)/√2 ⊗ |0⟩ = (|00⟩ + |10⟩)/√2. Passing this through a CNOT with qubit 1 as control and qubit 2 as target flips the target whenever qubit 1 is |1⟩, resulting in the maximally entangled Bell state (|00⟩ + |11⟩)/√2.',
          hint: 'Hadamard on control, then CNOT on target.',
          xpReward: 25,
        },
      ],
    },
    {
      id: 'qc_4',
      order: 4,
      title: 'Quantum Algorithms & Speedup (Shor & Grover)',
      digest:
        'Quantum algorithms exploit constructive and destructive quantum interference to amplify the probability of correct answers while cancelling out incorrect paths. This provides computational speedups over classical algorithms for specific problem classes.\n\nShor’s algorithm utilizes the Quantum Fourier Transform (QFT) to find the period of modular exponentiation functions in polynomial time O((log N)³), breaking RSA cryptography. Grover’s algorithm provides a quadratic speedup O(√N) for searching unstructured databases.',
      analogy:
        'Imagine exploring a massive maze: a classical computer sends an explorer down one path at a time. A quantum algorithm sends an expanding wave through all corridors simultaneously, engineered so wrong turns destructively cancel out while the exit path constructively amplifies.',
      keyTakeaway:
        'Quantum speedup relies on wave interference: amplifying probability amplitudes of valid answers while destructively cancelling incorrect ones.',
      flashcards: [
        {
          term: 'Quantum Fourier Transform (QFT)',
          explanation: 'The quantum analog of the discrete Fourier transform, enabling exponential speedups in period-finding.',
          hint: 'Period-finding engine',
        },
        {
          term: 'Grover Diffusion Operator',
          explanation: 'An amplitude amplification step that inverts quantum state amplitudes about their mean to boost the target state.',
          hint: 'Inversion about the mean',
        },
      ],
      questions: [
        {
          id: 'qc_4_mcq',
          type: 'multiple-choice',
          prompt: 'What computational complexity advantage does Grover’s search algorithm achieve over classical brute-force search on N unsorted items?',
          options: [
            'Quadratic speedup: O(√N) vs classical O(N)',
            'Exponential speedup: O(log N) vs classical O(N)',
            'Constant time: O(1) vs classical O(N)',
            'Polynomial speedup: O(N³) vs classical O(N!)',
          ],
          correctIndex: 0,
          explanation:
            'Grover’s algorithm provides a provable quadratic speedup, finding a marked item in O(√N) oracle queries compared to O(N) classically.',
          hint: 'Square root speedup.',
          xpReward: 15,
        },
        {
          id: 'qc_4_oe',
          type: 'open-ended',
          prompt: 'In 1-3 sentences, explain why quantum computers cannot simply solve all NP-complete problems in instantaneous O(1) time.',
          minSentences: 1,
          rubric: 'Must state that superposition evaluates paths in parallel but reading out requires measurement, and unstructured search only yields quadratic speedup (BQP does not necessarily equal NP).',
          explanation:
            'While a quantum register can evaluate all inputs simultaneously in superposition, measuring the system only reveals a single random outcome. Harnessing speedup requires designing destructive interference tailored to mathematical structure; for general unstructured NP-complete problems, the best quantum speedup known is quadratic via Grover’s algorithm.',
          hint: 'Measurement bottleneck and interference requirements.',
          xpReward: 25,
        },
      ],
    },
  ];

  return {
    topic: 'Quantum Computing',
    overview:
      'A progressive four-stage technical journey through qubits, superposition, quantum entanglement, unitary logic gates, and quantum algorithm speedups.',
    concepts,
  };
}

function getRustConcurrencyDecomposition(): TopicDecomposition {
  const concepts: MicroConcept[] = [
    {
      id: 'rust_1',
      order: 1,
      title: 'OS Threads & Move Closures',
      digest:
        'Rust provides fearless concurrency by binding threads directly to the compiler’s ownership and lifetime system. Spawning an OS thread with std::thread::spawn returns a JoinHandle<T>, which allows the caller to synchronize and harvest the thread’s return value via .join().\n\nBecause a spawned thread may outlive the stack frame that launched it, closures passed to thread::spawn must satisfy the \'static lifetime. The move keyword forces the closure to take ownership of captured variables, preventing dangling pointer references.',
      analogy:
        'Spawning a thread with move is like mailing a package to an offshore branch office: once mailed, your local desk no longer possesses the item, preventing simultaneous conflicting edits.',
      keyTakeaway:
        'The move keyword transfers ownership of captured references to the thread closure, ensuring memory safety across thread lifetimes.',
      flashcards: [
        {
          term: 'JoinHandle<T>',
          explanation: 'An owned handle returned by std::thread::spawn that enables waiting for thread termination and retrieving its result.',
          hint: 'Thread synchronization handle',
        },
        {
          term: 'move Closure',
          explanation: 'A closure that takes ownership of its captured variables by value rather than borrowing them by reference.',
          hint: 'Ownership transfer closure',
        },
      ],
      questions: [
        {
          id: 'rust_1_mcq',
          type: 'multiple-choice',
          prompt: 'Why does Rust’s compiler reject passing a standard borrowed reference (&data) to std::thread::spawn without the move keyword?',
          options: [
            'The spawned thread might outlive the stack frame containing the referenced data, violating the \'static lifetime guarantee',
            'Rust threads do not support reading memory from heap allocations',
            'References in Rust are not thread-safe by hardware definition',
            'Operating system threads require exclusive CPU affinity',
          ],
          correctIndex: 0,
          explanation:
            'thread::spawn requires the closure and its return value to satisfy \'static because the thread can run indefinitely after the enclosing function returns.',
          hint: 'Thread lifetime vs local stack lifetime.',
          xpReward: 15,
        },
        {
          id: 'rust_1_oe',
          type: 'open-ended',
          prompt: 'In 1-3 sentences, explain the purpose and behavior of calling .join() on a JoinHandle in Rust.',
          minSentences: 1,
          rubric: 'Must explain blocking the calling thread until the spawned thread completes and returning a Result containing its value.',
          explanation:
            'Calling .join() blocks the executing thread until the child thread finishes execution. It returns a Result<T, Box<dyn Any>> containing the child thread’s return value or an Err if the child panicked.',
          hint: 'Blocking synchronization and panic propagation.',
          xpReward: 25,
        },
      ],
    },
    {
      id: 'rust_2',
      order: 2,
      title: 'Message Passing with MPSC Channels',
      digest:
        'Rust embraces the concurrency philosophy: "Do not communicate by sharing memory; instead, share memory by communicating." The standard library provides std::sync::mpsc, a Multi-Producer, Single-Consumer FIFO communication channel.\n\nCalling channel() returns a (Sender, Receiver) tuple. Because Sender implements Clone, multiple threads can produce messages concurrently. The send() method transfers ownership of the message, eliminating data races after sending.',
      analogy:
        'A pneumatic tube conveyor system where multiple factory workstations (Senders) drop physical canisters into a single chute leading to one central sorting desk (Receiver).',
      keyTakeaway:
        'Sending data across an MPSC channel transfers ownership, eliminating the possibility of data races on the sender thread.',
      flashcards: [
        {
          term: 'mpsc::channel',
          explanation: 'A channel primitive supporting multiple sending endpoints and exactly one receiving endpoint.',
          hint: 'Multi-producer single-consumer',
        },
        {
          term: 'Receiver::recv()',
          explanation: 'Blocks the calling thread until a message is sent or all Senders have disconnected.',
          hint: 'Blocking consumer call',
        },
      ],
      questions: [
        {
          id: 'rust_2_mcq',
          type: 'multiple-choice',
          prompt: 'What happens when a thread calls sender.send(val) with a heap-allocated String?',
          options: [
            'Ownership of val is moved into the channel; the sending thread can no longer read or modify it',
            'A deep copy of the String is cloned into shared global memory',
            'The sending thread retains mutable access under an atomic lock',
            'The String is converted into an immutable raw pointer',
          ],
          correctIndex: 0,
          explanation:
            'send() takes self by reference and val by value (T), moving ownership directly through the channel buffer to the receiver.',
          hint: 'Ownership moves across channels.',
          xpReward: 15,
        },
        {
          id: 'rust_2_oe',
          type: 'open-ended',
          prompt: 'In 1-3 sentences, describe how a Receiver knows when to stop waiting for incoming messages.',
          minSentences: 1,
          rubric: 'Must mention that recv() returns Err(RecvError) when all Sender instances have been dropped and the channel is empty.',
          explanation:
            'When every cloned Sender handle is dropped out of scope and the channel buffer is empty, the channel hangs up. The Receiver’s recv() call stops blocking and returns an Err(RecvError), allowing loops like for msg in rx to terminate cleanly.',
          hint: 'Sender drop and channel hang-up.',
          xpReward: 25,
        },
      ],
    },
    {
      id: 'rust_3',
      order: 3,
      title: 'Shared State with Arc and Mutex',
      digest:
        'When multiple threads must access and mutate the same shared state, Rust pairs Mutex<T> with Arc<T> (Atomic Reference Counting). Mutex provides mutual exclusion, ensuring only one thread can access the inner data T at any time.\n\nArc provides thread-safe reference counting by using atomic CPU instructions for incrementing and decrementing the reference count. Wrapping a Mutex in an Arc (Arc<Mutex<T>>) allows multiple threads to hold shared ownership of a synchronized lock.',
      analogy:
        'A locked safety deposit box (Mutex) inside a bank. An Arc represents multiple authorized keycard copies given to team members: anyone holding a card can request access, but only one person holds the master key at a time.',
      keyTakeaway:
        'Arc enables shared thread-safe ownership across threads, while Mutex enforces exclusive access via RAII lock guards.',
      flashcards: [
        {
          term: 'Arc<T>',
          explanation: 'Atomic Reference Counting pointer that allows immutable shared ownership of heap memory across multiple threads.',
          hint: 'Thread-safe Rc',
        },
        {
          term: 'MutexGuard<T>',
          explanation: 'An RAII guard returned by lock() that provides mutable Deref access to data and automatically unlocks on drop.',
          hint: 'Auto-unlocking guard',
        },
      ],
      questions: [
        {
          id: 'rust_3_mcq',
          type: 'multiple-choice',
          prompt: 'How does Rust guarantee that a Mutex lock is released even if a thread panics inside the critical section?',
          options: [
            'MutexGuard implements the Drop trait, which automatically unlocks the mutex when the guard exits scope',
            'The operating system kernel forcibly terminates all adjacent threads',
            'The compiler injects explicit catch-finally assembly blocks into every function',
            'Panicking resets all atomic counters to zero',
          ],
          correctIndex: 0,
          explanation:
            'Rust uses RAII (Resource Acquisition Is Initialization). MutexGuard implements Drop, guaranteeing the mutex is unlocked during stack unwinding.',
          hint: 'RAII Drop semantics.',
          xpReward: 15,
        },
        {
          id: 'rust_3_oe',
          type: 'open-ended',
          prompt: 'In 1-3 sentences, explain why standard Rc<T> cannot be used instead of Arc<T> across threads.',
          minSentences: 1,
          rubric: 'Must state that Rc uses non-atomic reference counter increments which cause data races under concurrent modification.',
          explanation:
            'Standard Rc<T> uses ordinary, non-atomic arithmetic for tracking its reference count. If shared across threads, concurrent clones and drops would cause data races and memory corruption; Arc uses atomic CPU instructions to prevent this.',
          hint: 'Atomic vs non-atomic reference counting.',
          xpReward: 25,
        },
      ],
    },
    {
      id: 'rust_4',
      order: 4,
      title: 'Send and Sync Marker Traits',
      digest:
        'Rust enforces thread safety at compile time using two fundamental built-in marker traits: Send and Sync. A type is Send if ownership of the value can be safely transferred across thread boundaries. A type is Sync if it is safe to share references (&T) to it between threads.\n\nThe compiler automatically implements Send and Sync for types composed entirely of Send and Sync fields. Crucially, a type T is Sync if and only if &T is Send, creating an unbreakable mathematical guarantee against data races.',
      analogy:
        'Send is a shipping clearance certificate allowing an object to travel across borders. Sync is a public viewing permit allowing multiple spectators to safely inspect the object simultaneously without damage.',
      keyTakeaway:
        'Send indicates safe ownership transfer across threads; Sync indicates safe concurrent borrowing (&T) across threads.',
      flashcards: [
        {
          term: 'Send Trait',
          explanation: 'A marker trait indicating that ownership of the implementing type can be transferred across thread boundaries.',
          hint: 'Transferable across threads',
        },
        {
          term: 'Sync Trait',
          explanation: 'A marker trait indicating that multiple threads can safely reference the type concurrently (&T is Send).',
          hint: 'Sharable across threads',
        },
      ],
      questions: [
        {
          id: 'rust_4_mcq',
          type: 'multiple-choice',
          prompt: 'Which of the following types deliberately does NOT implement the Send trait in Rust?',
          options: [
            'Rc<T>',
            'Arc<T>',
            'Mutex<T>',
            'AtomicUsize',
          ],
          correctIndex: 0,
          explanation:
            'Rc<T> does not implement Send because transferring it to another thread could lead to unsynchronized reference count updates.',
          hint: 'Non-thread-safe reference counter.',
          xpReward: 15,
        },
        {
          id: 'rust_4_oe',
          type: 'open-ended',
          prompt: 'In 1-3 sentences, explain why UnsafeCell<T> does not implement Sync and how Mutex<T> restores Sync safety.',
          minSentences: 1,
          rubric: 'Must explain that UnsafeCell allows interior mutability without synchronization, while Mutex adds mutual exclusion locks.',
          explanation:
            'UnsafeCell<T> is the core primitive for interior mutability, allowing mutation through shared references without any synchronization, making it unsafe to share across threads (!Sync). Mutex<T> wraps UnsafeCell with an OS or hardware lock, ensuring only one thread can access the inner cell at a time, safely restoring the Sync implementation.',
          hint: 'Interior mutability and mutual exclusion.',
          xpReward: 25,
        },
      ],
    },
  ];

  return {
    topic: 'Rust Concurrency',
    overview:
      'A progressive four-stage technical masterclass on fearless concurrency in Rust: threads & move closures, MPSC channels, Arc/Mutex state, and Send/Sync traits.',
    concepts,
  };
}

function getDockerKubernetesDecomposition(): TopicDecomposition {
  const concepts: MicroConcept[] = [
    {
      id: 'dk_1',
      order: 1,
      title: 'Linux Namespaces, Cgroups & Containers vs VMs',
      digest:
        'Containers are not virtual machines; they are isolated Linux processes running directly on the host kernel. Containerization relies on two foundational Linux kernel features: Namespaces and Control Groups (cgroups).\n\nNamespaces provide isolation boundaries for processes (PID, NET, MNT, IPC, UTS, and USER), ensuring a process only sees its own network interfaces, process tree, and mount points. Cgroups enforce resource constraints, metering and restricting CPU, memory, and I/O usage.',
      analogy:
        'A VM is a standalone house with its own dedicated plumbing, wiring, and foundation. A container is an apartment in an apartment building: it has its own private rooms (namespaces) but shares the building’s foundation and utilities (kernel).',
      keyTakeaway:
        'Containers isolate processes via kernel namespaces and throttle resources via cgroups without hypervisor overhead.',
      flashcards: [
        {
          term: 'Linux Namespaces',
          explanation: 'Kernel feature that partitions global system resources into isolated workspaces per process group.',
          hint: 'Process boundary isolation',
        },
        {
          term: 'Control Groups (cgroups)',
          explanation: 'Kernel mechanism for allocating, limiting, and monitoring CPU, memory, and I/O resources.',
          hint: 'Resource throttling',
        },
      ],
      questions: [
        {
          id: 'dk_1_mcq',
          type: 'multiple-choice',
          prompt: 'What is the primary architectural difference between a Docker container and a Type-2 hypervisor Virtual Machine?',
          options: [
            'Containers share the host OS kernel and run as isolated processes; VMs run a full guest OS on virtualized hardware',
            'Containers cannot access networking interfaces',
            'VMs execute directly in ring 0 without operating system intervention',
            'Containers require specialized CPU hardware virtualization extensions (VT-x)',
          ],
          correctIndex: 0,
          explanation:
            'Containers share the host kernel and utilize kernel-level primitives (namespaces/cgroups), making them far more lightweight than VMs that package entire guest operating systems.',
          hint: 'Shared kernel vs guest OS.',
          xpReward: 15,
        },
        {
          id: 'dk_1_oe',
          type: 'open-ended',
          prompt: 'In 1-3 sentences, explain why a containerized application process crashes immediately when its PID 1 process terminates.',
          minSentences: 1,
          rubric: 'Must state that the container lifecycle is bound to its root process in the PID namespace.',
          explanation:
            'A container’s lifecycle is bound to the primary process executing as PID 1 within its PID namespace. When PID 1 exits, the Linux kernel terminates all remaining processes in that namespace and dismantles the container.',
          hint: 'PID 1 lifecycle.',
          xpReward: 25,
        },
      ],
    },
    {
      id: 'dk_2',
      order: 2,
      title: 'Dockerfile Directives & Layer Caching',
      digest:
        'Docker images are constructed using declarative Dockerfiles composed of sequential directives (FROM, RUN, COPY, ENTRYPOINT). Each directive creates an immutable, read-only filesystem layer stored in a content-addressable storage driver (like Overlay2).\n\nWhen building images, Docker caches intermediate layers. If a layer’s instructions and files have not changed, Docker reuses the cached layer, dramatically accelerating builds. When a container runs, a thin mutable read-write container layer is mounted on top.',
      analogy:
        'An image is like a stack of transparent plastic acetate sheets: each sheet adds specific lines or drawings. The running container is a clear sheet placed on top where temporary dry-erase edits can be made.',
      keyTakeaway:
        'Image layers are immutable and cached from bottom to top; any change invalidates all subsequent layers.',
      flashcards: [
        {
          term: 'Overlay2',
          explanation: 'The preferred union filesystem storage driver that merges lower read-only layers with a single upper read-write layer.',
          hint: 'Union filesystem',
        },
        {
          term: 'Multi-stage Build',
          explanation: 'Using multiple FROM instructions in a Dockerfile to separate build-time dependencies from the final minimal production image.',
          hint: 'Minimal runtime image',
        },
      ],
      questions: [
        {
          id: 'dk_2_mcq',
          type: 'multiple-choice',
          prompt: 'Why should dependency manifest files (e.g. package.json or Cargo.toml) be copied and installed before copying application source code in a Dockerfile?',
          options: [
            'To maximize Docker build cache reuse: code changes won’t invalidate the expensive dependency installation layer',
            'Docker will not allow source files to exist without node_modules present',
            'Overlay2 requires manifests to reside in lower layer 0',
            'Source code cannot be parsed until dependencies are registered in cgroups',
          ],
          correctIndex: 0,
          explanation:
            'Placing infrequently changed dependency manifests first ensures Docker can reuse the cached dependency layer whenever only application source code changes.',
          hint: 'Layer caching hierarchy.',
          xpReward: 15,
        },
        {
          id: 'dk_2_oe',
          type: 'open-ended',
          prompt: 'In 1-3 sentences, describe how multi-stage builds help create secure, minimal production container images.',
          minSentences: 1,
          rubric: 'Must explain compiling in a heavy build stage and copying only the compiled binary to a minimal runtime image.',
          explanation:
            'Multi-stage builds allow developers to compile code in a heavy build stage containing compilers and SDKs, then copy only the compiled binary into a clean, minimal runtime stage (such as Alpine or scratch). This shrinks image size and reduces the attack surface by eliminating build tools from production.',
          hint: 'Separation of compiler from runtime.',
          xpReward: 25,
        },
      ],
    },
    {
      id: 'dk_3',
      order: 3,
      title: 'Kubernetes Pods & Declarative Deployments',
      digest:
        'In Kubernetes, the smallest deployable atomic unit is not a container, but a Pod. A Pod encapsulates one or more closely coupled containers that share the same network namespace (including localhost and IP address), storage volumes, and lifecycle.\n\nDeployments manage Pods declaratively through an underlying ReplicaSet. You declare the desired state (e.g., 3 replicas running v2.0), and the Kubernetes Control Plane reconciliation loop continuously drives actual cluster state toward desired state via rolling updates.',
      analogy:
        'A Pod is a crew of astronauts in a single space capsule sharing the same life-support air and communication radio. A Deployment is the mission controller maintaining a fleet of identical capsules.',
      keyTakeaway:
        'Containers in the same Pod share localhost and storage volumes; Deployments enforce desired replica counts declaratively.',
      flashcards: [
        {
          term: 'Pod',
          explanation: 'The fundamental atomic execution unit in Kubernetes containing one or more containers sharing network and storage.',
          hint: 'Atomic k8s unit',
        },
        {
          term: 'Reconciliation Loop',
          explanation: 'A control loop that continuously compares current cluster state against desired state and executes corrective actions.',
          hint: 'Current vs desired state',
        },
      ],
      questions: [
        {
          id: 'dk_3_mcq',
          type: 'multiple-choice',
          prompt: 'How do two separate containers running inside the exact same Kubernetes Pod communicate with each other over the network?',
          options: [
            'Directly via localhost (127.0.0.1) on their respective distinct port bindings',
            'By resolving the external DNS name of the worker node',
            'Through an Ingress controller proxy',
            'Containers within the same Pod cannot communicate over TCP/IP',
          ],
          correctIndex: 0,
          explanation:
            'Because containers in a Pod share the same network namespace, they share the Pod IP and can communicate directly via localhost.',
          hint: 'Shared network namespace.',
          xpReward: 15,
        },
        {
          id: 'dk_3_oe',
          type: 'open-ended',
          prompt: 'In 1-3 sentences, explain what the Kubernetes kube-controller-manager does when a worker node suddenly dies.',
          minSentences: 1,
          rubric: 'Must state that it detects the node failure and schedules replacement Pods on healthy nodes to satisfy the Deployment replica count.',
          explanation:
            'When a worker node fails, the node controller detects missing heartbeats and marks the node unreachable. The Deployment controller and scheduler then trigger the creation of replacement Pods on remaining healthy nodes to maintain the configured replica count.',
          hint: 'Rescheduling and replica maintenance.',
          xpReward: 25,
        },
      ],
    },
    {
      id: 'dk_4',
      order: 4,
      title: 'Cluster Networking: Services & Ingress',
      digest:
        'Because Pods are ephemeral and receive dynamic IP addresses upon recreation, client applications cannot rely on raw Pod IPs. Kubernetes Services provide stable, persistent IP addresses and DNS names that load-balance traffic across a dynamic set of Pods.\n\nServices use label selectors to target Pods and manage an Endpoints object. Ingress controllers operate at Layer 7 (HTTP/HTTPS), providing SSL termination, path-based routing, and name-based virtual hosting to route external internet traffic into cluster Services.',
      analogy:
        'A Service is like a company’s central customer support hotline number: individual staff members (Pods) switch shifts and come and go, but the customer always dials the same phone number.',
      keyTakeaway:
        'Services provide stable Layer-4 IPs and load balancing across dynamic Pods; Ingress routes Layer-7 HTTP traffic from outside.',
      flashcards: [
        {
          term: 'ClusterIP',
          explanation: 'The default Kubernetes Service type, exposing a stable internal virtual IP accessible only within the cluster.',
          hint: 'Internal service IP',
        },
        {
          term: 'Ingress Controller',
          explanation: 'A Layer-7 proxy (e.g. NGINX, Envoy) that fulfills Ingress rules to route external HTTP traffic to internal Services.',
          hint: 'Layer-7 reverse proxy',
        },
      ],
      questions: [
        {
          id: 'dk_4_mcq',
          type: 'multiple-choice',
          prompt: 'How does a Kubernetes Service know which specific Pods should receive incoming network traffic?',
          options: [
            'It evaluates matching label selectors against Pod metadata to populate its Endpoints list',
            'The cluster administrator manually inputs each container’s MAC address',
            'All Pods deployed on the same worker node automatically receive traffic',
            'It inspects the process memory of active containers',
          ],
          correctIndex: 0,
          explanation:
            'Services query the API server using label selectors (e.g. app: backend). Matching Pods that pass readiness probes are added to the Endpoints object.',
          hint: 'Label selectors and endpoints.',
          xpReward: 15,
        },
        {
          id: 'dk_4_oe',
          type: 'open-ended',
          prompt: 'In 1-3 sentences, describe the difference between a Readiness Probe and a Liveness Probe in Kubernetes.',
          minSentences: 1,
          rubric: 'Must state that liveness restarts an unhealthy container, while readiness controls whether the Pod receives Service traffic.',
          explanation:
            'A Liveness Probe determines if a container has entered a deadlocked state and must be restarted by the kubelet. A Readiness Probe determines if a container is initialized and ready to accept network traffic; if it fails, the Pod is temporarily removed from Service endpoints without restarting.',
          hint: 'Restart vs traffic routing.',
          xpReward: 25,
        },
      ],
    },
  ];

  return {
    topic: 'Docker & Kubernetes',
    overview:
      'A progressive four-stage technical deep dive into containerization and cloud orchestration: Linux namespaces/cgroups, Dockerfiles, Pod architectures, and Kubernetes networking.',
    concepts,
  };
}

function getLinearAlgebraDecomposition(): TopicDecomposition {
  const concepts: MicroConcept[] = [
    {
      id: 'la_1',
      order: 1,
      title: 'Vectors, Basis & Linear Combinations',
      digest:
        'In linear algebra, a vector is fundamentally an element of a vector space, represented geometrically as an arrow with magnitude and direction or algebraically as an ordered tuple of coordinates. A linear combination of vectors v_1, ..., v_k is given by c_1*v_1 + ... + c_k*v_k for scalar coefficients c_i.\n\nThe span of a set of vectors is the complete set of all possible linear combinations they can form. A set of vectors forms a basis for a vector space if they are linearly independent (no vector can be written as a combination of the others) and their span covers the entire space.',
      analogy:
        'Basis vectors are like the primary colors (red, yellow, blue): they cannot be mixed from each other, and by combining them in various proportions, you can generate the entire spectrum of colors.',
      keyTakeaway:
        'A basis is a minimal set of linearly independent vectors whose linear combinations span the entire vector space.',
      flashcards: [
        {
          term: 'Span',
          explanation: 'The set of all possible linear combinations that can be generated by a given collection of vectors.',
          hint: 'Reachable subspace',
        },
        {
          term: 'Linear Independence',
          explanation: 'A property where no vector in a set can be expressed as a linear combination of the remaining vectors.',
          hint: 'No redundant vectors',
        },
      ],
      questions: [
        {
          id: 'la_1_mcq',
          type: 'multiple-choice',
          prompt: 'What must be true for a set of vectors {v_1, v_2, ..., v_n} to be linearly independent?',
          options: [
            'c_1*v_1 + c_2*v_2 + ... + c_n*v_n = 0 has only the trivial solution c_1 = c_2 = ... = c_n = 0',
            'The dot product between every pair of vectors must equal zero',
            'All vectors must have unit length (|v_i| = 1)',
            'The number of vectors must strictly equal 3',
          ],
          correctIndex: 0,
          explanation:
            'Linear independence mathematically requires that the only linear combination summing to the zero vector has all scalar coefficients equal to zero.',
          hint: 'Trivial solution definition.',
          xpReward: 15,
        },
        {
          id: 'la_1_oe',
          type: 'open-ended',
          prompt: 'In 1-3 sentences, explain why three vectors in a 2-dimensional space ℝ² can never be linearly independent.',
          minSentences: 1,
          rubric: 'Must state that the dimension of ℝ² is 2, so any set of more than 2 vectors contains redundancies.',
          explanation:
            'The dimension of ℝ² is 2, meaning any basis requires exactly two linearly independent vectors. Any third vector can always be expressed as a linear combination of the first two, making the set linearly dependent.',
          hint: 'Dimension theorem.',
          xpReward: 25,
        },
      ],
    },
    {
      id: 'la_2',
      order: 2,
      title: 'Matrices as Linear Transformations',
      digest:
        'Rather than viewing a matrix merely as a 2D spreadsheet of numbers, linear algebra interprets matrices as geometric transformations of space. A matrix A transforms an input vector x into output vector Ax while preserving vector addition A(u + v) = Au + Av and scalar multiplication A(cu) = c(Au).\n\nEvery column of a matrix represents where the corresponding standard basis vector (such as i-hat or j-hat) lands after the transformation. Matrix multiplication A * B represents the composition of transformations (applying B first, then A).',
      analogy:
        'A matrix is a function machine that warps grid lines of space: grid lines remain straight, parallel, and evenly spaced, with the origin remaining fixed at (0,0).',
      keyTakeaway:
        'A matrix transforms space; its columns specify exactly where the standard basis vectors land after transformation.',
      flashcards: [
        {
          term: 'Linear Transformation',
          explanation: 'A mapping between vector spaces that preserves vector addition and scalar multiplication.',
          hint: 'Grid-preserving transformation',
        },
        {
          term: 'Matrix Composition',
          explanation: 'Matrix product AB represents executing transformation B followed sequentially by transformation A.',
          hint: 'Sequential transformations',
        },
      ],
      questions: [
        {
          id: 'la_2_mcq',
          type: 'multiple-choice',
          prompt: 'If the columns of a 2x2 matrix are [0, 1]^T and [-1, 0]^T, what geometric transformation does this matrix perform?',
          options: [
            'A 90-degree counterclockwise rotation about the origin',
            'A horizontal stretch by a factor of 2',
            'A reflection across the line y = x',
            'A projection onto the x-axis',
          ],
          correctIndex: 0,
          explanation:
            'Standard basis vector [1, 0]^T lands at [0, 1]^T, and [0, 1]^T lands at [-1, 0]^T, which corresponds precisely to a 90-degree counterclockwise rotation.',
          hint: 'Track i-hat and j-hat movement.',
          xpReward: 15,
        },
        {
          id: 'la_2_oe',
          type: 'open-ended',
          prompt: 'In 1-3 sentences, explain why matrix multiplication is associative (A(BC) = (AB)C) but generally not commutative (AB ≠ BA).',
          minSentences: 1,
          rubric: 'Must explain that composing sequential transformations produces the same outcome regardless of grouping, but changing order alters the sequence of geometric actions.',
          explanation:
            'Matrix multiplication represents function composition: grouping operations does not alter the sequential pipeline of actions, making it associative. However, changing the order of geometric actions (like rotating then shearing versus shearing then rotating) produces completely different final spatial configurations, so it is not commutative.',
          hint: 'Geometric transformation ordering.',
          xpReward: 25,
        },
      ],
    },
    {
      id: 'la_3',
      order: 3,
      title: 'Determinants, Rank & Matrix Invertibility',
      digest:
        'The determinant det(A) of a square matrix measures how much the linear transformation scales the area (in 2D) or volume (in higher dimensions) of a unit region. A negative determinant indicates that the spatial orientation has been flipped (like looking through a mirror).\n\nIf det(A) = 0, the transformation squashes space into a lower dimension (e.g. flattening a 2D plane into a 1D line), meaning multiple distinct vectors map to the same point. Consequently, a matrix is invertible if and only if its determinant is non-zero and it has full rank.',
      analogy:
        'The determinant is like a zoom-lens scaling factor: a factor of 2 doubles the size of a photo; a factor of 0 squashes the entire image into an unrecoverable flat dot.',
      keyTakeaway:
        'The determinant measures volume scaling factor; a zero determinant means space was squashed into lower dimensions, destroying invertibility.',
      flashcards: [
        {
          term: 'Determinant',
          explanation: 'A scalar value representing the signed volume scaling factor of a square matrix transformation.',
          hint: 'Volume scaling factor',
        },
        {
          term: 'Matrix Rank',
          explanation: 'The maximum number of linearly independent column vectors, representing the dimension of the transformation output.',
          hint: 'Output space dimension',
        },
      ],
      questions: [
        {
          id: 'la_3_mcq',
          type: 'multiple-choice',
          prompt: 'What does a determinant of det(A) = 0 indicate about the system of linear equations Ax = b?',
          options: [
            'The matrix A is singular and cannot be inverted; the system has either zero solutions or infinitely many solutions',
            'The system always has exactly one unique solution',
            'All eigenvalues of A must be equal to 1',
            'The matrix columns form an orthonormal basis',
          ],
          correctIndex: 0,
          explanation:
            'When det(A) = 0, the matrix loses full rank and cannot be inverted, meaning the transformation squashed dimensions and unique inverses do not exist.',
          hint: 'Singular matrix properties.',
          xpReward: 15,
        },
        {
          id: 'la_3_oe',
          type: 'open-ended',
          prompt: 'In 1-3 sentences, explain geometrically what the Null Space (Kernel) of a matrix represents.',
          minSentences: 1,
          rubric: 'Must state that null space consists of all vectors that are squashed to the zero vector by the transformation.',
          explanation:
            'The Null Space (Kernel) of a matrix A consists of all input vectors x that the linear transformation squashes directly into the zero vector (Ax = 0). If the determinant is zero, the null space contains non-zero vectors corresponding to the dimensions collapsed during transformation.',
          hint: 'Vectors mapped to zero.',
          xpReward: 25,
        },
      ],
    },
    {
      id: 'la_4',
      order: 4,
      title: 'Eigenvalues & Eigenvectors: Invariant Directions',
      digest:
        'When a matrix transforms space, most vectors change both their length and direction. However, certain special vectors maintain their exact directional line, experiencing only stretching, shrinking, or reversal. These special vectors are called Eigenvectors.\n\nThe characteristic equation is defined as A*v = λ*v, where v is the eigenvector and scalar λ is the corresponding eigenvalue. Solving det(A - λI) = 0 finds the eigenvalues, which form the foundation of Principal Component Analysis (PCA), stability analysis, and quantum mechanics.',
      analogy:
        'Consider a spinning globe: most points on the surface are rotating in circular paths, but the north-south rotational axis points in the exact same direction before and after rotation. That axis is the eigenvector.',
      keyTakeaway:
        'Eigenvectors are vectors whose directions remain invariant under a linear transformation, scaled by their corresponding eigenvalue λ.',
      flashcards: [
        {
          term: 'Eigenvector',
          explanation: 'A non-zero vector v that only gets scaled by a constant factor λ when transformed by matrix A (Av = λv).',
          hint: 'Directional invariant',
        },
        {
          term: 'Characteristic Equation',
          explanation: 'det(A - λI) = 0, the polynomial equation used to compute the eigenvalues of square matrix A.',
          hint: 'det(A - λI) = 0',
        },
      ],
      questions: [
        {
          id: 'la_4_mcq',
          type: 'multiple-choice',
          prompt: 'In the fundamental equation Av = λv, what does an eigenvalue of λ = -1 imply about the transformation of eigenvector v?',
          options: [
            'The vector v maintains its directional span but has its orientation reversed (flipped 180 degrees) with no change in length',
            'The vector v is squashed to the zero vector',
            'The vector v rotates by exactly 90 degrees',
            'The matrix A has an imaginary trace',
          ],
          correctIndex: 0,
          explanation:
            'An eigenvalue of -1 scales the vector by -1, pointing it in the exact opposite direction along its original line of action without changing magnitude.',
          hint: 'Negative scalar scaling.',
          xpReward: 15,
        },
        {
          id: 'la_4_oe',
          type: 'open-ended',
          prompt: 'In 1-3 sentences, explain why finding the eigenvectors of a covariance matrix is central to Principal Component Analysis (PCA).',
          minSentences: 1,
          rubric: 'Must state that eigenvectors of the covariance matrix identify the orthogonal directions of maximum data variance.',
          explanation:
            'In PCA, the eigenvectors of the data covariance matrix identify the orthogonal axes along which the data exhibits the greatest variance. The corresponding eigenvalues quantify the amount of variance captured along each axis, allowing high-dimensional data to be projected onto the most informative components.',
          hint: 'Directions of maximal variance.',
          xpReward: 25,
        },
      ],
    },
  ];

  return {
    topic: 'Linear Algebra',
    overview:
      'A progressive four-stage geometric and algebraic journey through vectors & bases, linear transformations, determinants & rank, and eigenvalues & eigenvectors.',
    concepts,
  };
}

/**
 * Procedural fallback engine for arbitrary topics.
 */
function getProceduralTopicDecomposition(topic: string): TopicDecomposition {
  const clean = topic.trim();

  const concepts: MicroConcept[] = [
    {
      id: 'proc_1',
      order: 1,
      title: `${clean}: Core Foundations & Architecture`,
      digest:
        `Mastering ${clean} begins with understanding its foundational invariants and core architectural primitives. Every robust technical system establishes clear boundaries, explicit contracts, and predictable data flow.\n\nBy formalizing these structural components early, developers avoid high-friction architectural regressions. ${clean} establishes explicit lifecycle guarantees that simplify debugging and enable composable system integration.`,
      analogy:
        `Think of ${clean} foundations like the structural steel framing of a skyscraper: invisible in daily operations, but determining the load-bearing capacity of everything built above it.`,
      keyTakeaway:
        `Establish clear boundary invariants and isolate foundational state before adding operational complexity.`,
      flashcards: [
        {
          term: `${clean} Primitive`,
          explanation: `The atomic structural unit or fundamental building block of ${clean}.`,
          hint: `Core primitive`,
        },
        {
          term: `State Invariant`,
          explanation: `A condition that must always remain true throughout execution of ${clean} operations.`,
          hint: `Consistency rule`,
        },
      ],
      questions: [
        {
          id: 'proc_1_mcq',
          type: 'multiple-choice',
          prompt: `In the architectural model of ${clean}, what is the primary benefit of maintaining strict boundary isolation?`,
          options: [
            'It prevents unhandled state leaks and minimizes cognitive overhead when modifying subsystems',
            'It eliminates the need for unit testing',
            'It forces all execution into single-threaded blocking loops',
            'It bypasses memory allocation limits',
          ],
          correctIndex: 0,
          explanation:
            'Strict boundary isolation localizes faults, prevents unintended side effects, and preserves clear component contracts.',
          hint: 'Separation of concerns.',
          xpReward: 15,
        },
        {
          id: 'proc_1_oe',
          type: 'open-ended',
          prompt: `In 1-3 sentences, explain why defining explicit invariants is critical when designing systems with ${clean}.`,
          minSentences: 1,
          rubric: `Must explain that invariants guarantee valid system states and prevent data corruption or runtime faults.`,
          explanation:
            `Explicit invariants ensure that ${clean} remains in a provably correct state before and after state transitions. Without strict invariants, unexpected edge cases introduce silent data corruption and cascading failures across subsystems.`,
          hint: 'System predictability and correctness.',
          xpReward: 25,
        },
      ],
    },
    {
      id: 'proc_2',
      order: 2,
      title: `${clean}: Operational Mechanics & Flow`,
      digest:
        `Once the foundational structures are in place, operational mechanics dictate how ${clean} handles inputs, transitions state, and produces verifiable outputs. Efficient execution pipelines minimize intermediate buffering and avoid redundant synchronization.\n\nObservability and predictable error propagation are crucial here. When operations fail in ${clean}, failures must be communicated through deterministic error channels rather than unhandled side-effects.`,
      analogy:
        `Operational flow in ${clean} resembles a modern automated logistics hub: packages are routed through designated sorting lanes with real-time tracking rather than piled haphazardly on one conveyor.`,
      keyTakeaway:
        `Design state transitions as predictable, unidirectional workflows with deterministic error handling.`,
      flashcards: [
        {
          term: `Execution Pipeline`,
          explanation: `The ordered sequence of processing stages through which inputs pass in ${clean}.`,
          hint: 'Staged processing',
        },
        {
          term: `Deterministic Error`,
          explanation: `An error mode that yields identical diagnostic information whenever the same failure condition recurs.`,
          hint: 'Reproducible failure',
        },
      ],
      questions: [
        {
          id: 'proc_2_mcq',
          type: 'multiple-choice',
          prompt: `What is the recommended design pattern for managing state transitions in ${clean}?`,
          options: [
            'Unidirectional data flow with explicit transition triggers',
            'Allowing arbitrary direct mutation of shared state from any component',
            'Silently ignoring failed operations to prevent process interruption',
            'Duplicating mutable copies across all execution threads',
          ],
          correctIndex: 0,
          explanation:
            'Unidirectional data flow guarantees traceability, simplifies time-travel debugging, and prevents circular dependency deadlocks.',
          hint: 'Predictable state transitions.',
          xpReward: 15,
        },
        {
          id: 'proc_2_oe',
          type: 'open-ended',
          prompt: `In 1-3 sentences, explain how error handling in ${clean} should balance resilience with immediate fail-fast semantics.`,
          minSentences: 1,
          rubric: `Must explain failing fast on unrecoverable invariant violations while gracefully recovering from transient I/O faults.`,
          explanation:
            `In ${clean}, unrecoverable invariant violations should fail fast to prevent corrupted state propagation. Transient operational faults (such as network drops or timeouts) should be retried with exponential backoff or degraded gracefully.`,
          hint: 'Fail-fast vs graceful degradation.',
          xpReward: 25,
        },
      ],
    },
    {
      id: 'proc_3',
      order: 3,
      title: `${clean}: Concurrency, Scaling & Invariants`,
      digest:
        `Scaling ${clean} to support high throughput or concurrent workloads exposes concurrency hazards such as race conditions, contention, and resource starvation. Engineering for concurrency demands immutable data structures or finely scoped locking primitives.\n\nHorizontal scalability requires decoupling state from execution workers. By converting shared mutable dependencies into distributed or partitioned queues, ${clean} scales smoothly under exponential load.`,
      analogy:
        `Scaling concurrency without coordination is like a crowded intersection without traffic lights: more cars only cause a gridlock. Adding designated lanes and traffic signals restores maximum flow.`,
      keyTakeaway:
        `Prefer immutability and message passing over shared mutable state to avoid concurrency bottlenecks.`,
      flashcards: [
        {
          term: `Race Condition`,
          explanation: `A flaw where system output depends unpredictably on the uncontrollable execution order of concurrent threads.`,
          hint: 'Unsynchronized timing bug',
        },
        {
          term: `Backpressure`,
          explanation: `A flow-control mechanism signaling upstream producers to slow down when downstream consumers are saturated.`,
          hint: 'Flow control signal',
        },
      ],
      questions: [
        {
          id: 'proc_3_mcq',
          type: 'multiple-choice',
          prompt: `When scaling ${clean} under heavy concurrent loads, what architectural practice best prevents race conditions?`,
          options: [
            'Relying on immutable data structures and isolated message passing',
            'Increasing CPU clock speed without modifying synchronization logic',
            'Eliminating timeouts to allow threads to wait indefinitely',
            'Sharing mutable references without synchronization locks',
          ],
          correctIndex: 0,
          explanation:
            'Immutability inherently prevents race conditions because data cannot be modified while being read by other workers.',
          hint: 'Immutability prevents race conditions.',
          xpReward: 15,
        },
        {
          id: 'proc_3_oe',
          type: 'open-ended',
          prompt: `In 1-3 sentences, explain how applying backpressure protects ${clean} from catastrophic out-of-memory failures.`,
          minSentences: 1,
          rubric: `Must explain that backpressure limits inbound buffer growth by signaling producers to throttle transmission.`,
          explanation:
            `When consumer processing lags behind input arrival, unbounded queues quickly deplete available system memory. Backpressure throttles upstream producers, keeping queue sizes bounded and preventing out-of-memory crashes.`,
          hint: 'Queue saturation and producer throttling.',
          xpReward: 25,
        },
      ],
    },
    {
      id: 'proc_4',
      order: 4,
      title: `${clean}: Production Systems & Synthesis`,
      digest:
        `In production environments, ${clean} must integrate with monitoring telemetry, health checks, and automated CI/CD pipelines. True mastery involves synthesizing operational knowledge to diagnose subtle edge cases and performance bottlenecks.\n\nContinuous observability through metrics, structured logs, and distributed traces enables rapid root-cause analysis. Proactive profiling and chaos testing ensure ${clean} remains resilient under unpredictable real-world workloads.`,
      analogy:
        `Deploying ${clean} without telemetry is like flying an aircraft through heavy fog without cockpit instruments: you might stay airborne for a while, but navigating safely is impossible.`,
      keyTakeaway:
        `Instrument comprehensive telemetry and design for observability before deploying to production.`,
      flashcards: [
        {
          term: `Distributed Tracing`,
          explanation: `Tracking the journey of requests across multiple services to diagnose latency bottlenecks and failures.`,
          hint: 'Cross-service request tracking',
        },
        {
          term: `Chaos Engineering`,
          explanation: `Deliberately injecting turbulent conditions into production to verify system resilience and recovery.`,
          hint: 'Intentional fault injection',
        },
      ],
      questions: [
        {
          id: 'proc_4_mcq',
          type: 'multiple-choice',
          prompt: `What is the primary purpose of incorporating distributed tracing into ${clean}?`,
          options: [
            'To pinpoint the exact subsystem causing latency or failure in distributed request workflows',
            'To automatically write unit test suites',
            'To replace operating system security patches',
            'To compress network payloads over TCP',
          ],
          correctIndex: 0,
          explanation:
            'Distributed tracing provides end-to-end visibility into request flows, revealing exactly where bottlenecks and errors occur.',
          hint: 'End-to-end request visibility.',
          xpReward: 15,
        },
        {
          id: 'proc_4_oe',
          type: 'open-ended',
          prompt: `In 1-3 sentences, explain how synthesizing metrics, logs, and traces creates an effective observability strategy for ${clean}.`,
          minSentences: 1,
          rubric: `Must explain that metrics detect anomalies, traces isolate the offending component, and logs reveal the root cause.`,
          explanation:
            `Metrics provide real-time aggregate alerts when system performance degrades. Traces isolate the exact service or function causing the delay, and structured logs provide contextual detail to diagnose the root cause.`,
          hint: 'The three pillars of observability.',
          xpReward: 25,
        },
      ],
    },
  ];

  return {
    topic: clean,
    overview: `A progressive four-stage technical masterclass in ${clean}, from foundational invariants to operational mechanics, concurrency scaling, and production synthesis.`,
    concepts,
  };
}
