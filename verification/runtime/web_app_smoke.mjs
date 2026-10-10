// Compatibility entry point for the current rendered Connect acceptance probe.
// Use a fresh, disposable fictional demo database; this probe creates messages.
import assert from 'node:assert/strict';
import {dirname, join} from 'node:path';
const output = process.env.SCHACH_SMOKE_RESULT;
assert(output, 'Set SCHACH_SMOKE_RESULT to a private evidence file');
process.env.SCHACH_SCREENSHOT_DESKTOP ||= join(dirname(output), 'schach-connect-desktop.png');
process.env.SCHACH_SCREENSHOT_MOBILE ||= join(dirname(output), 'schach-connect-phone.png');
await import('./connect_ux_smoke.mjs');
