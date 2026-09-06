import { UserProfile, Course, Question } from '../types/index.js';
import { evaluateAnswerWithAi } from './ai.js';

export type AgentEnvironment = 'antigravity' | 'claude-code' | 'codex' | 'gemini' | 'standalone';

export interface AgentDetection {
  env: AgentEnvironment;
  name: string;
  badge: string;
  description: string;
  hasLiveLlm: boolean;
}

/**
 * Detects whether Jarvis CLI is running inside Antigravity, Claude Code, Codex, or standalone.
 */
export function detectAgentEnvironment(): AgentDetection {
  if (process.env.ANTIGRAVITY_AGENT || process.env.ANTIGRAVITY_CONVERSATION_ID || process.env.ANTIGRAVITY_SOURCE_METADATA) {
    return {
      env: 'antigravity',
      name: 'Google Antigravity Agent',
      badge: 'Antigravity Bridge',
      description: 'Deep-reasoning agent with 2M context integration',
      hasLiveLlm: true,
    };
  }

  if (process.env.CLAUDE_CODE || process.env.CLAUDE_PROJECT || process.env.ANTHROPIC_API_KEY) {
    return {
      env: 'claude-code',
      name: 'Claude Code Agent',
      badge: 'Claude Code Bridge',
      description: 'Technical reasoning & terminal tool execution',
      hasLiveLlm: true,
    };
  }

  if (process.env.CODEX_THREAD_ID || process.env.OPENAI_API_KEY) {
    return {
      env: 'codex',
      name: 'OpenAI Codex Agent',
      badge: 'Codex Agent Bridge',
      description: 'GPT-5.6 Luna high-reasoning engine',
      hasLiveLlm: true,
    };
  }

  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
    return {
      env: 'gemini',
      name: 'Google Gemini Direct',
      badge: 'Gemini 2.0 Flash',
      description: 'Direct high-speed multimodal LLM connection',
      hasLiveLlm: true,
    };
  }

  return {
    env: 'standalone',
    name: 'Jarvis CLI Autonomous Engine',
    badge: 'Jarvis CLI Engine',
    description: 'Procedural synthesizer with zero dependencies',
    hasLiveLlm: false,
  };
}

/**
 * Chat with Jarvis using the active agentic backend or live LLM.
 */
export async function chatWithAgentTutor(
  userQuery: string,
  profile: UserProfile,
  activeCourse?: Course | null
): Promise<{ text: string; xpAwarded: number }> {
  const agentInfo = detectAgentEnvironment();
  const apiKey = profile.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.OPENAI_API_KEY;
  const provider = profile.apiProvider || (process.env.GEMINI_API_KEY ? 'gemini' : process.env.OPENAI_API_KEY ? 'openai' : null);

  const contextPrompt = activeCourse
    ? `Current Active Course: "${activeCourse.title}"\nPace: ${activeCourse.pace}\nCourse Summary: ${activeCourse.summary}`
    : 'No course loaded yet.';

  const systemInstructions = `You are Jarvis, the expert AI tutor in Jarvis CLI.
Jarvis CLI is a Claude Code-inspired terminal learning tool.
User Profile: Level ${profile.level}, ${profile.xp} XP, ${profile.streak}-day streak, ${profile.hearts}/${profile.maxHearts} HP.
Context:
${contextPrompt}

User Question: "${userQuery}"

Guidelines:
1. Explain with crisp technical accuracy and an intuitive real-world analogy.
2. Provide a 1-sentence Core Rule.
3. Offer an optional micro-challenge question to test active recall.
4. Do NOT use emojis. Maintain a clean, minimalist, high-craft developer tone.`;

  // 1. If Gemini API is available
  if (apiKey && (provider === 'gemini' || !provider)) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: systemInstructions }] }],
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as any;
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return { text, xpAwarded: 5 };
      }
    } catch {
      // fallback
    }
  }

  // 2. Intelligent conversational synthesizer without emojis
  const queryLower = userQuery.toLowerCase();
  let synthesizedAnswer = '';

  if (queryLower.includes('overriding') && queryLower.includes('overloading')) {
    synthesizedAnswer = `Jarvis: Method Overriding vs Overloading in Java:

- Method Overloading: Multiple methods within the same class sharing the identical name but differing in parameter signatures (types, count, or order). Resolved at compile-time (Static Binding).
  Example: add(int a, int b) vs add(double a, double b)

- Method Overriding: A subclass replaces the inherited implementation of a method defined in its superclass. Resolved dynamically at runtime (Dynamic Dispatch / vtable).
  Example: Animal.speak() overridden by Dog.speak()

Core Rule: Overloading alters parameters within a class; Overriding customizes implementation in a subclass.
Analogy: Overloading is having multiple attachments for a vacuum; Overriding is replacing the factory motor with a custom engine.

Active Recall Drill: Why can method overloading not be achieved merely by altering the return type?`;
  } else if (queryLower.includes('constructor') || queryLower.includes('constructors')) {
    synthesizedAnswer = `Jarvis: Constructors are initialization subroutines for objects:

When executing 'new Car("Model 3")', the JVM:
1. Allocates raw memory on the Heap for instance state.
2. Executes the constructor subroutine to assign field invariants.
3. Returns the memory reference pointer onto the local execution stack.

Core Rule: If no constructor is declared, Java injects a default no-arg constructor. Declaring any custom constructor immediately suppresses the default one.
Analogy: A constructor is the factory calibration technician configuring hardware before shipping.`;
  } else if (queryLower.includes('interface') || queryLower.includes('abstract')) {
    synthesizedAnswer = `Jarvis: Interface vs Abstract Class architectural trade-offs:

- Interface: Pure behavioral contract ("can-do"). Supports multiple implementation inheritance. Used for decoupling distinct subsystems (e.g. AutoCloseable, Comparable).
- Abstract Class: Shared identity and partial implementation ("is-a"). Used when closely related subclasses share mutable state and common helper logic.

Core Rule: Prefer interfaces for API contracts and loose coupling; use abstract classes for code reuse across a strict hierarchy.
Analogy: An interface is a standardized power outlet; an abstract class is a partially assembled vehicle chassis.`;
  } else {
    synthesizedAnswer = `Jarvis: Concept Analysis:
In ${activeCourse ? activeCourse.title : 'software engineering'}, the guiding principle is maintaining clean encapsulation and unambiguous invariants.

Key focus areas:
1. Isolate state behind strict access modifiers.
2. Prefer composition ('has-a') over deep inheritance ('is-a').
3. Adhere to single responsibility boundaries.

Next: Use /learn to launch the active roadmap node, or ask for a targeted drill.`;
  }

  return { text: synthesizedAnswer, xpAwarded: 5 };
}
