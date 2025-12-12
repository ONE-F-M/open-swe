// Root index for Frappe/ERPNext API metadata, used for code intelligence and automation
export interface FrappeAPIIndex {
  version: string; // API version, e.g. "frappe-15-erpnext-15"
  platformArchitecture: string; // NEW: Platform architecture (e.g., "x86_64", "arm64")
  appModuleMap: Record<string, string[]>; // NEW: Map of app names to their modules
  modules: {
    [modulePath: string]: {
      functions: FunctionSignature[]; // All functions in the module
      classes: ClassSignature[];     // All classes in the module
      whitelisted: boolean;          // If module is whitelisted for public API
    };
  };
  doctypes: {
    [doctypeName: string]: {
      app: "frappe" | "erpnext" | "hrms"; // Owning app
      schema: DoctypeSchema;                // DocType schema definition
      controller: string;                   // Path to controller .py file
      hooks: string[];                      // Apps with hooks on this DocType
    };
  };
  hooks: {
    [hookName: string]: {
      signature: string;     // Hook function signature
      description: string;   // Description of the hook
      examples: string[];    // Example usages
    };
  };
}

// Describes a function in the Frappe/ERPNext codebase
export interface FunctionSignature {
  name: string;
  path: string;         // Fully qualified path, e.g. "frappe.model.document.get_doc"
  signature: string;    // Python signature, e.g. "def get_doc(doctype: str, name: str) -> Document"
  docstring: string;    // Function docstring
  whitelisted: boolean; // If function is whitelisted for public API
  dbTransactionRequired: boolean; // NEW: True if function requires DB transaction
  raisesException: string[];      // NEW: List of exception names that can be raised
  isUnitTestHelper: boolean;      // NEW: True if function is a unit test helper
  parameters: Parameter[];
  returnType: string;
}

// Describes a class in the Frappe/ERPNext codebase
export interface ClassSignature {
  name: string;
  path: string;
  docstring: string;
  methods: FunctionSignature[]; // Methods defined on the class
}

// Schema definition for a Frappe DocType
export interface DoctypeSchema {
  fields: Field[];                // List of fields in the DocType
  permissions: Permission[];      // List of permissions for the DocType
  isTable: boolean;               // True if DocType is a child table
  isTree: boolean;                // True if DocType is a tree structure
  accessLevel: 'core' | 'application'; // Used for filtering (core vs app DocTypes)
  hasClientScript: boolean;      // NEW: True if DocType has a client script
  creationTimestamp: number;     // NEW: Unix timestamp of DocType creation
}

// Field definition for a DocType
export interface Field {
  fieldname: string;
  fieldtype: string;
  label: string;
  options?: string;
  default?: any;
  required?: boolean;
}

// Permission rule for a DocType
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
  dbWriteAccess: boolean; // Used for safety checks
}

// Function parameter definition
export interface Parameter {
  name: string;
  type: string;
  default?: any;
}