// This test script calls benchGetDocInfoTool, which now uses a Python function (get_doctype_definition)
// for DocType definition fetches via bench execute. Usage remains the same.
console.log('TEST SCRIPT STARTED', process.argv);
import { benchGetDocInfoTool } from '../src/tools.js';
const args = process.argv.slice(2);
const SITE = args[0] || process.env.TEST_SITE_NAME || 'onefm.localhost';
const DOCTYPE = args[1] || 'User';
const DEF_FLAG = args.includes('--def') || args.includes('def');
const NAME = args[2] && args[2] !== '--def' ? args[2] : undefined;
const FIELD = args[3] && args[3] !== '--def' ? args[3] : undefined;
(async () => {
  try {
    if (DEF_FLAG) {
      console.log(`Fetching DocType definition for ${DOCTYPE} on site ${SITE}`);
      const result = await benchGetDocInfoTool.call({ site: SITE, doctype: DOCTYPE, doctypeDef: true });
      console.log('DocType definition:', result);
    } else if (NAME && FIELD) {
      console.log(`Fetching field '${FIELD}' from ${DOCTYPE} ${NAME} on site ${SITE}`);
      const result = await benchGetDocInfoTool.call({ site: SITE, doctype: DOCTYPE, name: NAME, field: FIELD });
      console.log('Field value:', result);
    } else {
      console.log('Usage: node testfiles/test-bench-get-doc-info.js [site] [doctype] [name] [field]');
      console.log('   or: node testfiles/test-bench-get-doc-info.js [site] [doctype] --def');
      process.exit(1);
    }
  } catch (err) {
    console.error('Error running benchGetDocInfoTool:', err);
    process.exit(1);
  }
})();