import { MigrationHandler } from '../src/migration/migration-handler.js';

async function main() {
  const handler = new MigrationHandler();
  // Simulate a changed DocType file (adjust the path as needed for your repo)
  const changedFiles = ['apps/erpnext/doctype/some_doctype/some_doctype.json'];
  const result = await handler.handlePostCodeChange(changedFiles);
  console.log('Migration result:', result);
}

main().catch((err) => {
  console.error('Error running migration handler test:', err);
  process.exit(1);
});
