// test-bench-clear-cache.js
// Usage: node test-bench-clear-cache.js [site-name]
import { benchClearCacheTool } from '../src/tools.js';

const SITE_NAME = process.argv[2] || process.env.TEST_SITE_NAME || 'onefm.localhost';

(async () => {
  try {
    console.log(`Running benchClearCacheTool for site: ${SITE_NAME}`);
    const result = await benchClearCacheTool.call({ site: SITE_NAME });
    console.log('Result:', result);
    if (result.success) {
      console.log('Cache cleared successfully.');
    } else {
      console.error('Cache clear failed:', result.error || result.stderr);
      process.exit(result.exitCode || 1);
    }
  } catch (err) {
    console.error('Error running benchClearCacheTool:', err);
    process.exit(1);
  }
})();
