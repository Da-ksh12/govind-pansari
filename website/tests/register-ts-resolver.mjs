// Lets `node --test` import the app's TypeScript modules as written: Node 24
// strips the types itself, but its ESM resolver wants explicit extensions
// while the app's own imports are extensionless ('./dashboardMetrics').
// Loaded with `--import` from the "test:unit" script — no test framework or
// transpiler dependency is added.
import { register } from 'node:module';

register('./ts-resolver-hooks.mjs', import.meta.url);
