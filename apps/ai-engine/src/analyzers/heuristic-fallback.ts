/**
 * Deterministic fallback used when no Mistral key is configured. We produce an AiAnalysis from
 * the detector result alone — slightly more verbose than the result's own summary, but with no
 * external dependency. This keeps the panel useful for offline / air-gapped usage.
 */

import type {
  AiAnalysis,
  AnalysisResult,
  IssueCategory,
} from '@angular-ai-debugger/shared-types';

interface RecipeText {
  rootCause: string;
  explanation: string;
  actions: string[];
}

const RECIPES: Partial<Record<IssueCategory, RecipeText>> = {
  'slow-api': {
    rootCause: 'A backend endpoint is responding slower than 1.5s, blocking the UX path that depends on it.',
    explanation:
      'Likely on the server side or due to a missing cache. From the client there are still ways to mitigate: avoid issuing the request twice, parallelize unrelated calls, and show a skeleton state so the user knows the system is alive.',
    actions: [
      'Confirm the slow endpoint with a network trace.',
      'Verify there is no duplicate of this request in flight (check shareReplay / HttpClient caching).',
      'Add a server-side metric or trace and ticket the API owner.',
      'In the meantime, surface a loading state in the Angular component instead of blocking interactions.',
    ],
  },
  'duplicate-request': {
    rootCause: 'The same endpoint is being requested many times in a short window, usually because a subscription was created without shareReplay or the template recomputes a value on every change-detection cycle.',
    explanation:
      'Each call costs round-trip time and CPU. Two common patterns produce this: (1) an *ngIf with a function that returns a new Observable each time; (2) Routes that resubscribe to the same Resolver on every navigation.',
    actions: [
      'Wrap the underlying Observable with shareReplay({ bufferSize: 1, refCount: true }).',
      'Convert template function calls to AsyncPipe or a signal.',
      'If the route resolver is the offender, switch to runGuardsAndResolvers: "pathParamsChange".',
    ],
  },
  'runtime-error': {
    rootCause: 'A runtime error was thrown and not caught by application code.',
    explanation:
      'Even when wrapped in NgZone, unhandled errors disrupt the user flow and may corrupt component state. The stack identifies where to look.',
    actions: [
      'Reproduce locally with the same route / data.',
      'Add a try/catch (or catchError on the relevant pipe) at the boundary indicated by the stack.',
      'Surface the error to the user via a non-blocking notification instead of a thrown exception.',
    ],
  },
  'unhandled-rejection': {
    rootCause: 'A Promise rejection escaped without a .catch() or a try/await wrapper.',
    explanation:
      'Unhandled rejections are mostly caused by async/await without try/catch, or by Observables converted to Promises (firstValueFrom / lastValueFrom) without error handling.',
    actions: [
      'Find the awaiting site from the stack and wrap with try/catch.',
      'If the source is an Observable, prefer .subscribe with the error callback or rxjs catchError.',
    ],
  },
  'change-detection-storm': {
    rootCause: 'ApplicationRef.tick() is firing at high frequency. Usually an Observable in a template, a setInterval, or a non-Zone-aware async task keeps dirtying the tree.',
    explanation:
      'Each tick re-runs change detection across every binding. If a hot component participates, this compounds. The fix is to make tick rate bound by user action or input — not by clock.',
    actions: [
      'Identify the originating task source (setInterval / setTimeout / Promise.then) — see Zone events.',
      'Move the work outside NgZone with NgZone.runOutsideAngular(), then re-enter only for UI updates.',
      'Convert top-level components to OnPush change-detection where possible.',
    ],
  },
  'expensive-template': {
    rootCause: 'A specific component re-renders much more often than its peers, indicating an expensive binding or a missing OnPush.',
    explanation:
      'Two checks: (1) does the template call a method directly ({{ compute() }})? (2) does an *ngFor lack trackBy? Both cause Angular to do more work than needed on every CD cycle.',
    actions: [
      'Replace template methods with signals or memoized getters.',
      'Add trackBy on every *ngFor over arrays of objects.',
      'Switch the component to ChangeDetectionStrategy.OnPush.',
    ],
  },
  'rxjs-leak': {
    rootCause: 'Subscriptions are still alive >30s after their component should have been destroyed.',
    explanation:
      'The likely path: ngOnInit creates a long-lived Observable subscription that is never unsubscribed. The fix is to declare the lifetime explicitly.',
    actions: [
      'Replace manual .subscribe() with AsyncPipe in the template where possible.',
      'For imperative subscriptions, pipe(takeUntilDestroyed(inject(DestroyRef))) so the framework cleans up on destruction.',
      'Audit shareReplay usage — the default bufferSize=Infinity can keep references forever; add refCount: true.',
    ],
  },
  'detached-dom': {
    rootCause: 'DOM nodes are detached from the document but still strongly referenced by JS, preventing GC.',
    explanation:
      'Usually a closure (event handler, observer, or external library) holds the element. Angular destroys the view but the reference outlives it.',
    actions: [
      'Take heap snapshots before and after navigating away; look for nodes with the highest retained size whose constructor is HTMLDivElement (or your component selector).',
      'Look for setInterval / MutationObserver / ResizeObserver / IntersectionObserver instances created in ngOnInit and not disconnected in ngOnDestroy.',
      'When integrating non-Angular libraries, store the instance in a DestroyRef-bound cleanup.',
    ],
  },
  'listener-leak': {
    rootCause: 'Event listeners are added but never removed; their reference count keeps growing.',
    explanation: 'Common with global listeners on window/document and with directives that listen to scroll or resize without an unsubscribe in ngOnDestroy.',
    actions: [
      'For host-level events, prefer @HostListener — Angular cleans up automatically.',
      'For window/document listeners, store them in a field and call removeEventListener inside ngOnDestroy or a DestroyRef hook.',
    ],
  },
  'long-task': {
    rootCause: 'A single JS task blocked the main thread for more than 100ms.',
    explanation:
      'Probably synchronous data shaping inside a hot path, a large change-detection cycle, or a synchronous XHR. The frame budget is 16ms; anything past that breaks animations.',
    actions: [
      'Move heavy work to a Web Worker (good for parsing, deserialization, transformation).',
      'Break the work into chunks with requestIdleCallback or queueMicrotask batches.',
      'Lazy-load infrequently used modules.',
    ],
  },
  'low-fps': {
    rootCause: 'The page is rendering below 24 fps. The user sees jank.',
    explanation:
      'Frequent causes: animations driven by setInterval rather than requestAnimationFrame, layout thrashing inside scroll handlers, or expensive CSS (filter, drop-shadow on large elements).',
    actions: [
      'Move scroll/resize work to a debounced rAF callback.',
      'Defer heavy CSS effects with content-visibility: auto.',
      'Profile with Performance > FPS meter to confirm the bottleneck.',
    ],
  },
  'layout-thrash': {
    rootCause: 'CLS > 0.1 — visible content shifts after first paint.',
    explanation: 'Images, ads, fonts, or async-loaded components are shifting the layout. Browsers reflow when an element\'s size becomes known late.',
    actions: [
      'Reserve space for images and embeds (width/height attributes, aspect-ratio CSS).',
      'Use font-display: optional or swap with size-adjust to avoid layout shift when web fonts arrive.',
      'For async components, render a placeholder with the final dimensions.',
    ],
  },
};

export function heuristicAnalysis(result: AnalysisResult): AiAnalysis {
  const recipe = RECIPES[result.category] ?? {
    rootCause: result.summary,
    explanation:
      'Heuristic fallback — no AI model is configured. The detector\'s own summary is the best information available.',
    actions: ['Configure MISTRAL_API_KEY in apps/ai-engine/.env to unlock AI-powered analysis.'],
  };
  return {
    id: `heuristic:${result.id}`,
    resultId: result.id,
    task: 'root-cause',
    model: 'ministral-3-8b-25-12',
    severity: result.severity,
    headline: result.title,
    rootCause: recipe.rootCause,
    explanation: recipe.explanation,
    recommendedActions: recipe.actions,
    affectedLocations: result.locations,
    estimatedEffort: result.severity === 'critical' ? 'medium' : 'small',
    confidence: 0.5,
    generatedAt: Date.now(),
  };
}
