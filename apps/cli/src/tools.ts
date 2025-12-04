// apps/cli/src/tools.ts
// Standalone tool exports for use in other packages (no React/JSX)
import { tool } from "@langchain/core/tools";
import { executeInSandbox } from "./execute-in-sandbox.js";
import { z } from "zod";

export const benchMigrateTool = tool(
	async ({ site, sandbox }: { site: string, sandbox: any }) => {
		const command = `bench --site ${site} migrate --skip-failing`;
		console.log(`[benchMigrateTool] About to execute:`, command, 'with sandbox:', sandbox);
		const result = await executeInSandbox(sandbox, command);
		console.log(`[benchMigrateTool] Execution result:`, result);
		let migrationsRun = null;
		const match = result.stdout.match(/Migrating[^\n]*\n([\s\S]*?)\n/);
		if (match) {
			migrationsRun = match[1].split("\n").filter(Boolean).length;
		}
		if (result.exitCode !== 0) {
			console.error(`[benchMigrateTool] Migration failed for site ${site}:`, result.stderr);
			throw new Error(`Migration failed for site ${site}: ${result.stderr}`);
		}
		return {
			exitCode: result.exitCode,
			success: true,
			output: result.stdout,
			stderr: result.stderr,
			migrationsRun,
		};
	},
	{
		name: "bench_migrate",
		description: "Run 'bench --site [site] migrate' to apply patches and migrations for a Frappe site.",
		schema: z.object({
			site: z.string().describe("The Frappe site name (required)"),
			sandbox: z.any().describe("The active Daytona Sandbox instance (required at runtime)")
		}),
	}
);

export const benchRunTestTool = tool(
	async ({ site, app, module, sandbox }: { site: string; app: string; module?: string; sandbox: any }) => {
		let cmd = `bench --site ${site} run-tests --app ${app}`;
		if (module) {
			cmd += ` --module ${module}`;
		}
		const result = await executeInSandbox(sandbox, cmd);
		let testCount = null;
		const match = result.stdout.match(/(\d+)\s+tests?\s+in/);
		if (match) {
			testCount = parseInt(match[1], 10);
		}
		if (result.exitCode !== 0) {
			throw new Error(`Tests failed for app ${app}: ${result.stderr}`);
		}
		return {
			exitCode: result.exitCode,
			passed: true,
			output: result.stdout,
			stderr: result.stderr,
			testCount,
		};
	},
	   {
		   name: "bench_run_test",
		   description: "Run 'bench --site [site] run-tests --app [app] [--module module]' to execute Frappe/ERPNext tests.",
		   schema: z.object({
			   site: z.string().describe("The Frappe site name (required)"),
			   app: z.string().describe("The Frappe app name (required)"),
			   module: z.string().optional().describe("Optional Python module to test"),
			   sandbox: z.any().describe("The active Daytona Sandbox instance (required at runtime)")
		   }),
	   }
);

export const benchClearCacheTool = tool(
	async ({ site, sandbox }: { site: string, sandbox: any }) => {
		const command = `bench --site ${site} clear-cache`;
		const result = await executeInSandbox(sandbox, command);
		if (result.exitCode !== 0) {
			throw new Error(`Cache clear failed for site ${site}: ${result.stderr}`);
		}
		return { success: true };
	},
	{
		name: "bench_clear_cache",
		description: "Clear Frappe cache. Use before running tests to ensure clean state.",
		schema: z.object({
			site: z.string().optional().describe("Site name (default: onefm)"),
			sandbox: z.any().describe("The active Daytona Sandbox instance (required at runtime)")
		})
	}
);

export const benchConsoleTool = tool(
	async ({ site, code, sandbox }: { site: string; code: string; sandbox: any }) => {
		const safeCode = code.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
		const cmd = `bench --site ${site} console --eval '${safeCode}'`;
		const result = await executeInSandbox(sandbox, cmd);
		if (result.exitCode !== 0) {
			throw new Error(`Console command failed for site ${site}: ${result.stderr}`);
		}
		return {
			exitCode: result.exitCode,
			stdout: result.stdout,
			stderr: result.stderr,
			success: true,
		};
	},
	{
		name: "bench_console",
		description: "Execute arbitrary Python code in Frappe context using 'bench --site [site] console --eval'.",
		schema: z.object({
			site: z.string().describe("The Frappe site name (required)"),
			code: z.string().describe("Python code to execute (required)"),
			sandbox: z.any().describe("The active Daytona Sandbox instance (required at runtime)")
		}),
	}
);

export const benchGetDocInfoTool = tool(
	async ({ site, doctype, name, field, doctypeDef, sandbox }: { site: string; doctype: string; name?: string; field?: string; doctypeDef?: boolean; sandbox: any }) => {
		let cmd = '';
		let data = undefined;
		if (doctypeDef) {
			cmd = `bench --site ${site} execute frappe.model.meta.get_meta --kwargs '{"doctype": "${doctype}"}'`;
			const result = await executeInSandbox(sandbox, cmd);
			if (result.exitCode !== 0) {
				throw new Error(`Failed to fetch DocType definition for ${doctype}: ${result.stderr}`);
			}
			try {
				data = JSON.parse(result.stdout.trim());
			} catch (jsonErr) {
				throw new Error('Failed to parse DocType JSON output');
			}
			return {
				exitCode: result.exitCode,
				stdout: result.stdout,
				stderr: result.stderr,
				data,
				success: true,
			};
		} else if (field && name) {
			cmd = `bench --site ${site} execute frappe.db.get_value --args "['${doctype}', '${name}', '${field}']"`;
			const result = await executeInSandbox(sandbox, cmd);
			if (result.exitCode !== 0) {
				throw new Error(`Failed to fetch field ${field} for ${doctype} ${name}: ${result.stderr}`);
			}
			data = { [field]: result.stdout.trim() };
			return {
				exitCode: result.exitCode,
				stdout: result.stdout,
				stderr: result.stderr,
				data,
				success: true,
			};
		} else {
			throw new Error('You must provide either doctypeDef=true or both name and field.');
		}
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
			sandbox: z.any().describe("The active Daytona Sandbox instance (required at runtime)")
		}),
	}
);

export const benchListAppsTool = tool(
	async ({ site, sandbox }: { site: string; sandbox: any }) => {
		const cmd = `bench --site ${site} list-apps`;
		const result = await executeInSandbox(sandbox, cmd);
		if (result.exitCode !== 0) {
			throw new Error(`Failed to list apps for site ${site}: ${result.stderr}`);
		}
		const apps = result.stdout.split('\n').map((line: string) => line.trim()).filter(Boolean);
		return {
			exitCode: result.exitCode,
			stdout: result.stdout,
			stderr: result.stderr,
			apps,
			success: apps.length > 0,
		};
	},
	{
		name: "bench_list_apps",
		description: "List installed apps for a Frappe site using 'bench --site [site] list-apps'. Returns a structured list of app names.",
		schema: z.object({
			site: z.string().describe("The Frappe site name (required)"),
			sandbox: z.any().describe("The active Daytona Sandbox instance (required at runtime)")
		}),
	}
);

export const benchBackupTool = tool(
	async ({ site, sandbox }: { site: string, sandbox: any }) => {
		const command = `bench --site ${site} backup`;
		const result = await executeInSandbox(sandbox, command);
		if (result.exitCode !== 0) {
			throw new Error(`Backup failed for site ${site}: ${result.stderr}`);
		}
		return {
			exitCode: result.exitCode,
			success: true,
			output: result.stdout,
			stderr: result.stderr,
		};
	},
	{
		name: "bench_backup",
		description: "Run 'bench --site [site] backup' to create a database backup for a Frappe site.",
		schema: z.object({
			site: z.string().describe("The Frappe site name (required)"),
			sandbox: z.any().describe("The active Daytona Sandbox instance (required at runtime)")
		}),
	}
);

export const benchRestartTool = tool(
	async ({ site, sandbox }: { site: string, sandbox: any }) => {
		const command = `bench --site ${site} restart`;
		const result = await executeInSandbox(sandbox, command);
		if (result.exitCode !== 0) {
			throw new Error(`Restart failed for site ${site}: ${result.stderr}`);
		}
		return {
			exitCode: result.exitCode,
			success: true,
			output: result.stdout,
			stderr: result.stderr,
		};
	},
	{
		name: "bench_restart",
		description: "Run 'bench --site [site] restart' to restart all processes for a Frappe site.",
		schema: z.object({
			site: z.string().describe("The Frappe site name (required)"),
			sandbox: z.any().describe("The active Daytona Sandbox instance (required at runtime)")
		}),
	}
);