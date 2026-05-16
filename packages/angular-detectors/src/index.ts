/**
 * Public package surface for additional Angular-specific runtime detectors.
 *
 * The v0.1 built-ins (cd-storm, runtime-error) live under apps/ai-engine for convenience;
 * once the engine grows, they'll move here. Until then this package exists so the workspace
 * structure matches the documented monorepo layout and third-party detectors have a clear
 * plug-in target.
 */

import type { Detector } from '@angular-ai-debugger/shared-types';

export type AngularDetector = Detector;

export const angularDetectorPlugins: AngularDetector[] = [];
