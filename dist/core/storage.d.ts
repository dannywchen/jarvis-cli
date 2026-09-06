import { UserProfile, Course, SpacedReviewItem } from '../types/index.js';
export declare function ensureStorageDirectories(): Promise<void>;
export declare function loadUserProfile(): Promise<UserProfile>;
export declare function saveUserProfile(profile: UserProfile): Promise<void>;
export declare function saveCourse(course: Course): Promise<void>;
export declare function loadCourse(courseId: string): Promise<Course | null>;
export declare function listSavedCourses(): Promise<Course[]>;
export declare function loadReviewItems(): Promise<SpacedReviewItem[]>;
export declare function saveReviewItems(items: SpacedReviewItem[]): Promise<void>;
