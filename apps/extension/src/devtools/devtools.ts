/**
 * DevTools page — invoked once per devtools window. We register a single panel.
 */

chrome.devtools.panels.create(
  'AI Debugger',
  'icons/icon-48.png',
  'panel.html',
  () => {
    // Panel created. The panel script itself handles connection setup.
  },
);
