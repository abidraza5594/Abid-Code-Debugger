# Abid Debugger Ko Kaise Start Aur Test Kare

Ye guide simple Hinglish me hai. Isko follow karke tum local AI engine start kar sakte ho, Chrome extension load kar sakte ho, aur Angular app debug/test kar sakte ho.

## 1. Project Folder Open Karo

PowerShell open karo aur project root me jao:

```powershell
cd "C:\ABID\ABID DEBUGGER EXTENTION"
```

## 2. Dependencies Install Karo

Agar `node_modules` nahi hai ya pehli baar project run kar rahe ho:

```powershell
npm install
```

## 3. API Key Kahan Daalni Hai

Actual API key `.env` file me daalni hai:

```text
apps/ai-engine/.env
```

Important:

- `.env.example` me API key mat daalo.
- `.env.example` sirf sample/template file hai.
- `.env` private file hai.
- `.env` gitignore me hai, isliye commit nahi hogi.

`.env` file me Mistral use karne ke liye:

```env
AI_PROVIDER=mistral
MISTRAL_API_KEY=your_actual_api_key_here
```

Agar API key use nahi karni aur offline fallback chahiye:

```env
AI_PROVIDER=heuristic
```

Agar local Ollama use karna hai:

```env
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_ROOT_CAUSE_MODEL=qwen2.5-coder:14b
OLLAMA_FIX_MODEL=qwen2.5-coder:14b
```

## 4. Build Karo

```powershell
npm run build
```

Build ke baad Chrome extension yahan ready hogi:

```text
apps/extension/dist
```

## 5. Local AI Engine Start Karo

```powershell
npm run start -w @angular-ai-debugger/ai-engine
```

Expected output kuch aisa hona chahiye:

```text
HTTP listening on http://127.0.0.1:5757
WebSocket listening on :5758
AI provider=mistral enabled
```

Health check ke liye dusri PowerShell window me:

```powershell
Invoke-RestMethod http://127.0.0.1:5757/health
```

Expected response:

```json
{
  "ok": true,
  "version": "0.1.0"
}
```

## 6. Chrome Extension Load Karo

Chrome me open karo:

```text
chrome://extensions
```

Phir:

1. Developer mode ON karo.
2. Load unpacked click karo.
3. Ye folder select karo:

```text
C:\ABID\ABID DEBUGGER EXTENTION\apps\extension\dist
```

## 7. Angular App Ke Saath Use Kaise Kare

1. Apni Angular app start karo, jaise:

```powershell
npm start
```

ya:

```powershell
ng serve
```

2. Browser me app open karo:

```text
http://localhost:4200
```

3. DevTools open karo:

```text
F12
```

4. DevTools me `Abid Debugger` tab open karo.

5. App me issue reproduce karo.

6. Panel me ye tabs check karo:

- `Errors`
- `Network`
- `Angular`
- `Memory`
- `RxJS`
- `Performance`
- `AI Suggestions`
- `Auto Fixes`

## 8. Test Kaise Kare

Angular app ke browser console me ye commands run karke extension test kar sakte ho.

### Console Error Test

```js
console.error("AI debugger test error", new Error("Test stack"));
```

Expected:

- `Abid Debugger` panel ke `Errors` tab me error dikhna chahiye.

### Uncaught Error Test

```js
setTimeout(() => {
  throw new Error("AI debugger uncaught test error");
}, 1000);
```

Expected:

- `Errors` tab me uncaught error dikhna chahiye.

### Promise Rejection Test

```js
Promise.reject(new Error("AI debugger rejected promise test"));
```

Expected:

- `Errors` tab me unhandled rejection dikhna chahiye.

### Network Request Test

```js
fetch("https://jsonplaceholder.typicode.com/todos/1");
```

Expected:

- `Network` tab me request/response dikhna chahiye.

### Failed Network Test

```js
fetch("https://jsonplaceholder.typicode.com/bad-endpoint-404");
```

Expected:

- `Network` tab me failed/404 request dikhna chahiye.

## 9. AI Analysis Kaise Chalana Hai

Events capture hone ke baad DevTools panel me:

```text
Analyze
```

button click karo.

Agar:

- `AI_PROVIDER=mistral` hai, to Mistral se root-cause explanation aayegi.
- `AI_PROVIDER=ollama` hai, to local Ollama se explanation aayegi.
- `AI_PROVIDER=heuristic` hai, to deterministic fallback suggestion aayegi.

## 9A. Har Tab Ko Simple Hinglish Me Samjho

### Errors Tab

Ye tab batata hai app me console warning/error ya uncaught error aa raha hai ya nahi.

Common lines:

```text
console.warn
console.error
Unhandled rejection
webpack-dev-server WARNING
```

Meaning:

- `warn` = warning hai. App chal sakti hai, but performance/config issue ho sakta hai.
- `error` = serious. Code me bug ho sakta hai.
- `Unhandled rejection` = Promise reject hui but catch nahi hui.
- `webpack-dev-server WARNING` = mostly development/build warning. Immediate crash nahi.

Kya karna hai:

- Red/high errors pehle dekho.
- Stack trace me file/component name dhoondo.
- Promise rejection ke liye `try/catch` ya RxJS `catchError` add karo.
- CommonJS warning ke liye dependency replacement ya Angular allowedCommonJsDependencies config check karo.

### Network Tab

Ye tab API calls batata hai.

Example:

```text
GET /api/v1/leads 200 / 2113ms
POST /track 200 / 158ms
```

Meaning:

- `GET/POST` = request type.
- `200` = success.
- `404` = endpoint nahi mila.
- `401/403` = auth/permission problem.
- `500` = backend/server error.
- `2113ms` = API ko 2.1 seconds lage.

Rule of thumb:

- `0-500ms` = good.
- `500-1500ms` = okay but watch.
- `1500ms+` = slow.
- Same URL baar-baar aa rahi hai = duplicate request/polling suspect.

Kya karna hai:

- Slow API ke backend logs check karo.
- Same API duplicate ho rahi hai to duplicate subscription/search/filter trigger check karo.
- Analytics requests like Mixpanel usually ignore kar sakte ho unless bahut spam ho.

### Angular Tab

Ye Angular internals batata hai.

Example:

```text
CD LeadsActionsComponent      123 / 0MS
Zone task requestAnimationFrame
```

Meaning:

- `CD` = Change Detection.
- `LeadsActionsComponent` = component name.
- `123` = tool ne is component ko 123 baar change-detection sampling me count/observe kiya.
- `0MS` = us sample ka measured time. 0MS ka matlab always safe nahi hota.
- `Zone task` = async task jo Angular ko update/change detection trigger kar sakta hai.

Important:

Ye exact Angular render count nahi hai. Ye tool ka sampled/inferred count hai. Higher count ka matlab component frequently check/render path me aa raha hai.

Kya karna hai:

- High count component me template function calls check karo.
- Large `*ngFor` me `trackBy` add karo.
- `ChangeDetectionStrategy.OnPush` use karo.
- Repeated row/action components ko memoize/optimize karo.
- Very large list ho to virtual scrolling/pagination use karo.

### Memory Tab

Ye memory aur leak suspects batata hai.

Example:

```text
Heap sample 131.6 MiB
Detached DOM: 120 nodes
Listener leak on XMLHttpRequest.readystatechange
```

Meaning:

- `Heap sample` = JS memory usage.
- `Detached DOM` = element page se remove ho gaya but memory me reference bacha ho sakta hai.
- `Listener leak` = event listener add ho rahe hain but remove nahi ho rahe.

Kya karna hai:

- Agar heap continuously grow kar raha hai aur down nahi aa raha, memory leak suspect.
- `ngOnDestroy` ya `DestroyRef` cleanup check karo.
- `removeEventListener`, `observer.disconnect`, `clearInterval`, `clearTimeout` use karo.
- Third-party grid/chart/modal libraries ka destroy method call ho raha hai ya nahi check karo.

### RxJS Tab

Ye subscriptions track karta hai.

Meaning:

- Empty tab = abhi RxJS leak signal nahi mila. Ye normal hai.
- `subscribe` = subscription start hui.
- `unsubscribe` = cleanup ho gaya.
- `leak-suspect` = subscription long time tak alive hai.

Kya karna hai:

- Template me possible ho to `async pipe` use karo.
- Manual subscribe me `takeUntilDestroyed(inject(DestroyRef))` use karo.
- `shareReplay()` ko safely use karo:

```ts
shareReplay({ bufferSize: 1, refCount: true })
```

- Nested subscribe avoid karo; `switchMap`, `mergeMap`, `concatMap` use karo.

### Performance Tab

Ye UI lag/jank batata hai.

Example:

```text
FPS 7
Long task 690ms
Layout shift 0.12
```

Meaning:

- `FPS` = frames per second. 60 smooth, 30 low, 24 se neeche bad.
- `Long task` = browser main thread busy tha. User ko freeze/lag feel hota hai.
- `Layout shift` = page elements suddenly move hue.

Kya karna hai:

- Heavy table/list rendering optimize karo.
- Scroll handlers throttle/debounce karo.
- Template me heavy functions/pipes avoid karo.
- Images/iframes ke width/height reserve karo.
- Large work ko Web Worker ya chunking me move karo.

### AI Suggestions Tab

Ye sab signals ko issue cards me convert karta hai.

Example:

```text
Frame rate dropped to 4 fps
LeadsActionsComponent re-rendering 870x
Detached DOM nodes still reachable
```

Meaning:

- Tool bol raha hai yahan potential issue hai.
- High/Critical pehle dekhna.
- Analyze button dabane ke baad AI/root-cause explanation aayega.

Kya karna hai:

1. Clear dabao.
2. App me issue reproduce karo.
3. AI Suggestions me jao.
4. Analyze dabao.
5. Top high severity finding se fix start karo.

### Auto Fixes Tab

Ye generated patch preview dikhata hai.

Meaning:

- Empty tab = abhi fix generate nahi hua.
- `safe` = deterministic rule se patch bana, phir bhi review zaroor karo.
- `review` = AI suggestion hai, direct apply mat karo bina samjhe.

Kya karna hai:

- Patch read karo.
- File path check karo.
- Tests chalao.
- Agar unsure ho to patch manually apply karne se pehle review karao.

## 9B. Tumhare Screenshot Wale Issues Ka Meaning

Tumhare screenshot me ye signals important the:

```text
Frame rate dropped to 4 fps
Long task max 690ms
LeadsActionsComponent re-rendering
Detached DOM nodes
Listener leak
Slow API 1500ms+
```

Simple meaning:

- Page lag kar raha hai.
- Browser main thread block ho raha hai.
- Leads list/actions component baar-baar check ho raha hai.
- Kuch DOM/listeners cleanup suspicious hain.
- Kuch API calls slow hain.

Most likely areas:

- Leads table/list rendering.
- Row action component.
- ng-select components.
- Search/filter/list refresh logic.
- Event listener cleanup.
- API duplicate calls.

Fix direction:

- `LeadsActionsComponent` me `ChangeDetectionStrategy.OnPush` check karo.
- Parent list me `trackBy` add karo.
- Template me function calls remove karo.
- Large list me pagination/virtual scroll use karo.
- Manual subscriptions me `takeUntilDestroyed` use karo.
- Listeners/observers/timers cleanup karo.
- Slow API ke backend logs check karo.

## 10. Heap / Memory Snapshot Test

DevTools panel me:

```text
Heap
```

button click karo.

Chrome permission maang sakta hai because extension Chrome Debugger API use karti hai. Allow karna padega.

Note:

- Heap snapshot heavy hota hai.
- Is button ko baar-baar mat dabao.
- Agar deny kar diya to baaki extension still work karegi.

## 11. Reports Kaise Generate Kare

Jab session analyze ho jaye, report generate karne ke liye:

```powershell
npm run report -w @angular-ai-debugger/ai-engine -- --session <session-id>
```

Reports yahan banenge:

```text
apps/ai-engine/data/reports/<session-id>/
```

## 12. Kya Karna Hai

- Engine start rakhna jab extension use kar rahe ho.
- Extension hamesha `apps/extension/dist` se load karna.
- Code change ke baad dobara `npm run build` chalana.
- API key sirf `.env` me rakhna.
- Pehle `AI_PROVIDER=heuristic` se smoke test karna safe hai.
- Real Angular app me issue reproduce karke `Analyze` click karna.

## 13. Kya Nahi Karna Hai

- API key `.env.example` me mat daalna.
- API key code/docs me mat daalna.
- `.env` commit mat karna.
- Extension ko `src` folder se load mat karna.
- Heap snapshot button baar-baar mat dabana.
- Sensitive production user data ke saath careless testing mat karna.

## 14. Verification Commands

Project healthy hai ya nahi check karne ke liye:

```powershell
npm run typecheck
npm run build
npm run test
npm audit --omit=dev
```

## 15. Common Problems

### Abid Debugger Tab Nahi Dikh Raha

- Chrome extension reload karo.
- Confirm karo extension `apps/extension/dist` se load hui hai.
- DevTools close/open karo.

### Events Nahi Aa Rahe

- Angular app reload karo.
- DevTools ka `Abid Debugger` tab open rakho.
- Extension reload karo.
- Console me test error run karo.

### AI Response Nahi Aa Raha

- Engine running hai ya nahi check karo.
- `.env` me `AI_PROVIDER` check karo.
- Mistral key valid hai ya nahi check karo.
- Health check run karo:

```powershell
Invoke-RestMethod http://127.0.0.1:5757/health
```

### Build Fail Ho Raha Hai

```powershell
npm install
npm run typecheck
npm run build
```

## 16. Short Daily Flow

Roz use karne ke liye bas ye yaad rakho:

```powershell
cd "C:\ABID\ABID DEBUGGER EXTENTION"
npm run build
npm run start -w @angular-ai-debugger/ai-engine
```

Phir Chrome me Angular app open karo, DevTools me `Abid Debugger` tab use karo.
