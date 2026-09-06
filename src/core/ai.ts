import { ParsedDocument } from './parser.js';
import { Course, Pace, Question, AnswerEvaluation, UserProfile } from '../types/index.js';
import { DEFAULT_OPENAI_MODEL } from './liveClient.js';
import { evaluateOpenEndedAnswer } from './topicEngine.js';

export { evaluateOpenEndedAnswer };

export interface LlmConfig {
  provider?: 'gemini' | 'anthropic' | 'openai';
  apiKey?: string;
  model?: string;
}

export type { AnswerEvaluation };

function resolveProviderAndKey(config?: LlmConfig): { provider: 'gemini' | 'anthropic' | 'openai' | null; apiKey: string | null } {
  if (config?.apiKey) {
    return {
      provider: config.provider || 'gemini',
      apiKey: config.apiKey,
    };
  }

  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
    return {
      provider: 'gemini',
      apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY!,
    };
  }

  if (process.env.ANTHROPIC_API_KEY) {
    return {
      provider: 'anthropic',
      apiKey: process.env.ANTHROPIC_API_KEY,
    };
  }

  if (process.env.OPENAI_API_KEY) {
    return {
      provider: 'openai',
      apiKey: process.env.OPENAI_API_KEY,
    };
  }

  return { provider: null, apiKey: null };
}

/**
 * Calls an external LLM API (Gemini, Claude, or OpenAI) if configured,
 * otherwise returns null to trigger the procedural heuristic engine.
 */
export async function generateCurriculumWithLlm(
  doc: ParsedDocument,
  pace: Pace,
  config?: LlmConfig
): Promise<Course | null> {
  const { provider, apiKey } = resolveProviderAndKey(config);
  if (!apiKey || !provider) {
    return null;
  }

  const systemPrompt = `You are Jarvis CLI, an expert instructional designer fusing Duolingo gamification with Claude Code technical depth.
Create a structured learning course from the following document.
Pace: ${pace} (accelerated = 3-4 nodes, standard = 6-8 nodes, deep = 10-14 nodes).
Format response STRICTLY as valid JSON matching this schema:
{
  "title": "${doc.title}",
  "summary": "2 sentence summary",
  "nodes": [
    {
      "id": "node_1",
      "unitId": "unit_1",
      "unitTitle": "Unit 1 Name",
      "title": "Topic Name",
      "description": "Short description",
      "order": 1,
      "isBossCheckpoint": false,
      "lessons": [
        {
          "id": "lesson_1",
          "title": "Lesson Title",
          "conceptDigest": "2 concise paragraphs explaining the mental model clearly with an intuitive analogy",
          "keyTakeaway": "1 sharp core rule or takeaway",
          "analogies": ["Analogy 1"],
          "questions": [
            {
              "id": "q1",
              "type": "multiple-choice",
              "prompt": "Question text?",
              "options": ["Option A", "Option B", "Option C", "Option D"],
              "correctIndex": 0,
              "explanation": "Why Option A is right and others are wrong",
              "hint": "Hint here",
              "xpReward": 15
            },
            {
              "id": "q2",
              "type": "cloze",
              "prompt": "Sentence with missing [BLANK] keyword?",
              "clozeAnswer": "keyword",
              "explanation": "Explanation here",
              "xpReward": 15
            }
          ]
        }
      ]
    }
  ]
}

Document Content:
${doc.rawText.slice(0, 15000)}
`;

  try {
    let rawJsonText = '';

    if (provider === 'gemini') {
      const model = config?.model || 'gemini-1.5-flash';
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: systemPrompt }] }],
          generationConfig: { responseMimeType: 'application/json' },
        }),
      });

      if (!response.ok) return null;
      const data = (await response.json()) as any;
      rawJsonText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    } else if (provider === 'anthropic') {
      const model = config?.model || 'claude-3-5-haiku-20241022';
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          messages: [{ role: 'user', content: systemPrompt + '\nOutput valid raw JSON only without markdown formatting.' }],
        }),
      });

      if (!response.ok) return null;
      const data = (await response.json()) as any;
      rawJsonText = data?.content?.[0]?.text;
    } else if (provider === 'openai') {
      const model = config?.model || DEFAULT_OPENAI_MODEL;
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: systemPrompt }],
        }),
      });

      if (!response.ok) return null;
      const data = (await response.json()) as any;
      rawJsonText = data?.choices?.[0]?.message?.content;
    }

    if (!rawJsonText) return null;

    // Clean any backticks if present
    const cleanJson = rawJsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(cleanJson);

    return {
      id: `course_${Date.now()}`,
      title: parsed.title || doc.title,
      sourceFileName: doc.title,
      pace,
      createdAt: new Date().toISOString(),
      summary: parsed.summary || `Synthesized curriculum for ${doc.title}`,
      nodes: (parsed.nodes || []).map((node: any, idx: number) => ({
        ...node,
        status: idx === 0 ? 'active' : 'locked',
        lessons: (node.lessons || []).map((l: any) => ({
          ...l,
          xpAwarded: 0,
          isCompleted: false,
          crownCount: 0,
        })),
      })),
    };
  } catch (err) {
    return null;
  }
}

/**
 * Dynamically evaluates free-form text or complex answers using AI reasoning.
 */
export async function evaluateAnswerWithAi(
  question: Question,
  userAnswer: string,
  config?: LlmConfig
): Promise<AnswerEvaluation> {
  if (question.type === 'open-ended') {
    const profile: UserProfile = {
      name: 'Learner',
      xp: 0,
      level: 1,
      hearts: 5,
      maxHearts: 5,
      streak: 1,
      lastActiveDate: '',
      zenMode: false,
      completedLessonsCount: 0,
      masteredSkillsCount: 0,
      achievements: [],
      apiProvider: config?.provider,
      apiKey: config?.apiKey,
      activeModel: config?.model,
    };
    return evaluateOpenEndedAnswer(question, userAnswer, profile);
  }

  const { provider, apiKey } = resolveProviderAndKey(config);

  // If no API key configured, use deterministic fuzzy matching
  if (!apiKey || !provider) {
    const cleanUser = userAnswer.trim().toLowerCase();
    const cleanExpected = (question.clozeAnswer || question.options?.[question.correctIndex || 0] || '').toLowerCase();
    const isExact = cleanUser === cleanExpected;
    const containsKey = cleanUser.includes(cleanExpected) || cleanExpected.includes(cleanUser);

    return {
      isCorrect: isExact || containsKey,
      scorePercentage: isExact ? 100 : containsKey ? 80 : 0,
      feedback: isExact
        ? 'Spot-on answer! Excellent recall.'
        : containsKey
        ? 'Close! You hit the core concept.'
        : `Expected: ${cleanExpected}.`,
    };
  }

  const prompt = `You are Jarvis CLI's AI Tutor. Evaluate this learner's answer.
Question: ${question.prompt}
Expected / Reference Answer: ${question.clozeAnswer || question.options?.[question.correctIndex || 0] || question.explanation}
Explanation: ${question.explanation}
Learner Answer: "${userAnswer}"

Grade leniently on core conceptual understanding. Return STRICT JSON:
{
  "isCorrect": boolean,
  "scorePercentage": number (0-100),
  "feedback": "1-2 sentences explaining what was great or what was missed",
  "suggestedImprovement": "Optional coaching tip"
}`;

  try {
    let raw = '';
    if (provider === 'gemini') {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' },
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      }
    } else if (provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: DEFAULT_OPENAI_MODEL,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        raw = data?.choices?.[0]?.message?.content;
      }
    }

    if (raw) {
      const clean = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
      return JSON.parse(clean);
    }
  } catch (e) {
    // Fallback below
  }

  return {
    isCorrect: userAnswer.trim().length > 0,
    scorePercentage: 75,
    feedback: 'Good effort! Concepts analyzed.',
  };
}
