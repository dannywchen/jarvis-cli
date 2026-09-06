import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { calculateLevel } from './gamification.js';
const DEFAULT_JARVIS_DIR_NAME = '.jarvis-cli';
const LEGACY_DUO_DIR_NAME = '.duocode';
const RECENT_THREADS_FILE_NAME = 'recent-threads.json';
const LEGACY_THREAD_FILE_NAMES = ['threads.json', 'history.json', 'chat-history.json', 'thread-history.json', 'sessions.json'];
const HISTORY_VERSION = 1;
const MAX_RECENT_THREADS = 20;
const MAX_MESSAGES_PER_THREAD = 200;
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
    apiProvider: 'openai',
    activeModel: 'gpt-5.6-luna',
};
/**
 * Jarvis writes new data to ~/.jarvis-cli. The legacy ~/.duocode directory is
 * read as a fallback and is never removed or overwritten, so existing courses,
 * profiles, reviews, and conversations continue to work after the rename.
 */
export function getStorageDirectory() {
    return process.env.JARVIS_CLI_DATA_DIR || process.env.DUOCODE_DATA_DIR || path.join(os.homedir(), DEFAULT_JARVIS_DIR_NAME);
}
function getLegacyStorageDirectory() {
    if (process.env.JARVIS_CLI_DATA_DIR || process.env.DUOCODE_DATA_DIR)
        return null;
    return path.join(os.homedir(), LEGACY_DUO_DIR_NAME);
}
function getStoragePaths(dataDir = getStorageDirectory()) {
    return {
        dataDir,
        profileFile: path.join(dataDir, 'profile.json'),
        coursesDir: path.join(dataDir, 'courses'),
        reviewsFile: path.join(dataDir, 'reviews.json'),
        recentThreadsFile: path.join(dataDir, RECENT_THREADS_FILE_NAME),
    };
}
export async function ensureStorageDirectories() {
    const paths = getStoragePaths();
    await fs.mkdir(paths.dataDir, { recursive: true });
    await fs.mkdir(paths.coursesDir, { recursive: true });
}
export function sanitizeLoadedProfile(parsed) {
    const profile = { ...DEFAULT_PROFILE, ...parsed };
    // Ensure baseline starts at Level 1 and 0 XP.
    // Cleanly migrate legacy artificial XP (e.g. from old hardcoded loops, or if user starts clean)
    // if they haven't completed authentic lessons or if progression is malformed.
    const authenticLessons = typeof profile.completedLessonsCount === 'number' ? profile.completedLessonsCount : 0;
    const hadLegacyArtificialXp = authenticLessons <= 0 && (profile.xp > 0 || profile.level !== 1);
    if (hadLegacyArtificialXp || typeof profile.xp !== 'number' || isNaN(profile.xp) || profile.xp < 0) {
        profile.xp = 0;
        profile.level = 1;
    }
    else if (authenticLessons > 0) {
        profile.level = calculateLevel(profile.xp);
    }
    else {
        profile.xp = 0;
        profile.level = 1;
    }
    return profile;
}
export async function loadUserProfile() {
    await ensureStorageDirectories();
    const { profileFile } = getStoragePaths();
    const legacyDirectory = getLegacyStorageDirectory();
    const candidates = [profileFile, legacyDirectory ? path.join(legacyDirectory, 'profile.json') : null].filter((candidate) => Boolean(candidate));
    for (const candidate of candidates) {
        try {
            const raw = await fs.readFile(candidate, 'utf-8');
            const parsed = JSON.parse(raw);
            const profile = sanitizeLoadedProfile(parsed);
            const hadLegacyArtificialXp = parsed.xp !== profile.xp || parsed.level !== profile.level;
            if (candidate !== profileFile || hadLegacyArtificialXp)
                await saveUserProfile(profile);
            return profile;
        }
        catch {
            // Try the next compatible location before creating a fresh profile.
        }
    }
    await saveUserProfile(DEFAULT_PROFILE);
    return { ...DEFAULT_PROFILE };
}
export async function saveUserProfile(profile) {
    await ensureStorageDirectories();
    const { profileFile } = getStoragePaths();
    await fs.writeFile(profileFile, JSON.stringify(profile, null, 2), 'utf-8');
}
export async function saveCourse(course) {
    await ensureStorageDirectories();
    const { coursesDir } = getStoragePaths();
    const filePath = path.join(coursesDir, `${course.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(course, null, 2), 'utf-8');
}
export async function loadCourse(courseId) {
    await ensureStorageDirectories();
    const { coursesDir } = getStoragePaths();
    const legacyDirectory = getLegacyStorageDirectory();
    const candidates = [
        path.join(coursesDir, `${courseId}.json`),
        legacyDirectory ? path.join(legacyDirectory, 'courses', `${courseId}.json`) : null,
    ].filter((candidate) => Boolean(candidate));
    for (const filePath of candidates) {
        try {
            const raw = await fs.readFile(filePath, 'utf-8');
            return JSON.parse(raw);
        }
        catch {
            // Try the legacy location before reporting a missing course.
        }
    }
    return null;
}
export async function listSavedCourses() {
    await ensureStorageDirectories();
    const { coursesDir } = getStoragePaths();
    const legacyDirectory = getLegacyStorageDirectory();
    const courseDirectories = [coursesDir, legacyDirectory ? path.join(legacyDirectory, 'courses') : null].filter((directory) => Boolean(directory));
    const courses = new Map();
    for (const directory of courseDirectories) {
        try {
            const files = await fs.readdir(directory);
            for (const file of files) {
                if (!file.endsWith('.json'))
                    continue;
                try {
                    const raw = await fs.readFile(path.join(directory, file), 'utf-8');
                    const course = JSON.parse(raw);
                    if (course.id && !courses.has(course.id))
                        courses.set(course.id, course);
                }
                catch {
                    // Ignore one corrupted course without hiding healthy courses.
                }
            }
        }
        catch {
            // A missing legacy directory is expected for new Jarvis installs.
        }
    }
    return [...courses.values()].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
/** Remove one persisted course and any spaced-repetition items that belong to it. */
export async function deleteCourse(courseId) {
    const cleanId = courseId.trim();
    if (!cleanId || cleanId.includes('/') || cleanId.includes('\\') || cleanId === '.' || cleanId === '..') {
        throw new Error('A valid course id is required.');
    }
    const { coursesDir } = getStoragePaths();
    const legacyDirectory = getLegacyStorageDirectory();
    const candidates = [
        path.join(coursesDir, `${cleanId}.json`),
        legacyDirectory ? path.join(legacyDirectory, 'courses', `${cleanId}.json`) : null,
    ].filter((candidate) => Boolean(candidate));
    let removed = false;
    for (const filePath of candidates) {
        try {
            await fs.unlink(filePath);
            removed = true;
        }
        catch (error) {
            if (error?.code !== 'ENOENT')
                throw error;
        }
    }
    if (removed) {
        const reviews = await loadReviewItems();
        await saveReviewItems(reviews.filter((item) => item.courseId !== cleanId));
    }
    return removed;
}
/** Remove every saved course, including courses still present in the legacy store. */
export async function deleteAllCourses() {
    await ensureStorageDirectories();
    const { coursesDir } = getStoragePaths();
    const legacyDirectory = getLegacyStorageDirectory();
    const directories = [coursesDir, legacyDirectory ? path.join(legacyDirectory, 'courses') : null]
        .filter((directory) => Boolean(directory));
    let removed = 0;
    for (const directory of directories) {
        let files = [];
        try {
            files = await fs.readdir(directory);
        }
        catch {
            continue;
        }
        for (const file of files) {
            if (!file.endsWith('.json'))
                continue;
            try {
                await fs.unlink(path.join(directory, file));
                removed += 1;
            }
            catch (error) {
                if (error?.code !== 'ENOENT')
                    throw error;
            }
        }
    }
    await saveReviewItems([]);
    return removed;
}
export async function loadReviewItems() {
    await ensureStorageDirectories();
    const { reviewsFile } = getStoragePaths();
    const legacyDirectory = getLegacyStorageDirectory();
    const candidates = [reviewsFile, legacyDirectory ? path.join(legacyDirectory, 'reviews.json') : null].filter((candidate) => Boolean(candidate));
    for (const candidate of candidates) {
        try {
            const raw = await fs.readFile(candidate, 'utf-8');
            return JSON.parse(raw);
        }
        catch {
            // Try the next compatible location.
        }
    }
    return [];
}
export async function saveReviewItems(items) {
    await ensureStorageDirectories();
    const { reviewsFile } = getStoragePaths();
    await fs.writeFile(reviewsFile, JSON.stringify(items, null, 2), 'utf-8');
}
let historyWriteQueue = Promise.resolve();
function queueHistoryWrite(operation) {
    const next = historyWriteQueue.then(operation, operation);
    historyWriteQueue = next.then(() => undefined, () => undefined);
    return next;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function asNonEmptyString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function validTimestamp(value, fallback) {
    const candidate = asNonEmptyString(value);
    if (!candidate)
        return fallback;
    return Number.isNaN(new Date(candidate).getTime()) ? fallback : candidate;
}
function truncate(value, maxLength) {
    return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trimEnd()}…`;
}
function titleFromText(text) {
    const compact = text.replace(/\s+/g, ' ').trim();
    return compact ? truncate(compact, 80) : 'New conversation';
}
function normalizeRole(value) {
    const role = asNonEmptyString(value)?.toLowerCase();
    if (role === 'user' || role === 'human' || role === 'prompt')
        return 'user';
    if (role === 'assistant' || role === 'agent' || role === 'bot' || role === 'ai')
        return 'assistant';
    if (role === 'system' || role === 'tool')
        return 'system';
    return null;
}
function stableId(prefix, value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `${prefix}_${(hash >>> 0).toString(16)}`;
}
function newThreadId() {
    return `thread_${Date.now()}_${randomUUID().slice(0, 8)}`;
}
function newMessageId() {
    return `message_${Date.now()}_${randomUUID().slice(0, 8)}`;
}
function normalizeMessage(value, threadId, index, fallbackTime) {
    if (!isRecord(value))
        return null;
    const role = normalizeRole(value.role || value.author || value.sender || value.type);
    const text = asNonEmptyString(value.text || value.content || value.message || value.value);
    if (!role || !text)
        return null;
    const createdAt = validTimestamp(value.createdAt || value.timestamp || value.time, fallbackTime);
    const id = asNonEmptyString(value.id || value.messageId) || stableId('message', `${threadId}:${index}:${role}:${text}:${createdAt}`);
    return { id, role, text, createdAt };
}
function findMessageArray(value) {
    for (const key of ['messages', 'history', 'transcript', 'entries']) {
        if (Array.isArray(value[key]))
            return value[key];
    }
    return [];
}
function normalizeThread(value, index) {
    if (!isRecord(value))
        return null;
    const now = new Date().toISOString();
    const rawId = asNonEmptyString(value.id || value.threadId || value.sessionId || value.conversationId);
    const id = rawId || stableId('migrated_thread', JSON.stringify(value));
    const rawMessages = findMessageArray(value);
    const messages = rawMessages
        .map((message, messageIndex) => normalizeMessage(message, id, messageIndex, now))
        .filter((message) => message !== null)
        .slice(-MAX_MESSAGES_PER_THREAD);
    const firstUserMessage = messages.find((message) => message.role === 'user');
    const title = titleFromText(asNonEmptyString(value.title || value.name || value.label) || firstUserMessage?.text || 'New conversation');
    const createdAt = validTimestamp(value.createdAt || value.created || value.startedAt, messages[0]?.createdAt || now);
    const updatedAt = validTimestamp(value.updatedAt || value.lastActiveAt || value.lastActivityAt || value.lastMessageAt, messages.at(-1)?.createdAt || createdAt);
    return {
        id: id || `migrated_thread_${index}`,
        title,
        createdAt,
        updatedAt: new Date(updatedAt).getTime() < new Date(createdAt).getTime() ? createdAt : updatedAt,
        messages,
        provider: asNonEmptyString(value.provider),
        model: asNonEmptyString(value.model || value.activeModel),
        harness: asNonEmptyString(value.harness || value.harnessName),
    };
}
function findThreadArray(value) {
    if (Array.isArray(value))
        return value;
    if (!isRecord(value))
        return [];
    for (const key of ['threads', 'recentThreads', 'sessions', 'conversations', 'history']) {
        if (Array.isArray(value[key]))
            return value[key];
    }
    if (value.id || value.threadId || value.sessionId || value.messages || value.transcript)
        return [value];
    return [];
}
function sortAndLimitThreads(threads) {
    const deduped = new Map();
    for (const thread of threads)
        deduped.set(thread.id, thread);
    return [...deduped.values()]
        .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
        .slice(0, MAX_RECENT_THREADS);
}
function normalizeThreads(value) {
    return sortAndLimitThreads(findThreadArray(value)
        .map((thread, index) => normalizeThread(thread, index))
        .filter((thread) => thread !== null));
}
async function readJson(filePath) {
    try {
        const raw = await fs.readFile(filePath, 'utf-8');
        try {
            return { exists: true, valid: true, value: JSON.parse(raw) };
        }
        catch {
            return { exists: true, valid: false };
        }
    }
    catch {
        return { exists: false, valid: false };
    }
}
async function writeJsonAtomically(filePath, value) {
    const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
    try {
        await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2), { encoding: 'utf-8', mode: 0o600 });
        await fs.rename(temporaryPath, filePath);
    }
    finally {
        await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
}
function historySearchDirectories() {
    const current = path.resolve(getStorageDirectory());
    const legacyDuo = getLegacyStorageDirectory();
    if (!legacyDuo)
        return [current];
    const legacy = path.resolve(legacyDuo);
    return current === legacy ? [current] : [current, legacy];
}
async function loadRecentThreadsInternal() {
    const paths = getStoragePaths();
    const canonical = await readJson(paths.recentThreadsFile);
    if (canonical.exists) {
        // A malformed canonical file is left untouched. Returning an empty list is
        // safer than silently replacing a file that may contain recoverable data.
        return canonical.valid ? normalizeThreads(canonical.value) : [];
    }
    for (const directory of historySearchDirectories()) {
        for (const fileName of LEGACY_THREAD_FILE_NAMES) {
            const legacy = await readJson(path.join(directory, fileName));
            if (!legacy.exists || !legacy.valid)
                continue;
            const migrated = normalizeThreads(legacy.value);
            if (!migrated.length)
                continue;
            await writeJsonAtomically(paths.recentThreadsFile, { version: HISTORY_VERSION, threads: migrated });
            return migrated;
        }
        // A very early build stored conversation-like data beside the profile.
        // Only arrays with recognizable thread/message keys are migrated.
        const profile = await readJson(path.join(directory, 'profile.json'));
        if (profile.exists && profile.valid) {
            const migrated = normalizeThreads(profile.value);
            if (migrated.length) {
                await writeJsonAtomically(paths.recentThreadsFile, { version: HISTORY_VERSION, threads: migrated });
                return migrated;
            }
        }
    }
    return [];
}
function cloneThread(thread) {
    return {
        ...thread,
        messages: thread.messages.map((message) => ({ ...message })),
    };
}
function threadForPersistence(thread) {
    const normalized = normalizeThread(thread, 0);
    if (!normalized)
        throw new Error('Cannot persist an invalid recent thread.');
    return normalized;
}
export async function loadRecentThreads() {
    await ensureStorageDirectories();
    const threads = await loadRecentThreadsInternal();
    return threads.map(cloneThread);
}
export async function saveRecentThreads(threads) {
    await ensureStorageDirectories();
    await queueHistoryWrite(async () => {
        const normalized = sortAndLimitThreads(threads.map(threadForPersistence));
        const { recentThreadsFile } = getStoragePaths();
        await writeJsonAtomically(recentThreadsFile, { version: HISTORY_VERSION, threads: normalized });
    });
}
export async function createRecentThread(options = {}) {
    await ensureStorageDirectories();
    return queueHistoryWrite(async () => {
        const threads = await loadRecentThreadsInternal();
        const now = new Date().toISOString();
        const thread = {
            id: options.id || newThreadId(),
            title: titleFromText(options.title || 'New conversation'),
            createdAt: validTimestamp(options.createdAt, now),
            updatedAt: validTimestamp(options.updatedAt || options.createdAt, now),
            messages: [],
            provider: asNonEmptyString(options.provider),
            model: asNonEmptyString(options.model),
            harness: asNonEmptyString(options.harness),
        };
        const next = sortAndLimitThreads([thread, ...threads]);
        const { recentThreadsFile } = getStoragePaths();
        await writeJsonAtomically(recentThreadsFile, { version: HISTORY_VERSION, threads: next });
        return cloneThread(thread);
    });
}
export async function loadRecentThread(threadId) {
    const thread = (await loadRecentThreads()).find((item) => item.id === threadId);
    return thread ? cloneThread(thread) : null;
}
export async function saveRecentThread(thread) {
    await ensureStorageDirectories();
    return queueHistoryWrite(async () => {
        const threads = await loadRecentThreadsInternal();
        const normalized = threadForPersistence(thread);
        const next = sortAndLimitThreads([normalized, ...threads.filter((item) => item.id !== normalized.id)]);
        const { recentThreadsFile } = getStoragePaths();
        await writeJsonAtomically(recentThreadsFile, { version: HISTORY_VERSION, threads: next });
        return cloneThread(normalized);
    });
}
export async function appendRecentThreadMessage(threadId, message, metadata = {}) {
    await ensureStorageDirectories();
    return queueHistoryWrite(async () => {
        const threads = await loadRecentThreadsInternal();
        const existing = threads.find((thread) => thread.id === threadId);
        if (!existing)
            return null;
        const now = new Date().toISOString();
        const nextMessage = {
            id: message.id || newMessageId(),
            role: message.role,
            text: message.text.trim(),
            createdAt: validTimestamp(message.createdAt, now),
        };
        if (!nextMessage.text)
            return cloneThread(existing);
        const messages = [...existing.messages, nextMessage].slice(-MAX_MESSAGES_PER_THREAD);
        const nextThread = {
            ...existing,
            title: existing.title === 'New conversation' && nextMessage.role === 'user' ? titleFromText(nextMessage.text) : existing.title,
            updatedAt: nextMessage.createdAt,
            messages,
            provider: asNonEmptyString(metadata.provider) || existing.provider,
            model: asNonEmptyString(metadata.model) || existing.model,
            harness: asNonEmptyString(metadata.harness) || existing.harness,
        };
        const next = sortAndLimitThreads([nextThread, ...threads.filter((thread) => thread.id !== threadId)]);
        const { recentThreadsFile } = getStoragePaths();
        await writeJsonAtomically(recentThreadsFile, { version: HISTORY_VERSION, threads: next });
        return cloneThread(nextThread);
    });
}
export function summarizeRecentThreads(threads, limit = MAX_RECENT_THREADS) {
    return sortAndLimitThreads(threads)
        .slice(0, Math.max(0, limit))
        .map((thread) => {
        const lastMessage = thread.messages.at(-1);
        return {
            id: thread.id,
            title: thread.title,
            createdAt: thread.createdAt,
            updatedAt: thread.updatedAt,
            messageCount: thread.messages.length,
            preview: lastMessage ? truncate(lastMessage.text.replace(/\s+/g, ' ').trim(), 120) : '',
            provider: thread.provider,
            model: thread.model,
            harness: thread.harness,
        };
    });
}
// Explicit aliases make the storage contract easy to discover for intro
// screens and integrations that call the data "history" instead of "threads".
export const loadRecentThreadHistory = loadRecentThreads;
export const saveRecentThreadHistory = saveRecentThreads;
