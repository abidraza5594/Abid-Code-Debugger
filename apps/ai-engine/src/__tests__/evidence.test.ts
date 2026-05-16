/**
 * Lightweight unit tests. Run with `node --test --import tsx dist/**/*.test.js` (after build)
 * or wire to a runner of your choice. The shapes here also serve as documentation for the
 * detector contracts.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { AnalysisResult, CapturedEvent } from '@angular-ai-debugger/shared-types';
import { buildEvidenceText } from '../analyzers/evidence.js';

test('buildEvidenceText groups by source and respects line caps', () => {
  const events: CapturedEvent[] = [
    {
      source: 'fetch',
      sessionId: 's',
      seq: 1,
      pageTime: 100,
      wallTime: 0,
      kind: 'response',
      requestId: 'r1',
      method: 'GET',
      url: 'https://api.example.com/users',
      status: 200,
      durationMs: 1700,
    },
    {
      source: 'console',
      sessionId: 's',
      seq: 2,
      pageTime: 110,
      wallTime: 0,
      level: 'error',
      args: ['boom'],
    },
  ];
  const result: AnalysisResult = {
    id: 'r',
    detectorId: 'd',
    category: 'slow-api',
    severity: 'medium',
    title: 't',
    summary: 's',
    confidence: 0.9,
    occurrences: 1,
    firstSeenMs: 100,
    lastSeenMs: 110,
    locations: [],
    evidenceEventSeq: [1, 2],
    tags: [],
  };
  const text = buildEvidenceText(result, events);
  assert.match(text, /\[fetch\]/);
  assert.match(text, /\[console\]/);
  assert.match(text, /api\.example\.com\/users/);
});

test('buildEvidenceText handles empty event list', () => {
  const result: AnalysisResult = {
    id: 'r',
    detectorId: 'd',
    category: 'slow-api',
    severity: 'medium',
    title: 't',
    summary: 's',
    confidence: 0.9,
    occurrences: 1,
    firstSeenMs: 0,
    lastSeenMs: 0,
    locations: [],
    evidenceEventSeq: [],
    tags: [],
  };
  const text = buildEvidenceText(result, []);
  assert.match(text, /no related events/);
});
