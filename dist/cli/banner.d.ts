import { UserProfile, Course, RecentThreadSummary } from '../types/index.js';
export interface ClaudeBoxContext {
    userName?: string;
    modelName?: string;
    level?: number;
    xp?: number;
    cwd?: string;
    recentThreads?: RecentThreadSummary[];
    version?: string;
}
export declare function stripAnsi(str: string): string;
export declare function normalizeModelName(rawModel?: string): string;
export declare function formatCwd(dir?: string): string;
export declare function relativeAge(timestamp: string): string;
/**
 * Builds the exact pixel-perfect Claude Code box layout from Screenshot 2:
 *
 * ╭┈┈┈┈┈┈┈ Jarvis CLI v1.0.0 ┈┈┈┈┈┈┈┈┬┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈╮
 * ┊                                  ┊ Recent activity                          ┊
 * ┊       Welcome back Danny!        ┊ 1m ago   Updated project memory          ┊
 * ┊                                  ┊ 8m ago   Updated claw'd feet             ┊
 * ┊             ▄▄   ▄▄              ┊ 2d ago   Add new words to spinner        ┊
 * ┊             ████████             ┊ 1w ago   Update unit tests               ┊
 * ┊             ██▄██▄██             ┊ ... /resume for more                     ┊
 * ┊             ████████             ┊                                          ┊
 * ┊             █ █  █ █             ├┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┤
 * ┊                                  ┊ What's new                               ┊
 * ┊                                  ┊ /topic to break down & learn any topic   ┊
 * ┊Gemini 3.8 Flash • Level 1 (0 XP) ┊ /learn to start bite-sized lesson        ┊
 * ┊  ~/Documents/GitHub/jarvis-cli   ┊ /quiz for challenge drills               ┊
 * ┊                                  ┊ ... /help for more                       ┊
 * ╰┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┴┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈╯
 */
export declare function buildClaudeCodeBox(context?: ClaudeBoxContext, termWidth?: number): string[];
export declare function renderBanner(context?: Partial<ClaudeBoxContext>): void;
export declare function renderJarvisChatBox(currentInput: string, _profile?: UserProfile, _activeCourse?: Course | null): void;
export declare function renderStatusRibbon(profile: UserProfile, activeCourse?: Course | null): void;
export declare const renderOpenCodeChatBox: typeof renderJarvisChatBox;
