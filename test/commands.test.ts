import test from 'node:test';
import assert from 'node:assert/strict';
import {
  completeSlashCommand,
  filterSlashCommands,
  parseCommandInput,
  parseSlashInput,
  resolveCommandInput,
  resolveSlashCommand,
} from '../src/cli/commands.js';

test('slash picker opens at slash and filters by the command token', () => {
  assert.equal(filterSlashCommands('/').length > 5, true);
  assert.deepEqual(filterSlashCommands('/mo').map((item) => item.name), ['model']);
  assert.deepEqual(filterSlashCommands('/quiz react hooks').map((item) => item.name), ['quiz']);
});

test('aliases resolve but the picker presents the canonical command', () => {
  assert.equal(resolveSlashCommand('/drill arrays')?.name, 'quiz');
  assert.equal(resolveSlashCommand('/login')?.name, 'auth');
  assert.equal(filterSlashCommands('/dr').at(0)?.name, 'quiz');
});

test('completion prepares argument commands without executing them', () => {
  const quiz = resolveSlashCommand('/quiz')!;
  assert.equal(completeSlashCommand('/qu', quiz), '/quiz ');
  assert.deepEqual(parseSlashInput('/load notes.pdf'), { command: 'load', args: 'notes.pdf' });
});

test('friendly aliases resolve to the canonical command and preserve bare CLI forms', () => {
  assert.equal(resolveSlashCommand('/review')?.name, 'practice');
  assert.equal(resolveSlashCommand('/path')?.name, 'roadmap');
  assert.equal(resolveSlashCommand('/history')?.name, 'threads');
  assert.equal(resolveSlashCommand('/continue thread_123')?.name, 'resume');
  assert.equal(resolveCommandInput('load notes.pdf')?.name, 'load');
  assert.deepEqual(parseCommandInput('quiz react hooks'), { command: 'quiz', args: 'react hooks' });
});

test('overhauled slash commands resolve /topic, /flashcards, and /help with aliases', () => {
  assert.equal(resolveSlashCommand('/topic')?.name, 'topic');
  assert.equal(resolveSlashCommand('/topic quantum computing')?.name, 'topic');
  assert.equal(resolveSlashCommand('/concept rust')?.name, 'topic');
  assert.equal(resolveSlashCommand('/subject docker')?.name, 'topic');
  assert.deepEqual(parseSlashInput('/topic quantum computing'), { command: 'topic', args: 'quantum computing' });

  assert.equal(resolveSlashCommand('/flashcards')?.name, 'flashcards');
  assert.equal(resolveSlashCommand('/cards')?.name, 'flashcards');
  assert.equal(resolveSlashCommand('/recall')?.name, 'flashcards');
  assert.deepEqual(parseSlashInput('/flashcards algorithms'), { command: 'flashcards', args: 'algorithms' });

  assert.equal(resolveSlashCommand('/help')?.name, 'help');
  assert.equal(resolveSlashCommand('/guide')?.name, 'help');
  assert.equal(resolveSlashCommand('/shortcuts')?.name, 'help');
  assert.equal(resolveSlashCommand('/?') ? resolveSlashCommand('/?')?.name : undefined, 'help');

  const topicCmd = resolveSlashCommand('/topic')!;
  assert.equal(topicCmd.acceptsArgument, true);
  assert.equal(topicCmd.argumentHint, 'topic');
  assert.equal(completeSlashCommand('/top', topicCmd), '/topic ');
});

test('course library commands support deterministic course switching', () => {
  assert.equal(resolveSlashCommand('/courses')?.name, 'courses');
  assert.equal(resolveSlashCommand('/course 2')?.name, 'courses');
  assert.equal(resolveSlashCommand('/switch to alpha')?.name, 'courses');
  assert.equal(resolveSlashCommand('/focus beta')?.name, 'courses');
  assert.equal(completeSlashCommand('/cou', resolveSlashCommand('/courses')!), '/courses ');
});
