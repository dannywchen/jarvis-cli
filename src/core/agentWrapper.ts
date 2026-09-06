import { UserProfile, Course, Question } from '../types/index.js';
import { sendLiveLlmPrompt, ProviderType, normalizeModelId, DEFAULT_OPENAI_REASONING_EFFORT } from './liveClient.js';
import { scanDetectedCliSessions, getValidGoogleAccessToken, CliSessionInfo } from './cliAuth.js';

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
  activeCourse?: Course | null
): Promise<AgentResponse> {
  const creds = resolveActiveCredentials(profile);

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

  const systemInstructions = `You are Jarvis CLI's agentic AI engine powered by ${creds.model} via ${creds.harnessName}.
Active Course: ${activeCourse ? `"${activeCourse.title}" (${activeCourse.summary})` : 'General Technical Development'}.
User Profile: Level ${profile.level}, ${profile.xp} XP, ${profile.streak}d streak.

Instructions:
1. Provide an authentic, direct, and technically thorough answer.
2. If the user asks for code, provide production-ready idiomatic code with brief explanation.
3. If they ask an architectural question, explain with concrete mechanisms and system trade-offs.
4. Do NOT use emojis. Maintain a clean, minimalist developer tone.`;

  const result = await sendLiveLlmPrompt({
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
    text: result.text,
    xpAwarded: relevance.xpAwarded,
    relevanceReason: relevance.relevanceReason,
    provider: creds.provider,
    model: creds.model,
    harnessName: creds.harnessName,
    connectedAccount: creds.connectedAccount,
  };
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
