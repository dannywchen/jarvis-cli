import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

/** Public, low-cardinality events for rendering an agent's execution trace. */
export type AgentActivityKind = 'thinking' | 'tool';
export type AgentActivityStatus = 'running' | 'complete' | 'error';

export interface AgentActivityEvent {
  id: string;
  kind: AgentActivityKind;
  status: AgentActivityStatus;
  label: string;
  detail?: string;
}

export type AgentActivitySink = (event: AgentActivityEvent) => void;

export type AgentToolName =
  | 'list_files'
  | 'search_files'
  | 'read_file'
  | 'write_file'
  | 'run_command'
  | 'list_courses'
  | 'create_course'
  | 'switch_course'
  | 'delete_course'
  | 'delete_all_courses'
  | 'add_course_content';

export interface AgentToolCall {
  type: 'tool_call';
  tool: AgentToolName;
  input?: Record<string, unknown>;
}

export interface AgentFinalResponse {
  type: 'final';
  message: string;
}

export type AgentEnvelope = AgentToolCall | AgentFinalResponse;

const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'coverage']);
const SAFE_COMMANDS = /^(?:pwd|ls(?:\s|$)|rg(?:\s|$)|git\s+(?:status|diff|log|branch)(?:\s|$)|npm\s+(?:test|run\s+build)(?:\s|$)|npx\s+tsc(?:\s|$)|node\s+--check(?:\s|$)|find(?:\s|$))/;
const MAX_OUTPUT = 8_000;
const MAX_FILE_SIZE = 100_000;

export function workspacePath(input: unknown, cwd = process.cwd()): string {
  if (typeof input !== 'string' || !input.trim()) throw new Error('A workspace-relative path is required.');
  const root = path.resolve(cwd);
  const resolved = path.resolve(root, input);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('That path is outside the current workspace.');
  }
  return resolved;
}

function displayPath(filePath: string, cwd = process.cwd()): string {
  return path.relative(path.resolve(cwd), filePath) || '.';
}

function clipped(value: string, max = MAX_OUTPUT): string {
  return value.length > max ? `${value.slice(0, max)}\n… output clipped …` : value;
}

async function listFiles(cwd: string): Promise<string> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || IGNORED_DIRECTORIES.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else files.push(displayPath(absolute, cwd));
      if (files.length >= 500) return;
    }
  };
  await visit(cwd);
  return clipped(files.sort().join('\n') || '(workspace is empty)');
}

async function searchFiles(input: Record<string, unknown>, cwd: string): Promise<string> {
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  if (!query) throw new Error('A search query is required.');
  const target = input.path ? workspacePath(input.path, cwd) : cwd;
  try {
    return await runProcess('rg', ['-n', '--hidden', '--glob', '!node_modules/**', '--glob', '!.git/**', query, target], cwd);
  } catch (error: any) {
    if (/process exited with code 1\)?$/i.test(error?.message || '')) return '(no matches)';
    throw error;
  }
}

async function readFile(input: Record<string, unknown>, cwd: string): Promise<string> {
  const filePath = workspacePath(input.path, cwd);
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error(`${displayPath(filePath, cwd)} is not a file.`);
  if (stat.size > MAX_FILE_SIZE) throw new Error(`${displayPath(filePath, cwd)} is larger than ${MAX_FILE_SIZE} bytes.`);
  return clipped(await fs.readFile(filePath, 'utf8'), MAX_FILE_SIZE);
}

async function writeFile(input: Record<string, unknown>, cwd: string): Promise<string> {
  const filePath = workspacePath(input.path, cwd);
  const content = typeof input.content === 'string' ? input.content : null;
  if (content === null) throw new Error('write_file requires string content.');
  if (Buffer.byteLength(content, 'utf8') > MAX_FILE_SIZE) throw new Error(`Refusing to write more than ${MAX_FILE_SIZE} bytes.`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
  return `Wrote ${displayPath(filePath, cwd)} (${Buffer.byteLength(content, 'utf8')} bytes).`;
}

async function runCommand(input: Record<string, unknown>, cwd: string): Promise<string> {
  const command = typeof input.command === 'string' ? input.command.trim() : '';
  if (!command) throw new Error('run_command requires a command.');
  if (command.length > 240 || !SAFE_COMMANDS.test(command) || /[\u0000-\u001F\u007F;&|><`$]/.test(command)) {
    throw new Error('Command not allowed. Use read-only inspection commands or npm test / npm run build.');
  }
  return runProcess('/bin/sh', ['-c', command], cwd);
}

function runProcess(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), 20_000);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const output = clipped(`${stdout}${stderr ? `\n${stderr}` : ''}`.trim() || '(no output)');
      if (code && code !== 0) reject(new Error(`${output}\n(process exited with code ${code})`));
      else resolve(output);
    });
  });
}

export function toolActivityLabel(tool: AgentToolName, input: Record<string, unknown> = {}): string {
  const value = (key: string, fallback: string): string => String(input[key] || fallback).replace(/[\u0000-\u001F\u007F]/g, ' ');
  if (tool === 'read_file') return `Read ${value('path', 'file')}`;
  if (tool === 'write_file') return `Edited ${value('path', 'file')}`;
  if (tool === 'search_files') return `Searched for “${value('query', '')}”`;
  if (tool === 'run_command') return `Ran ${value('command', 'command')}`;
  if (tool === 'list_courses') return 'Listed saved courses';
  if (tool === 'create_course') return `Prepared course: ${value('topic', 'new topic')}`;
  if (tool === 'switch_course') return `Loaded course: ${value('selector', 'course')}`;
  if (tool === 'delete_course') return `Removed course: ${value('selector', 'course')}`;
  if (tool === 'delete_all_courses') return 'Removed all saved courses';
  if (tool === 'add_course_content') return `Added course content: ${value('topic', 'new module')}`;
  return 'Listed workspace files';
}

export async function executeAgentTool(call: AgentToolCall, cwd = process.cwd()): Promise<string> {
  const input = call.input || {};
  switch (call.tool) {
    case 'list_files': return listFiles(cwd);
    case 'search_files': return searchFiles(input, cwd);
    case 'read_file': return readFile(input, cwd);
    case 'write_file': return writeFile(input, cwd);
    case 'run_command': return runCommand(input, cwd);
    default: throw new Error(`Unknown tool: ${String(call.tool)}`);
  }
}
