import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const DUO_DIR = path.join(os.homedir(), '.duocode');
const PROFILE_FILE = path.join(DUO_DIR, 'profile.json');
const COURSES_DIR = path.join(DUO_DIR, 'courses');
const REVIEWS_FILE = path.join(DUO_DIR, 'reviews.json');
const DEFAULT_PROFILE = {
    name: 'Learner',
    xp: 0,
    level: 1,
    hearts: 5,
    maxHearts: 5,
    streak: 1,
    lastActiveDate: new Date().toISOString().split('T')[0],
    zenMode: false,
    completedLessonsCount: 0,
    masteredSkillsCount: 0,
    achievements: [],
};
export async function ensureStorageDirectories() {
    await fs.mkdir(DUO_DIR, { recursive: true });
    await fs.mkdir(COURSES_DIR, { recursive: true });
}
export async function loadUserProfile() {
    await ensureStorageDirectories();
    try {
        const raw = await fs.readFile(PROFILE_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_PROFILE, ...parsed };
    }
    catch {
        await saveUserProfile(DEFAULT_PROFILE);
        return { ...DEFAULT_PROFILE };
    }
}
export async function saveUserProfile(profile) {
    await ensureStorageDirectories();
    await fs.writeFile(PROFILE_FILE, JSON.stringify(profile, null, 2), 'utf-8');
}
export async function saveCourse(course) {
    await ensureStorageDirectories();
    const filePath = path.join(COURSES_DIR, `${course.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(course, null, 2), 'utf-8');
}
export async function loadCourse(courseId) {
    await ensureStorageDirectories();
    const filePath = path.join(COURSES_DIR, `${courseId}.json`);
    try {
        const raw = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
export async function listSavedCourses() {
    await ensureStorageDirectories();
    try {
        const files = await fs.readdir(COURSES_DIR);
        const courses = [];
        for (const file of files) {
            if (file.endsWith('.json')) {
                try {
                    const raw = await fs.readFile(path.join(COURSES_DIR, file), 'utf-8');
                    courses.push(JSON.parse(raw));
                }
                catch {
                    // ignore corrupted files
                }
            }
        }
        return courses.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    catch {
        return [];
    }
}
export async function loadReviewItems() {
    await ensureStorageDirectories();
    try {
        const raw = await fs.readFile(REVIEWS_FILE, 'utf-8');
        return JSON.parse(raw);
    }
    catch {
        return [];
    }
}
export async function saveReviewItems(items) {
    await ensureStorageDirectories();
    await fs.writeFile(REVIEWS_FILE, JSON.stringify(items, null, 2), 'utf-8');
}
