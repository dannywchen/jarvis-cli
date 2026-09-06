import { Lesson, SkillNode, Course, UserProfile } from '../../types/index.js';
export declare function runLesson(lesson: Lesson, node: SkillNode, course: Course, profile: UserProfile): Promise<{
    success: boolean;
    xpEarned: number;
}>;
