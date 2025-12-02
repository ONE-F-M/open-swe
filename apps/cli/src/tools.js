// apps/cli/src/tools.ts
// Standalone tool exports for use in other packages (no React/JSX)
import { tool } from "@langchain/core/tools";
import execa from "execa";
import { z } from "zod";
const BENCH_CONTAINER = process.env.BENCH_CONTAINER ;
const BENCH_PATH_CONTAINER = '/home/frappe/frappe-bench';
export const benchMigrateTool = tool(async ({ site }) => {
    let output = '';
    let error = undefined;
    let exitCode = 0;
    let migrationsRun = null;
    let stderr = '';
    try {
        const dockerCmd = `docker exec -u frappe -w ${BENCH_PATH_CONTAINER} ${BENCH_CONTAINER} bench --site ${site} migrate`;
        console.log(`[benchMigrateTool] Running:`, dockerCmd);
        const result = await execa('sh', ['-c', dockerCmd], { shell: true });
        output = result.stdout;
        stderr = result.stderr;
        exitCode = result.exitCode ?? 0;
        const match = output.match(/Migrating[^\n]*\n([\s\S]*?)\n/);
        if (match) {
            migrationsRun = match[1].split("\n").filter(Boolean).length;
        }
    }
    catch (err) {
        exitCode = err.exitCode ?? 1;
        output = err.stdout || '';
        stderr = err.stderr || '';
        error = err.message;
        const match = output.match(/Migrating[^\n]*\n([\s\S]*?)\n/);
        if (match) {
            migrationsRun = match[1].split("\n").filter(Boolean).length;
        }
    }
    return {
        exitCode,
        success: exitCode === 0,
        output,
        stderr,
        migrationsRun,
        error,
    };
}, {
    name: "bench_migrate",
    description: "Run 'bench --site [site] migrate' to apply patches and migrations for a Frappe site.",
    schema: z.object({
        site: z.string().describe("The Frappe site name (required)"),
    }),
});
export const benchRunTestTool = tool(async ({ site, app, module }) => {
    let cmd = `bench --site ${site} run-tests --app ${app}`;
    if (module) {
        cmd += ` --module ${module}`;
    }
    let exitCode = 0;
    let output = '';
    let testCount = null;
    let error = undefined;
    let stderr = '';
    try {
        console.log(`[benchRunTestTool] Running:`, cmd, `in container: ${BENCH_CONTAINER}`);
        const result = await execa('docker', [
            'exec',
            '-u', 'frappe',
            '-w', BENCH_PATH_CONTAINER,
            BENCH_CONTAINER,
            ...cmd.split(' ')
        ]);
        output = result.stdout;
        stderr = result.stderr;
        exitCode = result.exitCode ?? 0;
        const match = output.match(/(\d+)\s+tests?\s+in/);
        if (match) {
            testCount = parseInt(match[1], 10);
        }
    }
    catch (err) {
        exitCode = err.exitCode ?? 1;
        output = err.stdout || '';
        stderr = err.stderr || '';
        const match = output.match(/(\d+)\s+tests?\s+in/);
        if (match) {
            testCount = parseInt(match[1], 10);
        }
        error = err.message;
    }
    return {
        exitCode,
        passed: exitCode === 0,
        output,
        stderr,
        testCount,
        error,
    };
}, {
    name: "bench_run_test",
    description: "Run 'bench --site [site] run-tests --app [app] [--module module]' to execute Frappe/ERPNext tests.",
    schema: z.object({
        site: z.string().describe("The Frappe site name (required)"),
        app: z.string().describe("The Frappe app name (required)"),
        module: z.string().optional().describe("Optional Python module to test"),
    }),
});
export const benchClearCacheTool = tool(async ({ site }) => {
    let output = '';
    let error = undefined;
    let exitCode = 0;
    let stderr = '';
    try {
        const dockerCmd = `docker exec -u frappe -w ${BENCH_PATH_CONTAINER} ${BENCH_CONTAINER} bench --site ${site} clear-cache`;
        console.log(`[benchClearCacheTool] Running:`, dockerCmd);
        const result = await execa('sh', ['-c', dockerCmd], { shell: true });
        output = result.stdout;
        stderr = result.stderr;
        exitCode = result.exitCode ?? 0;
    }
    catch (err) {
        exitCode = err.exitCode ?? 1;
        output = err.stdout || '';
        stderr = err.stderr || '';
        error = err.message;
    }
    return {
        exitCode,
        success: exitCode === 0,
        output,
        stderr,
        error,
    };
}, {
    name: "bench_clear_cache",
    description: "Run 'bench --site [site] clear-cache' to clear Frappe site cache.",
    schema: z.object({
        site: z.string().describe("The Frappe site name (required)"),
    }),
});
export const benchConsoleTool = tool(async (args) => {
    let cmd = '';
    if (args.funcPath) {
        // New: use bench execute
        cmd = `bench --site ${args.site} execute ${args.funcPath} --args '${args.funcArgs || '[]'}'`;
    } else if (args.code) {
        // Legacy: use bench console --eval (deprecated in Frappe v15+)
        cmd = `bench --site ${args.site} console --eval '${args.code.replace(/'/g, "\\'")}'`;
    } else {
        throw new Error('Either code or funcPath must be provided');
    }
    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    let error = undefined;
    try {
        console.log(`[benchConsoleTool] Running:`, cmd, `in container: ${BENCH_CONTAINER}`);
        const result = await execa('sh', ['-c', cmd], { cwd: BENCH_PATH_CONTAINER, shell: true });
        stdout = result.stdout;
        stderr = result.stderr;
        exitCode = result.exitCode ?? 0;
    }
    catch (err) {
        exitCode = err.exitCode ?? 1;
        stdout = err.stdout || '';
        stderr = err.stderr || '';
        error = err.message;
    }
    return {
        exitCode,
        stdout,
        stderr,
        error,
        success: exitCode === 0,
    };
}, {
    name: "bench_console",
    description: "Execute Python code or a Frappe function in context using 'bench --site [site] console --eval' or 'bench execute'.",
    schema: z.object({
        site: z.string().describe("The Frappe site name (required)"),
        code: z.string().optional().describe("Python code to execute (legacy, optional)"),
        funcPath: z.string().optional().describe("Dotted path to Frappe function (for bench execute)"),
        funcArgs: z.string().optional().describe("Arguments for the Frappe function as a JSON string (for bench execute)"),
    }),
});
export const benchGetDocInfoTool = tool(async ({ site, doctype, name, field, doctypeDef }) => {
    let cmd = '';
    let data = undefined;
    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    let error = undefined;
    if (doctypeDef) {
        // Fetch DocType definition as JSON using Frappe's built-in get_meta
        // Uses: frappe.model.meta.get_meta
        cmd = `docker exec -u frappe -w ${BENCH_PATH_CONTAINER} ${BENCH_CONTAINER} bench --site ${site} execute frappe.model.meta.get_meta --kwargs '{"doctype": "${doctype}"}'`;
        console.log('[benchGetDocInfoTool] Running:', cmd);
        try {
            const result = await execa('sh', ['-c', cmd], { cwd: BENCH_PATH_CONTAINER, shell: true });
            stdout = result.stdout;
            stderr = result.stderr;
            exitCode = result.exitCode ?? 0;
            try {
                data = JSON.parse(stdout.trim());
            }
            catch (jsonErr) {
                error = 'Failed to parse DocType JSON output';
            }
        }
        catch (err) {
            exitCode = err.exitCode ?? 1;
            stdout = err.stdout || '';
            stderr = err.stderr || '';
            error = err.message;
        }
    }
    else if (field && name) {
        // Fetch a single field value
        cmd = `docker exec -u frappe -w ${BENCH_PATH_CONTAINER} ${BENCH_CONTAINER} bench --site ${site} execute frappe.db.get_value --args "['${doctype}', '${name}', '${field}']"`;
        console.log('Running:', cmd);
        try {
            const result = await execa('sh', ['-c', cmd], { cwd: BENCH_PATH_CONTAINER, shell: true });
            stdout = result.stdout;
            stderr = result.stderr;
            exitCode = result.exitCode ?? 0;
            data = { [field]: stdout.trim() };
        }
        catch (err) {
            exitCode = err.exitCode ?? 1;
            stdout = err.stdout || '';
            stderr = err.stderr || '';
            error = err.message;
        }
    }
    else {
        error = 'You must provide either doctypeDef=true or both name and field.';
    }
    return {
        exitCode,
        stdout,
        stderr,
        error,
        data,
        success: exitCode === 0 && !!data,
    };
}, {
    name: "bench_get_doc_info",
    description: "Fetch a single field value from a DocType document using frappe.db.get_value, or fetch the DocType definition as JSON if doctypeDef is true.",
    schema: z.object({
        site: z.string().describe("The Frappe site name (required)"),
        doctype: z.string().describe("The DocType to fetch (required)"),
        name: z.string().optional().describe("The document name (required for field fetch)"),
        field: z.string().optional().describe("Field to fetch (required for field fetch)"),
        doctypeDef: z.boolean().optional().describe("Set true to fetch DocType definition as JSON"),
    }),
});
export const benchListAppsTool = tool(async ({ site }) => {
    const cmd = `bench --site ${site} list-apps`;
    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    let error = undefined;
    let apps = [];
    try {
        const dockerCmd = `docker exec -u frappe -w ${BENCH_PATH_CONTAINER} ${BENCH_CONTAINER} ${cmd}`;
        console.log('[benchListAppsTool] Running:', dockerCmd);
        const result = await execa('sh', ['-c', dockerCmd], { shell: true });
        stdout = result.stdout;
        stderr = result.stderr;
        exitCode = result.exitCode ?? 0;
        // Each app is on a new line
        apps = stdout.split('\n').map(line => line.trim()).filter(Boolean);
    }
    catch (err) {
        exitCode = err.exitCode ?? 1;
        stdout = err.stdout || '';
        stderr = err.stderr || '';
        error = err.message;
    }
    return {
        exitCode,
        stdout,
        stderr,
        error,
        apps,
        success: exitCode === 0 && apps.length > 0,
    };
}, {
    name: "bench_list_apps",
    description: "List installed apps for a Frappe site using 'bench --site [site] list-apps'. Returns a structured list of app names.",
    schema: z.object({
        site: z.string().describe("The Frappe site name (required)"),
    }),
});
