import { benchListAppsTool } from '../src/tools.js';

const site = process.argv[2] || 'onefm.localhost';

(async () => {
  try {
    const result = await benchListAppsTool.call({ site });
    console.log('Installed apps:', result);
  } catch (err) {
    console.error('Error running benchListAppsTool:', err);
    process.exit(1);
  }
})();
