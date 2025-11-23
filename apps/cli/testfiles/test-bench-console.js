import { benchConsoleTool } from '../src/tools.js';

const site = process.argv[2] || 'onefm.localhost';
const code = process.argv[3] || "print('Hello from Frappe Console!')";

(async () => {
  try {
    const result = await benchConsoleTool.call({ site, code });
    console.log('Console output:', result);
  } catch (err) {
    console.error('Error running benchConsoleTool:', err);
    process.exit(1);
  }
})();
