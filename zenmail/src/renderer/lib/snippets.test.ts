// @vitest-environment jsdom
// textToFragment uses document.createDocumentFragment/createTextNode/createElement, which require
// a DOM. jsdom is installed as a devDependency solely for this file (rest of the suite runs in
// vitest's default node environment).
import { describe, expect, it } from 'vitest';
import { filterSnippets, newSnippet, parseSnippets, textToFragment } from './snippets';

describe('parseSnippets', () => {
  it('returns [] for null/undefined input', () => {
    expect(parseSnippets(null)).toEqual([]);
    expect(parseSnippets(undefined)).toEqual([]);
  });

  it('returns [] for malformed JSON (TC-A1)', () => {
    expect(parseSnippets('{not valid json')).toEqual([]);
  });

  it('returns [] when the parsed root is not an array', () => {
    expect(parseSnippets('{"id":"a"}')).toEqual([]);
  });

  it('filters out individually-corrupt items while keeping valid ones', () => {
    const raw = JSON.stringify([
      { id: '1', name: 'Valid', body: 'hello', createdAt: 100 },
      { id: '2', name: 'Missing body', createdAt: 200 },
      { id: '3', name: 123, body: 'bad name type', createdAt: 300 },
      null,
      'not an object',
      { id: '4', name: 'Also valid', body: 'world', createdAt: 400 },
    ]);
    expect(parseSnippets(raw)).toEqual([
      { id: '1', name: 'Valid', body: 'hello', createdAt: 100 },
      { id: '4', name: 'Also valid', body: 'world', createdAt: 400 },
    ]);
  });

  it('round-trips a fully valid list', () => {
    const list = [{ id: '1', name: 'Sig', body: 'Best,\nMe', createdAt: 1 }];
    expect(parseSnippets(JSON.stringify(list))).toEqual(list);
  });
});

describe('filterSnippets', () => {
  const list = [
    { id: '1', name: 'Meeting Follow-up', body: 'Thanks for joining today', createdAt: 1 },
    { id: '2', name: 'Thank you', body: 'Appreciate the meeting', createdAt: 2 },
    { id: '3', name: 'Unrelated', body: 'Nothing to see here', createdAt: 3 },
  ];

  it('returns the full list for a blank/whitespace query (TC-A3)', () => {
    expect(filterSnippets(list, '')).toEqual(list);
    expect(filterSnippets(list, '   ')).toEqual(list);
  });

  it('matches case-insensitively on name', () => {
    expect(filterSnippets(list, 'MEETING')).toEqual([list[0], list[1]]);
  });

  it('matches case-insensitively on body', () => {
    expect(filterSnippets(list, 'appreciate')).toEqual([list[1]]);
  });

  it('returns [] when nothing matches', () => {
    expect(filterSnippets(list, 'zzz-no-match')).toEqual([]);
  });
});

describe('textToFragment', () => {
  it('splits lines into text nodes joined by <br> elements', () => {
    const fragment = textToFragment('line1\nline2\nline3');
    const nodes = Array.from(fragment.childNodes);
    expect(nodes).toHaveLength(5);
    expect(nodes[0].nodeType).toBe(Node.TEXT_NODE);
    expect(nodes[0].textContent).toBe('line1');
    expect(nodes[1].nodeName).toBe('BR');
    expect(nodes[2].textContent).toBe('line2');
    expect(nodes[3].nodeName).toBe('BR');
    expect(nodes[4].textContent).toBe('line3');
  });

  it('produces a single text node for input with no newlines', () => {
    const fragment = textToFragment('single line');
    expect(fragment.childNodes).toHaveLength(1);
    expect(fragment.childNodes[0].nodeType).toBe(Node.TEXT_NODE);
  });

  it('leaves markup-like text as a literal text node, not an element (TC-A2)', () => {
    const fragment = textToFragment('<img src=x onerror=alert(1)>');
    expect(fragment.childNodes).toHaveLength(1);
    const node = fragment.childNodes[0];
    expect(node.nodeType).toBe(Node.TEXT_NODE);
    expect(node.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(fragment.querySelector('img')).toBeNull();
  });
});

describe('newSnippet', () => {
  it('builds a record with a generated id and the given fields', () => {
    const s = newSnippet('Signature', 'Best,\nMe', 12345);
    expect(s.name).toBe('Signature');
    expect(s.body).toBe('Best,\nMe');
    expect(s.createdAt).toBe(12345);
    expect(typeof s.id).toBe('string');
    expect(s.id.length).toBeGreaterThan(0);
  });

  it('generates distinct ids across calls', () => {
    const a = newSnippet('A', 'a', 1);
    const b = newSnippet('B', 'b', 1);
    expect(a.id).not.toBe(b.id);
  });
});
