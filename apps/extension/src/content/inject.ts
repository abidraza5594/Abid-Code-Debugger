/**
 * MAIN-world bootstrap. This file is loaded by content-script.ts and re-exports the injected
 * runtime from src/injected/index.ts. Two files exist because Vite needs distinct rollup
 * entries for "loader" vs "implementation".
 */

import { bootInjectedRuntime } from '../injected/index.js';

bootInjectedRuntime();
