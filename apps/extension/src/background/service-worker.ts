/**
 * MV3 service worker. Responsibilities:
 *   • Maintain per-tab session state and an event ring buffer.
 *   • Bridge messages between content-scripts, devtools panels, and the AI engine over WebSocket.
 *   • Drive Chrome Debugger (CDP) for Network domain enrichment and HeapProfiler snapshots.
 *
 * The service worker can be terminated by Chrome at any time, so all state is recoverable from
 * chrome.storage.session (per-tab session ids) and the WebSocket reconnect handshake.
 */

import type {
  AnyMessage,
  CapturedEvent,
  ControlCommand,
  Envelope,
} from '@angular-ai-debugger/shared-types';
import { uid, RingBuffer } from '../shared/runtime.js';

const ENGINE_WS_URL = 'ws://127.0.0.1:5758';
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;
const BUFFER_SIZE = 10000;

interface TabState {
  tabId: number;
  sessionId: string;
  /** Ports keyed by the devtools panel inspectedTabId so we can route both ways. */
  devtoolsPort?: chrome.runtime.Port;
  buffer: RingBuffer<CapturedEvent>;
  cdpAttached: boolean;
}

const tabs = new Map<number, TabState>();
let socket: WebSocket | undefined;
let reconnectAttempts = 0;
let reconnectTimer: number | undefined;

/* ------------------------------------------------------------------------ */
/* WebSocket to AI engine                                                   */
/* ------------------------------------------------------------------------ */

function connectEngine(): void {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  try {
    socket = new WebSocket(ENGINE_WS_URL);
  } catch (err) {
    scheduleReconnect();
    return;
  }
  socket.addEventListener('open', () => {
    reconnectAttempts = 0;
    socket?.send(
      JSON.stringify({
        id: uid('hello'),
        channel: 'session',
        type: 'hello',
        source: 'background',
        payload: { version: '0.1.0' },
      } satisfies Envelope),
    );
  });
  socket.addEventListener('message', (ev) => {
    try {
      const msg = JSON.parse(ev.data) as AnyMessage;
      routeFromEngine(msg);
    } catch {
      // engine should not send non-JSON; drop silently
    }
  });
  socket.addEventListener('close', () => scheduleReconnect());
  socket.addEventListener('error', () => socket?.close());
}

function scheduleReconnect(): void {
  if (reconnectTimer !== undefined) return;
  const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** reconnectAttempts);
  reconnectAttempts += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    connectEngine();
  }, delay) as unknown as number;
}

function sendToEngine(msg: Envelope): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
  // Otherwise drop; the devtools panel still sees the events directly.
}

function routeFromEngine(msg: AnyMessage): void {
  // Engine emits analysis / fix / patch messages keyed by tabId. Forward to the matching panel.
  if (msg.tabId === undefined) return;
  const tab = tabs.get(msg.tabId);
  tab?.devtoolsPort?.postMessage(msg);
}

/* ------------------------------------------------------------------------ */
/* Tab state helpers                                                        */
/* ------------------------------------------------------------------------ */

function getTabState(tabId: number): TabState {
  let state = tabs.get(tabId);
  if (!state) {
    state = {
      tabId,
      sessionId: uid('sess'),
      buffer: new RingBuffer<CapturedEvent>(BUFFER_SIZE),
      cdpAttached: false,
    };
    tabs.set(tabId, state);
  }
  return state;
}

chrome.tabs.onRemoved.addListener((tabId) => {
  const tab = tabs.get(tabId);
  if (tab?.cdpAttached) {
    chrome.debugger.detach({ tabId }).catch(() => undefined);
  }
  tabs.delete(tabId);
});

/* ------------------------------------------------------------------------ */
/* Messages from content-scripts (the capture path)                         */
/* ------------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((message: AnyMessage, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (tabId === undefined) return false;
  const tab = getTabState(tabId);

  if (message.channel === 'capture') {
    const batch =
      message.type === 'batch' ? message.payload.events : [message.payload.event];
    for (const ev of batch) tab.buffer.push(ev);
    message.tabId = tabId;
    message.sessionId = tab.sessionId;
    tab.devtoolsPort?.postMessage(message);
    sendToEngine(message);
  } else if (message.channel === 'session' && message.type === 'started') {
    message.tabId = tabId;
    message.sessionId = tab.sessionId;
    message.payload.sessionId = tab.sessionId;
    sendToEngine(message);
  }
  sendResponse({ ok: true });
  return false;
});

/* ------------------------------------------------------------------------ */
/* DevTools panel connection                                                */
/* ------------------------------------------------------------------------ */

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'devtools-panel') return;
  let inspectedTabId: number | undefined;

  port.onMessage.addListener((msg: Envelope) => {
    if (msg.channel === 'session' && msg.type === 'register') {
      inspectedTabId = (msg.payload as { tabId: number }).tabId;
      const tab = getTabState(inspectedTabId);
      tab.devtoolsPort = port;
      flushBuffered(tab, port);
      return;
    }
    if (msg.channel === 'control' && msg.type === 'command') {
      handleControlCommand(msg.payload as ControlCommand, inspectedTabId);
      return;
    }
    // Anything else: forward to engine, tagged with tabId.
    if (inspectedTabId !== undefined) {
      msg.tabId = inspectedTabId;
      const tab = tabs.get(inspectedTabId);
      if (tab) msg.sessionId = tab.sessionId;
      sendToEngine(msg);
    }
  });

  port.onDisconnect.addListener(() => {
    if (inspectedTabId !== undefined) {
      const tab = tabs.get(inspectedTabId);
      if (tab) tab.devtoolsPort = undefined;
    }
  });
});

function flushBuffered(tab: TabState, port: chrome.runtime.Port): void {
  const events = tab.buffer.drain();
  if (events.length === 0) return;
  port.postMessage({
    id: uid('flush'),
    channel: 'capture',
    type: 'batch',
    source: 'background',
    tabId: tab.tabId,
    sessionId: tab.sessionId,
    payload: { events },
  } satisfies Envelope);
}

/* ------------------------------------------------------------------------ */
/* Control commands                                                         */
/* ------------------------------------------------------------------------ */

async function handleControlCommand(
  cmd: ControlCommand,
  tabId: number | undefined,
): Promise<void> {
  if (tabId === undefined) return;
  const tab = getTabState(tabId);

  switch (cmd.name) {
    case 'request-heap-snapshot':
      await captureHeapSnapshot(tab);
      break;
    case 'start-capture':
    case 'stop-capture':
    case 'clear-buffer':
    case 'request-component-tree':
      await chrome.tabs.sendMessage(tabId, {
        id: uid('ctl'),
        channel: 'control',
        type: 'command',
        source: 'background',
        tabId,
        sessionId: tab.sessionId,
        payload: cmd,
      } satisfies Envelope);
      if (cmd.name === 'clear-buffer') tab.buffer.clear();
      break;
    case 'request-analysis':
    case 'request-fix':
    case 'apply-fix':
      // Pass-through to engine.
      sendToEngine({
        id: uid('eng'),
        channel: 'control',
        type: 'command',
        source: 'background',
        tabId,
        sessionId: tab.sessionId,
        payload: cmd,
      } satisfies Envelope);
      break;
  }
}

/* ------------------------------------------------------------------------ */
/* CDP — heap snapshot                                                      */
/* ------------------------------------------------------------------------ */

async function captureHeapSnapshot(tab: TabState): Promise<void> {
  const target = { tabId: tab.tabId };
  try {
    if (!tab.cdpAttached) {
      await chrome.debugger.attach(target, '1.3');
      tab.cdpAttached = true;
    }
    const chunks: string[] = [];
    const onEvent = (
      _source: chrome.debugger.Debuggee,
      method: string,
      params?: object,
    ): void => {
      if (method === 'HeapProfiler.addHeapSnapshotChunk') {
        const p = params as { chunk: string };
        chunks.push(p.chunk);
      }
    };
    chrome.debugger.onEvent.addListener(onEvent);
    await chrome.debugger.sendCommand(target, 'HeapProfiler.enable');
    await chrome.debugger.sendCommand(target, 'HeapProfiler.takeHeapSnapshot', {
      reportProgress: false,
      treatGlobalObjectsAsRoots: true,
    });
    chrome.debugger.onEvent.removeListener(onEvent);
    const snapshotId = uid('heap');
    // Persist sized & content metadata for the engine; the full payload is large so we keep
    // it in extension storage keyed by id.
    await chrome.storage.session.set({
      [`heap:${tab.sessionId}:${snapshotId}`]: {
        bytes: chunks.reduce((acc, c) => acc + c.length, 0),
        capturedAt: Date.now(),
      },
    });
    sendToEngine({
      id: snapshotId,
      channel: 'heap',
      type: 'snapshot-captured',
      source: 'background',
      tabId: tab.tabId,
      sessionId: tab.sessionId,
      payload: { snapshotId, chunks: chunks.length },
    } satisfies Envelope);
  } catch (err) {
    console.warn('[angular-ai-debugger] heap snapshot failed', err);
  }
}

/* ------------------------------------------------------------------------ */
/* Lifecycle                                                                */
/* ------------------------------------------------------------------------ */

connectEngine();
chrome.runtime.onStartup.addListener(connectEngine);
chrome.runtime.onInstalled.addListener(connectEngine);
