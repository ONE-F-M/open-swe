
import { describe, it, expect } from '@jest/globals';
import { benchGetDocInfoTool } from '../tools.js';
import execa from 'execa';
import 'dotenv/config';


type BenchGetDocInfoArgs = {
  site?: string;
  doctype?: string;
  doctypeDef?: boolean;
  name?: string;
  field?: string;
  container?: string;
};

// Helper to run bench command in Docker with venv activation
async function runBenchGetDocInfoInDocker({ site, doctype, doctypeDef, name, field, container = process.env.DOCKER_CONTAINER || 'adoring_wiles' }: BenchGetDocInfoArgs) {
  let benchCommand;
  if (doctypeDef) {
    benchCommand = `source env/bin/activate && bench --site ${site} execute frappe.model.meta.get_meta --kwargs '{"doctype": "${doctype}"}'`;
  } else if (name && field) {
    benchCommand = `source env/bin/activate && bench --site ${site} execute frappe.db.get_value --args "['${doctype}', '${name}', '${field}']"`;
  } else {
    throw new Error('You must provide either doctypeDef=true or both name and field.');
  }
  const dockerCmd = [
    'exec',
    '-u', 'frappe',
    '-w', '/home/frappe/frappe-bench',
    container,
    'bash', '-c',
    benchCommand
  ];
  try {
    const { stdout, stderr, exitCode } = await execa('docker', dockerCmd);
    return { success: exitCode === 0, output: stdout, error: stderr, exitCode };
  } catch (err: any) {
    return {
      success: false,
      output: typeof err?.stdout === 'string' ? err.stdout : '',
      error: typeof err?.stderr === 'string' ? err.stderr : (typeof err?.message === 'string' ? err.message : String(err)),
      exitCode: typeof err?.exitCode === 'number' ? err.exitCode : -1
    };
  }
}

const SITE = process.env.TEST_SITE || 'onefm';
const DOCTYPE = 'User';
const NAME = process.env.TEST_DOC_NAME;
const FIELD = process.env.TEST_DOC_FIELD;
const isDocker = !!process.env.USE_DOCKER;

describe('benchGetDocInfoTool', () => {
  it('should fetch DocType definition (Docker or mock)', async () => {
    if (isDocker) {
      const result = await runBenchGetDocInfoInDocker({ site: SITE, doctype: DOCTYPE, doctypeDef: true, name: undefined, field: undefined });
      console.log('DocType definition result:', result);
      expect(result.success).toBe(true);
      expect(result.output).toMatch(/DocType|fields|name/);
    } else {
      const result = await benchGetDocInfoTool.call({ site: SITE, doctype: DOCTYPE, doctypeDef: true });
      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('data');
    }
  });

  it('should fetch a field value (Docker or mock)', async () => {
    if (!NAME || !FIELD) {
      // Skip if env vars not set
      return;
    }
    if (isDocker) {
      const result = await runBenchGetDocInfoInDocker({ site: SITE, doctype: DOCTYPE, doctypeDef: undefined, name: NAME, field: FIELD });
      expect(result.success).toBe(true);
      expect(result.output).toBeTruthy();
    } else {
      const result = await benchGetDocInfoTool.call({ site: SITE, doctype: DOCTYPE, name: NAME, field: FIELD });
      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('data');
    }
  });

  it('should fail gracefully with missing args', async () => {
    if (isDocker) {
      await expect(runBenchGetDocInfoInDocker({ site: SITE, doctype: DOCTYPE, doctypeDef: undefined, name: undefined, field: undefined })).rejects.toThrow();
    } else {
      await expect(benchGetDocInfoTool.call({ site: SITE, doctype: DOCTYPE })).resolves.toHaveProperty('success', false);
    }
  });
});