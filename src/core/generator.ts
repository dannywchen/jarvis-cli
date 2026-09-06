import { ParsedDocument } from './parser.js';
import { Course, Pace, SkillNode, Lesson, Question, MatchPair } from '../types/index.js';
import { generateCurriculumWithLlm, LlmConfig } from './ai.js';
import { normalizeLearningIntent } from './learningEngine.js';

interface KeywordFact {
  term: string;
  definition: string;
  contextSentence: string;
}

/**
 * Extracts key technical definitions and sentences from the text.
 */
function extractFacts(text: string): KeywordFact[] {
  const sentences = text
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 25 && s.length < 220);

  const facts: KeywordFact[] = [];
  const definitionPatterns = [
    /^(?:the\s+)?([A-Z][a-zA-Z0-9_-]+(?:\s+[a-zA-Z0-9_-]+)?)\s+(?:is|are|refers to|represents|denotes|serves as|is defined as)\s+(.+)$/i,
    /([A-Za-z0-9_-]+)\s+enables\s+(.+)$/i,
    /([A-Za-z0-9_-]+)\s+allows\s+(.+)$/i,
    /([A-Za-z0-9_-]+):\s*(.+)$/i,
  ];

  for (const sentence of sentences) {
    for (const pattern of definitionPatterns) {
      const match = sentence.match(pattern);
      if (match && match[1] && match[2]) {
        const term = match[1].replace(/^(a|an|the)\s+/i, '').trim();
        const definition = match[2].trim().replace(/\.$/, '');
        if (term.length > 2 && term.length < 35 && definition.length > 15) {
          facts.push({
            term,
            definition,
            contextSentence: sentence,
          });
          break;
        }
      }
    }
  }

  return facts;
}

/**
 * Extracts standout keywords from text.
 */
function extractKeywords(text: string): string[] {
  const words = text.match(/\b[A-Za-z][A-Za-z0-9_-]{3,20}\b/g) || [];
  const stopWords = new Set([
    'this', 'that', 'with', 'from', 'have', 'were', 'which', 'their', 'about', 'there',
    'would', 'could', 'these', 'other', 'after', 'first', 'also', 'where', 'being', 'using',
    'between', 'through', 'during', 'before', 'should', 'under', 'while', 'state', 'system',
  ]);

  const freq = new Map<string, number>();
  for (const w of words) {
    const lower = w.toLowerCase();
    if (!stopWords.has(lower) && !/^\d+$/.test(lower)) {
      freq.set(lower, (freq.get(lower) || 0) + 1);
    }
  }

  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([w]) => w.charAt(0).toUpperCase() + w.slice(1));
}

/**
 * Procedurally generates a comprehensive course from the parsed document.
 */
export async function generateCourse(
  doc: ParsedDocument,
  pace: Pace = 'standard',
  config?: LlmConfig
): Promise<Course> {
  // 1. Try LLM first if API key is provided
  const llmCourse = await generateCurriculumWithLlm(doc, pace, config);
  if (llmCourse) {
    return llmCourse;
  }

  // 2. Procedural Heuristic Synthesizer
  const facts = extractFacts(doc.rawText);
  const keywords = extractKeywords(doc.rawText);
  const sectionCount = doc.sections.length;

  let targetNodeCount = 6;
  if (pace === 'accelerated') targetNodeCount = Math.min(4, Math.max(3, sectionCount));
  else if (pace === 'deep') targetNodeCount = Math.min(12, Math.max(8, sectionCount * 2));
  else targetNodeCount = Math.min(8, Math.max(5, sectionCount));

  const nodes: SkillNode[] = [];
  const unitsCount = pace === 'deep' ? 3 : pace === 'standard' ? 2 : 1;
  const nodesPerUnit = Math.ceil(targetNodeCount / unitsCount);

  for (let i = 0; i < targetNodeCount; i++) {
    const isBoss = (i + 1) % nodesPerUnit === 0 || i === targetNodeCount - 1;
    const unitIndex = Math.min(unitsCount, Math.floor(i / nodesPerUnit) + 1);
    const unitTitle =
      unitIndex === 1
        ? 'Unit 1: Foundations & Core Principles'
        : unitIndex === 2
        ? 'Unit 2: Architectural Mechanics & Workflows'
        : 'Unit 3: Advanced Applications & Synthesis';

    const sec = doc.sections[i % doc.sections.length];
    const nodeTitle = isBoss
      ? `⚔️ Checkpoint: ${sec?.title || 'Mastery Evaluation'}`
      : sec?.title || `Core Concept ${i + 1}: ${keywords[i % keywords.length] || 'Mechanics'}`;

    const contentSnippet = sec?.content || doc.rawText.slice(i * 500, (i + 1) * 500);
    const nodeFacts = facts.filter((f) => contentSnippet.includes(f.term) || Math.random() > 0.6).slice(0, 3);

    // Build lessons for this node
    const lessons: Lesson[] = [
      generateBiteSizedLesson(
        `lesson_${i}_1`,
        `${nodeTitle.replace(/^[⚔️\s]+/, '')} Fundamentals`,
        contentSnippet,
        nodeFacts,
        keywords,
        isBoss
      ),
    ];

    if (pace === 'deep' && !isBoss) {
      lessons.push(
        generateBiteSizedLesson(
          `lesson_${i}_2`,
          `Practical Application & Deep Dive`,
          contentSnippet.slice(300),
          nodeFacts,
          keywords,
          false
        )
      );
    }

    nodes.push({
      id: `node_${i + 1}`,
      unitId: `unit_${unitIndex}`,
      unitTitle,
      title: nodeTitle,
      description: isBoss ? 'Test your mastery of this unit in a high-stakes challenge.' : `Understand the core principles and models of ${nodeTitle}.`,
      order: i + 1,
      status: i === 0 ? 'active' : 'locked',
      lessons,
      isBossCheckpoint: isBoss,
    });
  }

  return {
    id: `course_${Date.now()}`,
    title: doc.title,
    sourceFileName: doc.sourcePath,
    pace,
    createdAt: new Date().toISOString(),
    summary: `Comprehensive ${pace} learning track synthesized from ${doc.title} (${doc.wordCount} words).`,
    nodes,
    intent: normalizeLearningIntent(config?.intent, doc.title),
    currentNodeId: nodes[0]?.id,
  };
}

function generateBiteSizedLesson(
  id: string,
  title: string,
  contentSnippet: string,
  facts: KeywordFact[],
  keywords: string[],
  isBoss: boolean
): Lesson {
  const sentences = contentSnippet
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);

  const digestParagraphs = sentences.slice(0, 3).join(' ') || 'This module covers foundational principles and their practical applications.';
  const keyTakeaway = sentences[3] || 'Mastering the relationship between components is essential for reliable reasoning.';

  const questions: Question[] = [];

  // Question 1: Multiple Choice
  const primeFact = facts[0] || {
    term: keywords[0] || 'State Architecture',
    definition: 'coordinates transitions between discrete functional stages',
    contextSentence: 'The system regulates transitions across operations.',
  };

  const distractor1 = facts[1]?.definition || 'manages garbage collection and process scheduling';
  const distractor2 = facts[2]?.definition || 'renders visual elements onto the graphic pipeline';
  const distractor3 = 'stores immutable configuration variables in cache';

  questions.push({
    id: `${id}_q1`,
    type: 'multiple-choice',
    prompt: `What is the primary role or definition of "${primeFact.term}"?`,
    options: [
      primeFact.definition,
      distractor1,
      distractor2,
      distractor3,
    ].sort(() => Math.random() - 0.5),
    get correctIndex() {
      return this.options!.indexOf(primeFact.definition);
    },
    explanation: `"${primeFact.term}" is defined as: ${primeFact.definition}.`,
    hint: `Look at the context: "${primeFact.contextSentence.slice(0, 80)}..."`,
    xpReward: isBoss ? 25 : 15,
  });

  // Question 2: Cloze (Fill-in-the-blank)
  const clozeWord = primeFact.term.split(/\s+/)[0] || keywords[1] || 'Process';
  const clozeSentence = primeFact.contextSentence.includes(clozeWord)
    ? primeFact.contextSentence.replace(new RegExp(`\\b${clozeWord}\\b`, 'i'), '_____')
    : `In this architecture, the _____ ${primeFact.definition}.`;

  questions.push({
    id: `${id}_q2`,
    type: 'cloze',
    prompt: `Fill in the missing technical term:\n"${clozeSentence}"`,
    clozeAnswer: clozeWord.toLowerCase(),
    explanation: `The missing keyword is "${clozeWord}".`,
    hint: `Starts with "${clozeWord[0]}" (${clozeWord.length} letters)`,
    xpReward: isBoss ? 25 : 15,
  });

  // Question 3: Scenario or Match
  if (facts.length >= 2) {
    const pairs: MatchPair[] = facts.slice(0, 3).map((f) => ({
      term: f.term,
      definition: f.definition.slice(0, 60),
    }));

    questions.push({
      id: `${id}_q3`,
      type: 'match',
      prompt: 'Match each concept to its functional description:',
      matchPairs: pairs,
      explanation: 'Great job connecting each component to its technical responsibility.',
      xpReward: isBoss ? 30 : 20,
    });
  } else {
    questions.push({
      id: `${id}_q3`,
      type: 'scenario',
      prompt: `Scenario: If you need to optimize ${primeFact.term} for high throughput, what principle should you apply?`,
      options: [
        `Align component boundaries with ${primeFact.definition.slice(0, 40)}`,
        'Bypass verification steps and eliminate caching layers',
        'Convert synchronous streams into blocking sequential loops',
        'Duplicate mutable state across all isolated environments',
      ],
      correctIndex: 0,
      explanation: `Correct architectural scaling requires aligning boundaries directly with the core role (${primeFact.term}).`,
      hint: 'Think about maintaining separation of concerns.',
      xpReward: isBoss ? 30 : 20,
    });
  }

  return {
    id,
    title,
    conceptDigest: digestParagraphs,
    keyTakeaway,
    analogies: [`Think of ${primeFact.term} like a railway conductor: ensuring packets and signals reach their destination safely.`],
    questions,
    xpAwarded: 0,
    isCompleted: false,
    crownCount: 0,
  };
}
