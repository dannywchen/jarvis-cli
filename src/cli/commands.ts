export interface SlashCommand {
  name: string;
  description: string;
  aliases?: string[];
  acceptsArgument?: boolean;
  /** A small hint shown beside argument-taking commands in richer palettes. */
  argumentHint?: string;
}

/**
 * The compact command vocabulary shown in the interactive composer.
 *
 * Keep these labels user-facing: they are the first thing a learner sees
 * after typing `/`. Aliases are intentionally short and forgiving so users
 * can use the words they naturally reach for ("review", "path", "tutor").
 */
export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: 'topic',
    description: 'Decompose any topic into bite-sized concepts and learn',
    aliases: ['subject', 'concept', 'decompose'],
    acceptsArgument: true,
    argumentHint: 'topic',
  },
  {
    name: 'learn',
    description: 'Start your next lesson or dive into a topic',
    aliases: ['lesson', 'next', 'start', 'study'],
    acceptsArgument: true,
    argumentHint: 'topic',
  },
  {
    name: 'flashcards',
    description: 'Review active recall flashcards',
    aliases: ['flashcard', 'cards', 'recall', 'deck'],
    acceptsArgument: true,
    argumentHint: 'topic',
  },
  {
    name: 'quiz',
    description: 'Challenge yourself on a topic',
    aliases: ['challenge', 'drill', 'test'],
    acceptsArgument: true,
    argumentHint: 'topic',
  },
  {
    name: 'roadmap',
    description: 'See your learning path and progress',
    aliases: ['map', 'path', 'curriculum'],
  },
  {
    name: 'practice',
    description: 'Review spaced repetition items and earn XP',
    aliases: ['review', 'spaced', 'sr'],
  },
  {
    name: 'stats',
    description: 'See Level, XP, streak, and shields',
    aliases: ['progress', 'profile', 'xp', 'streak'],
  },
  {
    name: 'load',
    description: 'Turn notes or documents into a course',
    aliases: ['import', 'course'],
    acceptsArgument: true,
    argumentHint: 'file path',
  },
  {
    name: 'threads',
    description: 'Browse recent conversations',
    aliases: ['history', 'recent', 'convos', 'sessions'],
  },
  {
    name: 'resume',
    description: 'Continue a recent conversation',
    aliases: ['continue', 'open', 'restore'],
    acceptsArgument: true,
    argumentHint: 'number or id',
  },
  {
    name: 'model',
    description: 'Choose your AI tutor and model',
    aliases: ['agent', 'tutor', 'llm'],
  },
  {
    name: 'auth',
    description: 'Connect your AI account or CLI harness',
    aliases: ['connect', 'login', 'harness', 'key'],
  },
  {
    name: 'help',
    description: 'Show command guide and keyboard shortcuts',
    aliases: ['commands', 'guide', 'shortcuts', '?'],
  },
  {
    name: 'clear',
    description: 'Start with a clean chat',
    aliases: ['reset', 'new', 'cls'],
  },
  {
    name: 'exit',
    description: 'Leave the session',
    aliases: ['quit', 'q', 'bye'],
  },
];

export interface ParsedSlashInput {
  command: string;
  args: string;
}

export function parseSlashInput(input: string): ParsedSlashInput | null {
  const match = input.trim().match(/^\/([^\s]*)(?:\s+(.*))?$/);
  if (!match) return null;
  return { command: match[1].toLowerCase(), args: match[2]?.trim() || '' };
}

export function resolveSlashCommand(input: string): SlashCommand | undefined {
  const parsed = parseSlashInput(input);
  if (!parsed?.command) return undefined;
  return findCommand(parsed.command);
}

/**
 * Resolve both `/command` input and the bare command forms accepted by the
 * legacy CLI (`learn`, `quiz topic`, etc.). Natural-language prompts still
 * return undefined because only the first token is considered.
 */
export function resolveCommandInput(input: string): SlashCommand | undefined {
  const parsed = parseSlashInput(input) || parseBareCommandInput(input);
  if (!parsed?.command) return undefined;
  return findCommand(parsed.command);
}

/** Parse a slash command or a legacy bare command, preserving its arguments. */
export function parseCommandInput(input: string): ParsedSlashInput | null {
  return parseSlashInput(input) || parseBareCommandInput(input);
}

function parseBareCommandInput(input: string): ParsedSlashInput | null {
  const match = input.trim().match(/^([^\s]+)(?:\s+(.*))?$/);
  if (!match) return null;
  return { command: match[1].toLowerCase(), args: match[2]?.trim() || '' };
}

function findCommand(commandName: string): SlashCommand | undefined {
  return SLASH_COMMANDS.find((item) => item.name === commandName || item.aliases?.includes(commandName));
}

/**
 * Only the first token is a filter. This lets `/quiz react hooks` keep the
 * useful `/quiz` match while the rest becomes the command argument.
 */
export function filterSlashCommands(input: string): SlashCommand[] {
  const parsed = parseSlashInput(input);
  if (!parsed || input.trimStart()[0] !== '/') return [];
  const query = parsed.command;
  const score = (item: SlashCommand): number => {
    const names = [item.name, ...(item.aliases || [])];
    if (!query) return 2;
    if (item.name.startsWith(query)) return 0;
    if (names.some((name) => name.startsWith(query))) return 1;
    if (names.some((name) => name.includes(query)) || item.description.toLowerCase().includes(query)) return 2;
    return 99;
  };

  return SLASH_COMMANDS
    .map((item, index) => ({ item, index, score: score(item) }))
    .filter((entry) => entry.score < 99)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((entry) => entry.item);
}

export function completeSlashCommand(input: string, command: SlashCommand): string {
  const parsed = parseSlashInput(input);
  if (!parsed) return input;
  return `/${command.name}${command.acceptsArgument ? ' ' : ''}`;
}
