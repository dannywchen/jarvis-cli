import { UserProfile, Course } from '../types/index.js';
export declare function renderBanner(): void;
export declare function renderOpenCodeChatBox(currentInput: string, profile: UserProfile, activeCourse?: Course | null): void;
export declare function renderStatusRibbon(profile: UserProfile, activeCourse?: Course | null): void;
