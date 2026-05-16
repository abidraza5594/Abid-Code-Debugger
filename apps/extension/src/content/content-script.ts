/**
 * Content-script — runs in the ISOLATED world. Two responsibilities:
 *   1) Inject the MAIN-world bundle (apps/extension/dist/content/inject.js) into the page so
 *      we can monkey-patch fetch/XHR/Zone/etc. with full page access.
 *   2) Bridge window.postMessage events from the page to chrome.runtime, and route control
 *      commands the other way.
 */

import type { AnyMessage, Envelope } from '@angular-ai-debugger/shared-types';
import { uid } from '../shared/runtime.js';

const BRIDGE_TAG = '__angular_ai_debugger__';

function injectMainWorldScript(): void {
  const url = chrome.runtime.getURL('content/inject.js');
  const script = document.createElement('script');
  script.type = 'module';
  script.src = url;
  script.dataset.tag = BRIDGE_TAG;
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

window.addEventListener('message', (ev: MessageEvent) => {
  if (ev.source !== window) return;
  const data = ev.data as { tag?: string; envelope?: Envelope } | null;
  if (!data || data.tag !== BRIDGE_TAG || !data.envelope) return;
  // Forward upstream to background.
  chrome.runtime.sendMessage(data.envelope).catch(() => undefined);
});

chrome.runtime.onMessage.addListener((message: AnyMessage) => {
  // Control commands from background → re-broadcast into MAIN world.
  window.postMessage({ tag: BRIDGE_TAG, envelope: message }, '*');
});

// Tell the page we are present (handy for SPAs that may want to enable diagnostic mode).
window.dispatchEvent(new CustomEvent('angular-ai-debugger:attached'));

// Inform background a session is starting for this top-frame.
chrome.runtime
  .sendMessage({
    id: uid('start'),
    channel: 'session',
    type: 'started',
    source: 'content',
    payload: {
      sessionId: '',
      url: location.href,
      userAgent: navigator.userAgent,
    },
  } satisfies Envelope)
  .catch(() => undefined);

injectMainWorldScript();
