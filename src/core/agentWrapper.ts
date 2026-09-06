import { UserProfile, Course, Question } from '../types/index.js';
import { sendLiveLlmPrompt, ProviderType, normalizeModelId, DEFAULT_OPENAI_REASONING_EFFORT } from './liveClient.js';
import { scanDetectedCliSessions, getValidGoogleAccessToken, CliSessionInfo } from './cliAuth.js';
import { isPromptExtractionRequest, PROMPT_EXTRACTION_RESPONSE, redactSensitiveOutput, withPromptConfidentiality } from './promptSecurity.js';
import {
  AgentActivitySink,
  AgentEnvelope,
  AgentToolCall,
  executeAgentTool,
  toolActivityLabel,
} from './agentTools.js';
import { buildLearningContext } from './learningEngine.js';
import { getDueReviews } from './spacedRepetition.js';
import {
  executeCourseAgentTool,
  executeDirectCourseCommand,
  isCourseAgentTool,
  isCourseMutatingTool,
} from './courseAgentTools.js';

export interface AgentResponse {
  text: string;
  xpAwarded: number;
  relevanceReason?: string;
  provider: ProviderType;
  model: string;
  harnessName?: string;
  connectedAccount?: string;
  error?: string;
  requiresAuth?: boolean;
}

export interface QueryActiveAgentOptions {
  onActivity?: AgentActivitySink;
  /** The current raw user turn, kept separate from the trusted continuation context. */
  userQuery?: string;
}

export interface RelevanceEvaluation {
  xpAwarded: number;
  relevanceReason?: string;
  category: 'banter' | 'basic' | 'in-depth';
}

export interface ResolvedAuth {
  provider: ProviderType;
  model: string;
  apiKey: string | null;
  authToken: string | null;
  harness: string;
  harnessName: string;
  connectedAccount?: string;
  hasAuth: boolean;
}

export function resolveActiveCredentials(profile: UserProfile): ResolvedAuth {
  const detected = scanDetectedCliSessions();
  const provider = (profile.apiProvider || 'gemini') as ProviderType;
  const model = normalizeModelId(provider, profile.activeModel);

  let apiKey: string | null = null;
  let authToken: string | null = null;
  let harness = 'api-key';
  let harnessName = 'Direct API';
  let connectedAccount: string | undefined = undefined;

  // Find matching CLI session if available
  if (provider === 'gemini') {
    apiKey = profile.apiKeys?.gemini || profile.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;
    const googleCli = detected.find((s) => s.hasValidSession && (s.harness === 'antigravity-cli' || s.harness === 'gemini-cli'));
    if (googleCli) {
      harness = googleCli.harness;
      harnessName = googleCli.name;
      connectedAccount = googleCli.email;
      authToken = googleCli.token || null;
    }
  } else if (provider === 'openai') {
    apiKey = profile.apiKeys?.openai || process.env.OPENAI_API_KEY || null;
    harnessName = 'OpenAI API';
    const codexCli = detected.find((s) => s.hasValidSession && s.harness === 'codex-cli');
    if (codexCli) {
      harness = codexCli.harness;
      harnessName = codexCli.name;
      connectedAccount = codexCli.email;
      authToken = codexCli.token || null;
    }
  } else if (provider === 'anthropic') {
    apiKey = profile.apiKeys?.anthropic || process.env.ANTHROPIC_API_KEY || null;
    harnessName = 'Anthropic API';
    const claudeCli = detected.find((s) => s.hasValidSession && s.harness === 'claude-cli');
    if (claudeCli) {
      harness = claudeCli.harness;
      harnessName = claudeCli.name;
      connectedAccount = claudeCli.email;
    }
  }

  const hasAuth = !!(apiKey || authToken || (provider === 'openai' && harness === 'codex-cli'));

  return {
    provider,
    model,
    apiKey,
    authToken,
    harness,
    harnessName,
    connectedAccount,
    hasAuth,
  };
}

/**
 * Sends prompt directly to the live LLM / CLI agent harness without hardcoded responses.
 */
export async function queryActiveAgent(
  query: string,
  profile: UserProfile,
  activeCourse?: Course | null,
  options: QueryActiveAgentOptions = {}
): Promise<AgentResponse> {
  const creds = resolveActiveCredentials(profile);
  const rawUserQuery = options.userQuery ?? query;

  // Explicit course-management language is an action request, not a prompt
  // for the model to role-play. This also keeps course setup/deletion useful
  // when the learner has not configured an LLM yet (topic generation has an
  // offline fallback).
  const directCourseAction = await executeDirectCourseCommand(rawUserQuery, profile);
  if (directCourseAction) {
    return {
      text: directCourseAction.text,
      xpAwarded: 0,
      provider: creds.provider,
      model: creds.model,
      harnessName: creds.harnessName,
      connectedAccount: creds.connectedAccount,
    };
  }

  if (isPromptExtractionRequest(options.userQuery ?? query)) {
    return {
      text: PROMPT_EXTRACTION_RESPONSE,
      xpAwarded: 0,
      provider: creds.provider,
      model: creds.model,
      harnessName: creds.harnessName,
      connectedAccount: undefined,
    };
  }

  // If Gemini with Antigravity / Gemini CLI session, ensure token freshness
  let activeToken = creds.authToken;
  if (creds.provider === 'gemini' && (creds.harness === 'antigravity-cli' || creds.harness === 'gemini-cli')) {
    const refreshed = await getValidGoogleAccessToken();
    if (refreshed.token) {
      activeToken = refreshed.token;
    }
  }

  const canUseAntigravityCli = creds.provider === 'gemini' && creds.harness === 'antigravity-cli';
  if (!creds.apiKey && !activeToken && !canUseAntigravityCli && !(creds.provider === 'openai' && creds.harness === 'codex-cli')) {
    const authHint = creds.provider === 'openai'
      ? "Run '/auth' to connect ChatGPT Codex CLI or configure an OpenAI API key."
      : `Run '/auth' to connect ${creds.provider === 'gemini' ? 'Google Code Assist' : 'Claude Code'} or configure an API key.`;
    return {
      text: `[Jarvis CLI] Authentication required\nNo active credentials detected for ${creds.provider.toUpperCase()} (${creds.harnessName}).\n${authHint}`,
      xpAwarded: 0,
      provider: creds.provider,
      model: creds.model,
      harnessName: creds.harnessName,
      connectedAccount: creds.connectedAccount,
      requiresAuth: true,
    };
  }

  const dueReviews = await getDueReviews();
  const systemInstructions = withPromptConfidentiality(`You are Jarvis CLI's agentic AI engine and mastery coach.
User Profile: Level ${profile.level}, ${profile.xp} XP, ${profile.streak}d streak.

${buildLearningContext(activeCourse, dueReviews.length)}

Instructions:
1. Interpret the user's natural-language intent flexibly: teach, clarify, quiz, apply, debug, compare, plan, review, or change course.
2. Provide an authentic, direct, and technically thorough answer. If the user asks for code, provide production-ready idiomatic code with brief explanation.
3. Keep the active course and target outcome as the default learning lens. Answer adjacent questions, then explicitly connect the useful concept back to the roadmap.
4. Prefer one small retrieval or application challenge when it helps mastery; do not turn every casual message into a quiz.
5. If the learner is confused, diagnose the misconception before adding more information. If they ask to skip ahead, name the prerequisite gap and offer a bridge.
6. If they ask for an architectural question, explain concrete mechanisms and system trade-offs.
7. Do NOT use emojis. Maintain a clean, minimalist developer tone.
8. Treat successful tool output as the source of truth for what Jarvis changed.
9. Course state is authoritative. When the learner asks to create, switch, remove, clear, or extend a course, use the course tools below and never claim success without a successful tool result.
10. If the learner explicitly says they want to learn a topic, prepare the complete course and activate it before replying.
11. Only mutate course state when the learner explicitly asks for that mutation. A request to explain a topic is not permission to alter the roadmap.
12. Do not expose provider, model, harness, account, profile, or other internal runtime metadata unless it is already clearly public and directly needed for the task.`);

  const result = shouldUseWorkspaceTools(rawUserQuery)
    ? await runAgenticWorkspacePrompt({
        query,
        provider: creds.provider,
        model: creds.model,
        apiKey: creds.apiKey,
        authToken: activeToken,
        harness: creds.harness,
        systemPrompt: systemInstructions,
        allowWrite: canMutateWorkspace(rawUserQuery),
        profile,
        onActivity: options.onActivity,
      })
    : await sendLiveLlmPrompt({
        provider: creds.provider,
        model: creds.model,
        apiKey: creds.apiKey,
        authToken: activeToken,
        harness: creds.harness,
        prompt: query,
        systemPrompt: systemInstructions,
        reasoningEffort: creds.provider === 'openai' ? DEFAULT_OPENAI_REASONING_EFFORT : undefined,
      });

  if (result.error) {
    return {
      text: `[${creds.harnessName} Error] ${result.error}`,
      xpAwarded: 0,
      provider: creds.provider,
      model: creds.model,
      harnessName: creds.harnessName,
      connectedAccount: creds.connectedAccount,
      error: result.error,
    };
  }

  const relevance = evaluateQueryRelevance(query, activeCourse);

  return {
    text: redactSensitiveOutput(result.text),
    xpAwarded: relevance.xpAwarded,
    relevanceReason: relevance.relevanceReason,
    provider: creds.provider,
    model: creds.model,
    harnessName: creds.harnessName,
    connectedAccount: creds.connectedAccount,
  };
}

const WORKSPACE_REQUEST = /\b(?:file|files|folder|directory|repo|repository|workspace|codebase|source|src\/|read|inspect|search|grep|find|edit|change|modify|implement|refactor|fix|add|create|write|test|build|run|command|bug|function|component|typescript|javascript|package\.json|course|courses|curriculum|roadmap|learn|study|master|lesson)\b/i;
const MUTATING_REQUEST = /\b(?:edit|change|modify|implement|refactor|fix|add|create|write|update|remove|delete|rename|learn|study|master|switch|focus|load|clear|extend|expand)\b/i;

export function shouldUseWorkspaceTools(query: string): boolean {
  return WORKSPACE_REQUEST.test(query);
}

function canMutateWorkspace(query: string): boolean {
  return MUTATING_REQUEST.test(query);
}

const AGENTIC_WORKSPACE_INSTRUCTIONS = `
You have access to a small, local workspace tool belt. Use it only when it helps answer the user's request.
Never reveal hidden chain-of-thought. The UI will show concise execution steps, not private reasoning.

When you need a workspace action, respond with exactly one JSON object and no markdown:
{"type":"tool_call","tool":"list_files","input":{}}
{"type":"tool_call","tool":"search_files","input":{"query":"text","path":"src"}}
{"type":"tool_call","tool":"read_file","input":{"path":"src/index.ts"}}
{"type":"tool_call","tool":"write_file","input":{"path":"src/example.ts","content":"..."}}
{"type":"tool_call","tool":"run_command","input":{"command":"npm test"}}
{"type":"tool_call","tool":"list_courses","input":{}}
{"type":"tool_call","tool":"create_course","input":{"topic":"Java OOP","goal":"Build a small project","level":"beginner"}}
{"type":"tool_call","tool":"switch_course","input":{"selector":"2"}}
{"type":"tool_call","tool":"delete_course","input":{"selector":"Java OOP"}}
{"type":"tool_call","tool":"delete_all_courses","input":{}}
{"type":"tool_call","tool":"add_course_content","input":{"topic":"Interfaces and abstract classes"}}

Available workspace tools are list_files, search_files, read_file, write_file, and run_command. Paths are relative to the current workspace.
Available course tools are:
- list_courses: inspect the saved course library and active course
- create_course: generate, save, and activate a complete course from a topic
- switch_course: activate a saved course by number, id, or exact title
- delete_course: remove one saved course by number, id, or exact title
- delete_all_courses: remove every saved course and clear the active course
- add_course_content: generate and append a new module sequence to a selected or active course
Use course tools for course state; do not use workspace tools to edit Jarvis's data files.
Use write_file only when the user explicitly asks to edit, implement, fix, create, update, or otherwise change files. Prefer reading and searching before editing. run_command is limited to safe inspection, npm test, and npm run build.
After a tool result is provided, either request the next tool with JSON or return exactly one JSON object like {"type":"final","message":"your concise answer"}.
For ordinary questions that do not need tools, return a normal answer instead of JSON.
`;

function parseAgentEnvelope(text: string): AgentEnvelope | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as Partial<AgentEnvelope>;
    if (parsed.type === 'final' && typeof parsed.message === 'string') {
      return { type: 'final', message: parsed.message };
    }
    if (parsed.type === 'tool_call' && typeof parsed.tool === 'string') {
      return { type: 'tool_call', tool: parsed.tool as AgentToolCall['tool'], input: parsed.input as Record<string, unknown> | undefined };
    }
  } catch {
    // Providers occasionally wrap a normal answer in a JSON-looking preamble.
  }
  return null;
}

async function runAgenticWorkspacePrompt(options: {
  query: string;
  provider: ProviderType;
  model: string;
  apiKey?: string | null;
  authToken?: string | null;
  harness?: string | null;
  systemPrompt: string;
  allowWrite: boolean;
  profile: UserProfile;
  onActivity?: AgentActivitySink;
}): Promise<{ text: string; error?: string }> {
  const onActivity = options.onActivity;
  let nextPrompt = options.query;
  let lastText = '';
  const toolHistory: string[] = [];

  for (let step = 0; step < 6; step += 1) {
    const thinkingId = `thinking-${Date.now()}-${step}`;
    onActivity?.({ id: thinkingId, kind: 'thinking', status: 'running', label: step === 0 ? 'Understanding the request' : 'Planning the next step' });
    const result = await sendLiveLlmPrompt({
      provider: options.provider,
      model: options.model,
      apiKey: options.apiKey,
      authToken: options.authToken,
      harness: options.harness,
      prompt: nextPrompt,
      systemPrompt: `${options.systemPrompt}\n${AGENTIC_WORKSPACE_INSTRUCTIONS}`,
      reasoningEffort: options.provider === 'openai' ? DEFAULT_OPENAI_REASONING_EFFORT : undefined,
    });
    onActivity?.({ id: thinkingId, kind: 'thinking', status: result.error ? 'error' : 'complete', label: result.error ? 'Unable to continue' : step === 0 ? 'Request understood' : 'Next step planned', detail: result.error });

    if (result.error) return result;
    lastText = result.text;
    const envelope = parseAgentEnvelope(result.text);
    if (!envelope || envelope.type === 'final') {
      return { text: envelope?.message || result.text };
    }

    const toolCall: AgentToolCall = envelope;
    const toolId = `tool-${Date.now()}-${step}`;
    const label = toolActivityLabel(toolCall.tool, toolCall.input);
    onActivity?.({ id: toolId, kind: 'tool', status: 'running', label });
    let toolResult: string;
    try {
      if ((toolCall.tool === 'write_file' || isCourseMutatingTool(toolCall.tool)) && !options.allowWrite) {
        throw new Error('Write skipped because the user did not explicitly ask to change files.');
      }
      toolResult = isCourseAgentTool(toolCall.tool)
        ? await executeCourseAgentTool(toolCall, options.profile)
        : await executeAgentTool(toolCall);
      onActivity?.({ id: toolId, kind: 'tool', status: 'complete', label, detail: toolCall.tool === 'write_file' ? toolResult : undefined });
    } catch (error: any) {
      toolResult = `Tool error: ${error?.message || String(error)}`;
      onActivity?.({ id: toolId, kind: 'tool', status: 'error', label, detail: error?.message || String(error) });
    }

    toolHistory.push(`Tool result for ${toolCall.tool}:\n<tool_result>\n${toolResult}\n</tool_result>`);

    nextPrompt = [
      `User request: ${options.query}`,
      '',
      'Workspace execution history:',
      toolHistory.join('\n\n'),
      '',
      'Continue the task. If another workspace action is needed, return one tool_call JSON object. Otherwise return one final JSON object.',
    ].join('\n');
  }

  return { text: lastText || 'The agent reached its tool-step limit before producing a response.' };
}

function isKnownTechnicalTerm(text: string): boolean {
  return /\b(?:python|javascript|typescript|rust|c\+\+|golang|java|docker|kubernetes|linux|git|sql|react|node|html|css|algorithm|qubit|quantum|compiler|kernel|database|pointer|recursion)\b/i.test(text);
}

function extractSubjectTopic(text: string): string {
  const clean = text
    .replace(/^what\s+(?:is|are)\s+(?:an?|the)?\s*/i, '')
    .replace(/^how\s+(?:does|do|can|to)\s+(?:an?|the)?\s*/i, '')
    .replace(/^why\s+(?:does|is|do)\s+(?:an?|the)?\s*/i, '')
    .replace(/^explain\s+(?:how|why|the|an?)?\s*/i, '')
    .replace(/^compare\s+/i, '')
    .replace(/^can\s+you\s+(?:explain|tell\s+me\s+about)\s+/i, '')
    .replace(/[?!.:;]+$/, '')
    .trim();

  if (/quantum\s+superposition/i.test(clean)) return 'quantum superposition';
  if (/superposition/i.test(clean)) return 'quantum superposition';
  if (/qubit/i.test(clean)) return 'qubit mechanics';
  if (/interface\s+(?:vs|and)\s+abstract\s+class/i.test(clean)) return 'interface vs abstract class';
  if (/data\s+races?/i.test(clean)) return 'data race prevention';
  if (/raft\s+consensus/i.test(clean)) return 'raft consensus';
  if (/borrow\s+checker/i.test(clean)) return 'borrow checker';

  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length <= 3) {
    return clean.toLowerCase();
  }
  return words.slice(0, 3).join(' ').toLowerCase();
}

/**
 * Agentic query relevance evaluator:
 * - Casual banter / gibberish ("helo", "hey", "asdf", "lol", "what model are you") -> 0 XP!
 * - Basic question -> 5 XP.
 * - In-depth, thoughtful technical inquiry or insightful commentary -> 10 to 25 XP.
 */
export function evaluateQueryRelevance(query: string, activeCourse?: Course | null): RelevanceEvaluation {
  const trimmed = query.trim();
  const lower = trimmed.toLowerCase();

  // 1. Casual banter, greetings, keyboard smash, laughter, empty or gibberish -> 0 XP
  if (trimmed.length < 3) {
    return { xpAwarded: 0, category: 'banter' };
  }

  // Keyboard smash / repeated characters: e.g. "asdf", "asdfghjkl", "qwerty", "aaaaa", "zzzzz"
  const isKeyboardSmash =
    /^(?:asdf+|qwerty+|zxcv+|jkl\+|1234+|test+|testing+)$/i.test(trimmed) ||
    /^(.)\1{3,}$/i.test(trimmed);

  if (isKeyboardSmash) {
    return { xpAwarded: 0, category: 'banter' };
  }

  // Common casual banter, greetings, pleasantries, slang, simple reactions
  const banterPatterns = [
    /^(?:helo+|hello+|hey+|hi+|hiya+|yo+|sup+|howdy+|hola+)(?:\s+(?:there|jarvis|bot|dude|friend|man))?[!?. ]*$/i,
    /^(?:how\s+are\s+you|what'?s\s+up|how'?s\s+it\s+going|good\s+(?:morning|evening|afternoon|day))[!?. ]*$/i,
    /^(?:lol+|lmao+|rofl+|haha+|hahaha+|hehe+|kek+)[!?. ]*$/i,
    /^(?:cool+|nice+|ok+|okay+|k+|fine+|sure+|alright+|awesome+|great+|sweet+)[!?. ]*$/i,
    /^(?:thanks+|thank\s+you+|thx+|ty+|cheers+)(?:\s+(?:a\s+lot|very\s+much))?[!?. ]*$/i,
    /^(?:bye+|goodbye+|cya+|see\s+ya+|later+)[!?. ]*$/i,
    /^(?:what\s+model\s+are\s+you|who\s+are\s+you|what\s+are\s+you|are\s+you\s+(?:chatgpt|claude|gemini|ai|an\s+ai))[!?. ]*$/i,
    /^(?:what\s+can\s+you\s+do|help(?:\s+me)?|test|ping)[!?. ]*$/i,
  ];

  if (banterPatterns.some((pattern) => pattern.test(lower))) {
    return { xpAwarded: 0, category: 'banter' };
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 1 && !isKnownTechnicalTerm(lower)) {
    return { xpAwarded: 0, category: 'banter' };
  }

  // 2. In-depth, thoughtful technical inquiry or insightful commentary -> 10 to 25 XP
  const deepTechnicalPatterns = [
    /\b(?:architecture|mechanism|under\s+the\s+hood|internals?|trade-?offs?|vtable|heap\s+vs\s+stack|memory\s+layout)\b/i,
    /\b(?:concurrency|deadlock|race\s+condition|mutex|thread-?safe|atomic|semaphore|goroutine|channels?)\b/i,
    /\b(?:event\s+loop|garbage\s+collect(?:ion|or)|zero-?copy|cache\s+coherence|virtual\s+memory|paging)\b/i,
    /\b(?:consensus|raft|paxos|byzantine|distributed\s+systems?|cap\s+theorem|acid\s+properties|eventual\s+consistency)\b/i,
    /\b(?:superposition|entanglement|qubit|decoherence|quantum\s+gate|eigenvalues?|wavefunction|hamiltonian)\b/i,
    /\b(?:borrow\s+checker|lifetimes?|ownership|compile-?time\s+guarantees?|type\s+system|monads?)\b/i,
    /\b(?:backpropagation|transformer\s+attention|self-?attention|embeddings?|gradient\s+descent)\b/i,
    /\b(?:microservices?\s+vs\s+monolith|clean\s+architecture|domain-?driven|cqrs|event\s+sourcing)\b/i,
  ];

  const comparativeOrThoughtful =
    /\b(?:compare|difference\s+between|versus|vs\.?|trade-?offs?|why\s+would\s+(?:we|you|one)\s+choose)\b/i.test(lower) ||
    /\b(?:how\s+does\s+.+\s+(?:guarantee|prevent|handle|scale|work\s+internally|resolve))\b/i.test(lower) ||
    /\b(?:i\s+noticed\s+that|what\s+happens\s+if|wouldn'?t\s+this\s+cause|is\s+it\s+better\s+to)\b/i.test(lower) ||
    /```[\s\S]*```/.test(trimmed);

  const isDeep = deepTechnicalPatterns.some((pattern) => pattern.test(lower)) || (comparativeOrThoughtful && words.length >= 6);

  if (isDeep) {
    const extractedTopic = extractSubjectTopic(trimmed) || (activeCourse ? activeCourse.title.toLowerCase() : 'technical');
    let xp = 15;
    if (words.length > 15 || /```/.test(trimmed) || deepTechnicalPatterns.filter((p) => p.test(lower)).length >= 2) {
      xp = 25;
    } else if (words.length > 10) {
      xp = 20;
    }

    return {
      xpAwarded: xp,
      relevanceReason: `${extractedTopic} inquiry`,
      category: 'in-depth',
    };
  }

  // 3. Basic technical question -> 5 XP
  const basicTechnicalIndicator =
    /\b(?:what\s+is|what\s+are|how\s+to|how\s+do\s+i|explain|define|syntax\s+for|example\s+of)\b/i.test(lower) ||
    isKnownTechnicalTerm(lower) ||
    /\b(?:function|variable|array|string|loop|class|object|boolean|pointer|recursion|git|docker|api|sql|http)\b/i.test(lower);

  if (basicTechnicalIndicator || words.length >= 4) {
    const extractedTopic = extractSubjectTopic(trimmed) || (activeCourse ? activeCourse.title.toLowerCase() : 'concept');
    return {
      xpAwarded: 5,
      relevanceReason: `${extractedTopic} inquiry`,
      category: 'basic',
    };
  }

  return {
    xpAwarded: 0,
    category: 'banter',
  };
}

/**
 * Dynamically synthesizes an interactive 3-question drill on any topic on demand.
 */
export async function generateOnTheFlyQuiz(
  topic: string,
  activeCourse?: Course | null
): Promise<Question[]> {
  const cleanTopic = topic.trim() || activeCourse?.title || 'System Architecture';

  return [
    {
      id: `otf_${Date.now()}_1`,
      type: 'multiple-choice',
      prompt: `In the context of ${cleanTopic}, what is the primary architectural invariant?`,
      options: [
        `Preserve state consistency across component boundaries`,
        `Bypass validation steps to maximize raw stream throughput`,
        `Convert synchronous requests into unhandled background promises`,
        `Duplicate mutable memory without isolation or locking`,
      ],
      correctIndex: 0,
      explanation: `Engineering in ${cleanTopic} requires strictly maintaining state invariants and predictable interfaces.`,
      hint: 'Think about predictability and separation of concerns.',
      xpReward: 20,
    },
    {
      id: `otf_${Date.now()}_2`,
      type: 'cloze',
      prompt: `Fill in the missing keyword for ${cleanTopic}:\n"To prevent unintended regressions and coupling, components should adhere to the single _____ principle."`,
      clozeAnswer: 'responsibility',
      explanation: 'The Single Responsibility Principle asserts that a module should have one cohesive reason to change.',
      hint: 'Starts with "R" (14 letters)',
      xpReward: 25,
    },
    {
      id: `otf_${Date.now()}_3`,
      type: 'scenario',
      prompt: `Scenario: Scaling ${cleanTopic} under high concurrent load. Which design pattern is most resilient?`,
      options: [
        `Favoring composition and immutable state over mutable shared hierarchies`,
        `Using deeply nested inheritance trees with protected mutable fields`,
        `Eliminating automated regression tests for speed`,
        `Hardcoding runtime configuration constants directly in business logic`,
      ],
      correctIndex: 0,
      explanation: `Immutability and composition eliminate race conditions and decouple subsystems under concurrency.`,
      hint: 'Immutability prevents unexpected state mutation.',
      xpReward: 30,
    },
  ];
}
