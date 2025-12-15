// test-bench-migrate.js
// Usage: node test-bench-migrate.js [site-name]

import { benchMigrateTool } from '../src/tools.js';

const SITE_NAME = process.argv[2] || process.env.TEST_SITE_NAME || 'onefm.localhost';

(async () => {
  try {
    console.log(`Running benchMigrateTool for site: ${SITE_NAME}`);
    const result = await benchMigrateTool.call({ site: SITE_NAME });
    console.log('Result:', result);
    if (result.success) {
      console.log('Migration completed successfully.');
    } else {
      console.error('Migration failed:', result.error || result.stderr);
      process.exit(result.exitCode || 1);
    }
  } catch (err) {
    console.error('Error running benchMigrateTool:', err);
    process.exit(1);
  }
})();