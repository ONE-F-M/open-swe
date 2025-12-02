import { z } from "zod";
export declare const benchMigrateTool: import("@langchain/core/tools").DynamicStructuredTool<z.ZodObject<{
    site: z.ZodString;
}, "strip", z.ZodTypeAny, {
    site: string;
}, {
    site: string;
}>, {
    site: string;
}, {
    site: string;
}, {
    exitCode: number;
    success: boolean;
    output: string;
    stderr: string;
    migrationsRun: number | null;
    error: any;
}>;
export declare const benchRunTestTool: import("@langchain/core/tools").DynamicStructuredTool<z.ZodObject<{
    app: z.ZodString;
    module: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    app: string;
    module?: string | undefined;
}, {
    app: string;
    module?: string | undefined;
}>, {
    app: string;
    module?: string;
}, {
    app: string;
    module?: string | undefined;
}, {
    exitCode: number;
    passed: boolean;
    output: string;
    stderr: string;
    testCount: number | null;
    error: any;
}>;
export declare const benchClearCacheTool: import("@langchain/core/tools").DynamicStructuredTool<z.ZodObject<{
    site: z.ZodString;
}, "strip", z.ZodTypeAny, {
    site: string;
}, {
    site: string;
}>, {
    site: string;
}, {
    site: string;
}, {
    exitCode: number;
    success: boolean;
    output: string;
    stderr: string;
    error: any;
}>;
export declare const benchConsoleTool: import("@langchain/core/tools").DynamicStructuredTool<z.ZodObject<{
    site: z.ZodString;
    code: z.ZodString;
}, "strip", z.ZodTypeAny, {
    code: string;
    site: string;
}, {
    code: string;
    site: string;
}>, {
    site: string;
    code: string;
}, {
    code: string;
    site: string;
}, {
    exitCode: number;
    stdout: string;
    stderr: string;
    error: any;
    success: boolean;
}>;
export declare const benchGetDocInfoTool: import("@langchain/core/tools").DynamicStructuredTool<z.ZodObject<{
    site: z.ZodString;
    doctype: z.ZodString;
    name: z.ZodOptional<z.ZodString>;
    field: z.ZodOptional<z.ZodString>;
    doctypeDef: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    doctype: string;
    site: string;
    name?: string | undefined;
    field?: string | undefined;
    doctypeDef?: boolean | undefined;
}, {
    doctype: string;
    site: string;
    name?: string | undefined;
    field?: string | undefined;
    doctypeDef?: boolean | undefined;
}>, {
    site: string;
    doctype: string;
    name?: string;
    field?: string;
    doctypeDef?: boolean;
}, {
    doctype: string;
    site: string;
    name?: string | undefined;
    field?: string | undefined;
    doctypeDef?: boolean | undefined;
}, {
    exitCode: number;
    stdout: string;
    stderr: string;
    error: any;
    data: any;
    success: boolean;
}>;
export declare const benchListAppsTool: import("@langchain/core/tools").DynamicStructuredTool<z.ZodObject<{
    site: z.ZodString;
}, "strip", z.ZodTypeAny, {
    site: string;
}, {
    site: string;
}>, {
    site: string;
}, {
    site: string;
}, {
    exitCode: number;
    stdout: string;
    stderr: string;
    error: any;
    apps: string[];
    success: boolean;
}>;
