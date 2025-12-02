export interface FrappeAPIIndex {
  version: string; // e.g. "frappe-15-erpnext-15"
  modules: {
    [modulePath: string]: {
      functions: FunctionSignature[];
      classes: ClassSignature[];
      whitelisted: boolean;
    };
  };
  doctypes: {
    [doctypeName: string]: {
      app: "frappe" | "erpnext" | "hrms";
      schema: DoctypeSchema;
      controller: string; // Path to .py file
      hooks: string[]; // Which apps have hooks on this DocType
    };
  };
  hooks: {
    [hookName: string]: {
      signature: string;
      description: string;
      examples: string[];
    };
  };
}

export interface FunctionSignature {
  name: string;
  path: string; // e.g. "frappe.model.document.get_doc"
  signature: string; // e.g. "def get_doc(doctype: str, name: str) -> Document"
  docstring: string;
  whitelisted: boolean;
  parameters: Parameter[];
  returnType: string;
}

export interface ClassSignature {
  name: string;
  path: string;
  docstring: string;
  methods: FunctionSignature[];
}

export interface DoctypeSchema {
  fields: Field[];
  permissions: Permission[];
  isTable: boolean;
  isTree: boolean;
  // --- ADDITION 1: HELPS FILTERING ---
  accessLevel: 'core' | 'application'; 
}

export interface Field {
  fieldname: string;
  fieldtype: string;
  label: string;
  options?: string;
  default?: any;
  required?: boolean;
}

export interface Permission {
  role: string;
  permlevel: number;
  read: boolean;
  write: boolean;
  create: boolean;
  delete: boolean;
  submit: boolean;
  cancel: boolean;
  amend: boolean;
  // --- ADDITION 2: HELPS SAFETY CHECKS ---
  dbWriteAccess: boolean; 
}

export interface Parameter {
  name: string;
  type: string;
  default?: any;
}