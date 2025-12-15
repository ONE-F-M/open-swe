// apps/cli/src/tools.ts
// Standalone tool exports for use in other packages (no React/JSX)
import { tool } from "@langchain/core/tools";
import { execaCommand } from "execa";
import { z } from "zod";

export const benchMigrateTool = tool( 
	async ({ site }: { site: string }) => {
		let output = '';
		let error = undefined;
		let exitCode = 0;
		let migrationsRun = null;
		let stderr = '';
		try {
			const result = await execaCommand( 
				`bench --site ${site} migrate`, 
				{ cwd: "/home/frappe/frappe-bench" }
			);
			output = result.stdout;
			stderr = result.stderr;
			exitCode = result.exitCode ?? 0;
			const match = output.match(/Migrating[^\n]*\n([\s\S]*?)\n/);
			if (match) {
				migrationsRun = match[1].split("\n").filter(Boolean).length;
			}
		} catch (err: any) {
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
	},
	{
		name: "bench_migrate",
		description: "Run 'bench --site [site] migrate' to apply patches and migrations for a Frappe site.",
		schema: z.object({
			site: z.string().describe("The Frappe site name (required)"),
		}),
	}
);

export const benchRunTestTool = tool( 
	async ({ app, module }: { app: string; module?: string }) => {
		let cmd = `bench run-tests --app ${app}`;
		if (module) {
			cmd += ` --module ${module}`;
		}
		let exitCode = 0;
		let output = '';
		let testCount = null;
		let error = undefined;
		let stderr = '';
		try {
			const result = await execaCommand(cmd, { cwd: "/home/frappe/frappe-bench" });
			output = result.stdout;
			stderr = result.stderr;
			exitCode = result.exitCode ?? 0;
			const match = output.match(/(\d+)\s+tests?\s+in/);
			if (match) {
				testCount = parseInt(match[1], 10);
			}
		} catch (err: any) {
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
	},
	{
		name: "bench_run_test",
		description: "Run 'bench run-tests --app [app] [--module module]' to execute Frappe/ERPNext tests.",
		schema: z.object({
			app: z.string().describe("The Frappe app name (required)"),
			module: z.string().optional().describe("Optional Python module to test"),
		}),
	}
);

export const benchClearCacheTool = tool( 
	async ({ site }: { site: string }) => {
		let output = '';
		let error = undefined;
		let exitCode = 0;
		let stderr = '';
		try {
			const result = await execaCommand( 
				`bench --site ${site} clear-cache`, 
				{ cwd: "/home/frappe/frappe-bench" }
			);
			output = result.stdout;
			stderr = result.stderr;
			exitCode = result.exitCode ?? 0;
		} catch (err: any) {
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
	},
	{
		name: "bench_clear_cache",
		description: "Run 'bench --site [site] clear-cache' to clear Frappe site cache.",
		schema: z.object({
			site: z.string().describe("The Frappe site name (required)"),
		}),
	}
);

export const benchConsoleTool = tool( 
	async ({ site, code }: { site: string; code: string }) => {
		const cmd = `bench --site ${site} console --eval '${code.replace(/'/g, "\\'")}'`;
		let stdout = '';
		let stderr = '';
		let exitCode = 0;
		let error = undefined;
		try {
			const result = await execaCommand(cmd, { cwd: "/home/frappe/frappe-bench" });
			stdout = result.stdout;
			stderr = result.stderr;
			exitCode = result.exitCode ?? 0;
		} catch (err: any) {
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
	},
	{
		name: "bench_console",
		description: "Execute arbitrary Python code in Frappe context using 'bench --site [site] console --eval'.",
		schema: z.object({
			site: z.string().describe("The Frappe site name (required)"),
			code: z.string().describe("Python code to execute (required)"),
		}),
	}
);

export const benchGetDocInfoTool = tool( 
	async ({ site, doctype, name, field, doctypeDef }: { site: string; doctype: string; name?: string; field?: string; doctypeDef?: boolean }) => {
		let cmd = '';
		let data = undefined;
		let stdout = '';
		let stderr = '';
		let exitCode = 0;
		let error = undefined;
		if (doctypeDef) {
			// Fetch DocType definition as JSON using Frappe's built-in get_meta
			// Uses: frappe.model.meta.get_meta
			cmd = `bench --site ${site} execute frappe.model.meta.get_meta --kwargs '{"doctype": "${doctype}"}'`;
			console.log('Running:', cmd);
			try {
				const result = await execaCommand(cmd, { cwd: "/home/frappe/frappe-bench", shell: true });
				stdout = result.stdout;
				stderr = result.stderr;
				exitCode = result.exitCode ?? 0;
				try {
					data = JSON.parse(stdout.trim());
				} catch (jsonErr) {
					error = 'Failed to parse DocType JSON output';
				}
			} catch (err: any) {
				exitCode = err.exitCode ?? 1;
				stdout = err.stdout || '';
				stderr = err.stderr || '';
				error = err.message;
			}
		} else if (field && name) {
			// Fetch a single field value
			cmd = `bench --site ${site} execute frappe.db.get_value --args "['${doctype}', '${name}', '${field}']"`;
			console.log('Running:', cmd);
			try {
				const result = await execaCommand(cmd, { cwd: "/home/frappe/frappe-bench", shell: true });
				stdout = result.stdout;
				stderr = result.stderr;
				exitCode = result.exitCode ?? 0;
				data = { [field]: stdout.trim() };
			} catch (err: any) {
				exitCode = err.exitCode ?? 1;
				stdout = err.stdout || '';
				stderr = err.stderr || '';
				error = err.message;
			}
		} else {
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
	},
	{
		name: "bench_get_doc_info",
		description: "Fetch a single field value from a DocType document using frappe.db.get_value, or fetch the DocType definition as JSON if doctypeDef is true.",
		schema: z.object({
			site: z.string().describe("The Frappe site name (required)"),
			doctype: z.string().describe("The DocType to fetch (required)"),
			name: z.string().optional().describe("The document name (required for field fetch)"),
			field: z.string().optional().describe("Field to fetch (required for field fetch)"),
			doctypeDef: z.boolean().optional().describe("Set true to fetch DocType definition as JSON"),
		}),
	}
);

export const benchListAppsTool = tool( 
	async ({ site }: { site: string }) => {
		const cmd = `bench --site ${site} list-apps`;
		let stdout = '';
		let stderr = '';
		let exitCode = 0;
		let error = undefined;
		let apps: string[] = [];
		try {
			const result = await execaCommand(cmd, { cwd: "/home/frappe/frappe-bench" });
			stdout = result.stdout;
			stderr = result.stderr;
			exitCode = result.exitCode ?? 0;
			// Each app is on a new line
			apps = stdout.split('\n').map(line => line.trim()).filter(Boolean);
		} catch (err: any) {
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
	},
	{
		name: "bench_list_apps",
		description: "List installed apps for a Frappe site using 'bench --site [site] list-apps'. Returns a structured list of app names.",
		schema: z.object({
			site: z.string().describe("The Frappe site name (required)"),
		}),
	}
);
