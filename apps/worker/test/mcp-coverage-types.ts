export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
/** `METHOD path`, the path relative to /api/v1 exactly as in the route file. */
export type OperationKey = `${Method} /${string}`;
export type Coverage =
  /** note: what the tool leaves out, and why. Several tools may serve one operation. */
  | { tool: string | string[]; note?: string }
  /** the reason no tool exists */
  | { excluded: string };
