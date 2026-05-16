export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type IssueCategory =
  | 'slow-api'
  | 'duplicate-request'
  | 'runtime-error'
  | 'unhandled-rejection'
  | 'change-detection-storm'
  | 'expensive-template'
  | 'missing-track-by'
  | 'rxjs-leak'
  | 'detached-dom'
  | 'listener-leak'
  | 'heap-growth'
  | 'long-task'
  | 'low-fps'
  | 'layout-thrash';

export type MistralModelId = string;

export interface SourceLocation {
  file: string;
  line?: number;
  column?: number;
  symbol?: string;
}

export interface AnalysisResult {
  id: string;
  detectorId: string;
  category: IssueCategory;
  severity: Severity;
  title: string;
  summary: string;
  detail?: string;
  confidence: number;
  occurrences: number;
  firstSeenMs: number;
  lastSeenMs: number;
  locations: SourceLocation[];
  evidenceEventSeq: number[];
  tags: string[];
}

export interface AnalysisSession {
  id: string;
  startedAt: number;
  endedAt?: number;
  url?: string;
  userAgent?: string;
  counts: Partial<Record<IssueCategory, number>>;
  results: AnalysisResult[];
}

export interface AiAnalysis {
  id: string;
  resultId: string;
  task: 'root-cause';
  model: string;
  severity: Severity;
  headline: string;
  rootCause: string;
  explanation: string;
  recommendedActions: string[];
  affectedLocations: SourceLocation[];
  estimatedEffort: 'trivial' | 'small' | 'medium' | 'large';
  confidence: number;
  generatedAt: number;
  promptTokens?: number;
  completionTokens?: number;
}

export interface AiFixSuggestion {
  id: string;
  analysisId: string;
  model: string;
  title: string;
  body: string;
  autoApplicable: boolean;
  autoApplicableReason: string;
  diff?: string;
  files?: string[];
}

export interface DetectorContext {
  sessionId: string;
  now: () => number;
  emit: (result: AnalysisResult) => void;
  state: Map<string, unknown>;
  log: (level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: unknown) => void;
}

export interface Detector {
  id: string;
  name: string;
  consumes: CapturedEventSource[];
  setup(ctx: DetectorContext): Promise<void> | void;
  analyze(events: CapturedEvent[], ctx: DetectorContext): Promise<AnalysisResult[]> | AnalysisResult[];
  finalize(ctx: DetectorContext): Promise<AnalysisResult[]> | AnalysisResult[];
  cleanup(ctx: DetectorContext): Promise<void> | void;
}

export interface BaseEvent {
  source: CapturedEventSource;
  sessionId: string;
  seq: number;
  pageTime: number;
  wallTime: number;
}

export type CapturedEvent =
  | NetworkEvent
  | ConsoleEvent
  | RuntimeErrorEvent
  | UnhandledRejectionEvent
  | AngularEvent
  | ChangeDetectionEvent
  | ZoneEvent
  | RxjsEvent
  | DomLeakEvent
  | ListenerLeakEvent
  | MemorySampleEvent
  | HeapDiffEvent
  | LongTaskEvent
  | FpsEvent
  | LayoutShiftEvent;

export type CapturedEventSource = CapturedEvent['source'];
export type EventOf<S extends CapturedEventSource> = Extract<CapturedEvent, { source: S }>;

export type NetworkEvent = FetchNetworkEvent | XhrNetworkEvent;

interface BaseNetworkEvent extends BaseEvent {
  kind: 'request' | 'response' | 'error';
  requestId: string;
  method: string;
  url: string;
  requestHeaders?: Record<string, string>;
  requestBodySize?: number;
  requestBodySample?: string;
  responseHeaders?: Record<string, string>;
  responseBodySize?: number;
  responseBodySample?: string;
  status?: number;
  statusText?: string;
  durationMs?: number;
  fromCache?: boolean;
  redacted?: boolean;
  initiator?: {
    type: 'script' | 'parser' | 'other';
    stack?: string;
  };
}

export interface FetchNetworkEvent extends BaseNetworkEvent {
  source: 'fetch';
}

export interface XhrNetworkEvent extends BaseNetworkEvent {
  source: 'xhr';
}

export interface ConsoleEvent extends BaseEvent {
  source: 'console';
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  args: string[];
  stack?: string;
}

export interface RuntimeErrorEvent extends BaseEvent {
  source: 'error';
  message: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  stack?: string;
  componentHint?: string;
}

export interface UnhandledRejectionEvent extends BaseEvent {
  source: 'rejection';
  reason: string;
  stack?: string;
  origin?: string;
}

export interface AngularEvent extends BaseEvent {
  source: 'angular';
  kind: 'detected' | 'component-tree';
  version?: string;
  isIvy?: boolean;
  zoneless?: boolean;
  tree?: ComponentTreeNode[];
}

export interface ComponentTreeNode {
  id: string;
  name: string;
  selector: string;
  tag: string;
  children: ComponentTreeNode[];
}

export interface ChangeDetectionEvent extends BaseEvent {
  source: 'change-detection';
  kind: 'tick' | 'component';
  durationMs: number;
  componentName?: string;
  instanceId?: number;
  cumulativeCount?: number;
}

export interface ZoneEvent extends BaseEvent {
  source: 'zone';
  kind: 'task';
  durationMs: number;
  taskSource?: string;
}

export interface RxjsEvent extends BaseEvent {
  source: 'rxjs';
  kind: 'subscribe' | 'unsubscribe' | 'complete' | 'leak-suspect';
  subscriptionId: number;
  createdAtStack?: string;
  liveMs?: number;
  componentHint?: string;
}

export interface DomLeakEvent extends BaseEvent {
  source: 'dom-leak';
  detachedCount: number;
  examples: Array<{
    tag: string;
    attrs: Record<string, string>;
    depth: number;
  }>;
}

export interface ListenerLeakEvent extends BaseEvent {
  source: 'listener-leak';
  type: string;
  target: string;
  count: number;
  growth: number;
}

export interface MemorySampleEvent extends BaseEvent {
  source: 'memory';
  usedJsHeapSize: number;
  totalJsHeapSize: number;
  jsHeapSizeLimit: number;
}

export interface HeapDiffEvent extends BaseEvent {
  source: 'heap-diff';
  retainedDeltaBytes: number;
  topSuspects: Array<{
    className: string;
    instances: number;
    bytes: number;
  }>;
}

export interface LongTaskEvent extends BaseEvent {
  source: 'long-task';
  durationMs: number;
  startTime?: number;
  attribution?: Array<{
    name: string;
    containerType: string;
  }>;
}

export interface FpsEvent extends BaseEvent {
  source: 'fps';
  fps: number;
  jankFrames: number;
  windowMs: number;
}

export interface LayoutShiftEvent extends BaseEvent {
  source: 'layout-shift';
  value: number;
  hadRecentInput: boolean;
  sources?: Array<{
    node: string;
    previousRect: DOMRectInit;
    currentRect: DOMRectInit;
  }>;
}

export type ControlCommand =
  | { name: 'start-capture' }
  | { name: 'stop-capture' }
  | { name: 'clear-buffer' }
  | { name: 'request-component-tree' }
  | { name: 'request-heap-snapshot' }
  | { name: 'request-analysis' }
  | { name: 'request-fix'; analysisId: string }
  | { name: 'apply-fix'; fixId: string; dryRun?: boolean };

export type Envelope =
  | SessionEnvelope
  | CaptureEnvelope
  | ControlEnvelope
  | AnalysisEnvelope
  | FixEnvelope
  | HeapEnvelope;

export type AnyMessage = Envelope;

export interface EnvelopeBase {
  id: string;
  channel: string;
  type: string;
  source: 'page' | 'content' | 'background' | 'devtools' | 'engine';
  tabId?: number;
  sessionId?: string;
}

export interface SessionEnvelope extends EnvelopeBase {
  channel: 'session';
  type: 'hello' | 'register' | 'started';
  payload: {
    version?: string;
    tabId?: number;
    sessionId?: string;
    url?: string;
    userAgent?: string;
  };
}

export type CaptureEnvelope =
  | (EnvelopeBase & {
      channel: 'capture';
      type: 'event';
      payload: { event: CapturedEvent };
    })
  | (EnvelopeBase & {
      channel: 'capture';
      type: 'batch';
      payload: { events: CapturedEvent[] };
    });

export interface ControlEnvelope extends EnvelopeBase {
  channel: 'control';
  type: 'command';
  payload: ControlCommand;
}

export type AnalysisEnvelope =
  | (EnvelopeBase & {
      channel: 'analysis';
      type: 'results';
      payload: {
        results: AnalysisResult[];
        analyses?: AiAnalysis[];
      };
    })
  | (EnvelopeBase & {
      channel: 'analysis';
      type: 'session-update';
      payload: {
        session: AnalysisSession;
        analyses?: AiAnalysis[];
      };
    });

export interface FixEnvelope extends EnvelopeBase {
  channel: 'fix';
  type: 'suggestion';
  payload: {
    suggestion: AiFixSuggestion;
  };
}

export interface HeapEnvelope extends EnvelopeBase {
  channel: 'heap';
  type: 'snapshot-captured' | 'snapshot-failed';
  payload: {
    snapshotId?: string;
    chunks?: number;
    error?: string;
  };
}

export function eventsOf<S extends CapturedEventSource>(
  events: CapturedEvent[],
  source: S,
): EventOf<S>[] {
  return events.filter((event): event is EventOf<S> => event.source === source);
}

export function isEnvelope(value: unknown): value is Envelope {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<EnvelopeBase> & { payload?: unknown };
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.channel === 'string' &&
    typeof candidate.type === 'string' &&
    typeof candidate.source === 'string' &&
    'payload' in candidate
  );
}
