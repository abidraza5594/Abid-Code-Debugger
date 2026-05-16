/**
 * DevTools page — invoked once per devtools window. We register a single panel.
 */

chrome.devtools.panels.create(
  'Abid Debugger',
  'icons/icon-48.svg',
  'devtools/panel.html',
  () => {
    // Panel created. The panel script itself handles connection setup.
  },
);
