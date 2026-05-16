/**
 * Boot entry for the MAIN-world injected runtime. Installs every interceptor in dependency
 * order, then waits for Angular bootstrap to install the Angular-specific hooks.
 *
 * This file must never throw. Every install function is wrapped in a try/catch so a single
 * broken probe cannot disable the rest of the system.
 */

import { installFetchInterceptor } from './interceptors/fetch.js';
import { installXhrInterceptor } from './interceptors/xhr.js';
import { installConsoleInterceptor } from './interceptors/console.js';
import { installErrorInterceptor } from './interceptors/errors.js';
import { installLongTaskObserver } from './performance/long-task.js';
import { installFpsSampler } from './performance/fps.js';
import { installLayoutShiftObserver } from './performance/layout-shift.js';
import { installDomLeakDetector } from './memory/dom-leaks.js';
import { installListenerTracker } from './memory/listener-tracker.js';
import { installMemorySampler } from './memory/memory-sampler.js';
import { installRxjsTracker } from './rxjs/tracker.js';
import { waitForAngular } from './angular/detect.js';
import {
  installZoneProfiler,
  installApplicationRefTickHook,
} from './angular/zone-profiler.js';
import { installChangeDetectionMonitor } from './angular/change-detection.js';
import { snapshotComponentTree } from './angular/component-tree.js';
import { bridge } from './bridge.js';

let booted = false;

export function bootInjectedRuntime(): void {
  if (booted) return;
  booted = true;

  safely(installFetchInterceptor);
  safely(installXhrInterceptor);
  safely(installConsoleInterceptor);
  safely(installErrorInterceptor);
  safely(installLongTaskObserver);
  safely(installFpsSampler);
  safely(installLayoutShiftObserver);
  safely(installDomLeakDetector);
  safely(installListenerTracker);
  safely(installMemorySampler);
  safely(installRxjsTracker);

  // Angular-specific hooks need a live application. We retry briefly after install.
  void waitForAngular(8000).then((runtime) => {
    if (!runtime.detected) return;
    safely(installZoneProfiler);
    safely(installChangeDetectionMonitor);
    // ApplicationRef.tick patch may need multiple tries — Angular finalizes its app ref after
    // the first complete CD pass.
    const tryHook = (attempts: number): void => {
      if (installApplicationRefTickHook() || attempts <= 0) return;
      setTimeout(() => tryHook(attempts - 1), 500);
    };
    tryHook(8);
  });

  // Flush any accumulated events on visibility change so the engine sees the tail of a session
  // even if the user closes the tab quickly.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') bridge.flush();
  });

  bridge.onControl((envelope) => {
    if (envelope.channel !== 'control' || envelope.type !== 'command') return;
    switch (envelope.payload.name) {
      case 'start-capture':
        bridge.setEnabled(true);
        break;
      case 'stop-capture':
        bridge.setEnabled(false);
        break;
      case 'clear-buffer':
        bridge.flush();
        break;
      case 'request-component-tree':
        bridge.emit({
          source: 'angular',
          kind: 'component-tree',
          tree: snapshotComponentTree(),
        });
        break;
      default:
        break;
    }
  });
}

function safely(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    // We never throw from the injector. Errors are sent through the bridge as console events
    // so they show up in the AI debugger panel itself — useful when developing the extension.
    try {
      bridge.emit({
        source: 'console',
        level: 'warn',
        args: [`[angular-ai-debugger] install hook failed: ${(err as Error).message}`],
      });
    } catch {
      // give up
    }
  }
}
