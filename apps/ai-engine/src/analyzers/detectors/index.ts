/**
 * Registry of built-in detectors. Add new detectors here; the engine instantiates one Pipeline
 * per session using this list.
 */

import type { Detector } from '@angular-ai-debugger/shared-types';
import { slowApiDetector } from './slow-api.js';
import { duplicateRequestDetector } from './duplicate-request.js';
import { runtimeErrorDetector } from './runtime-error.js';
import { cdStormDetector } from './cd-storm.js';
import { rxjsLeakDetector } from './rxjs-leak.js';
import { domLeakDetector } from './dom-leak.js';
import { performanceDetector } from './performance.js';

export function loadBuiltInDetectors(): Detector[] {
  return [
    slowApiDetector,
    duplicateRequestDetector,
    runtimeErrorDetector,
    cdStormDetector,
    rxjsLeakDetector,
    domLeakDetector,
    performanceDetector,
  ];
}
