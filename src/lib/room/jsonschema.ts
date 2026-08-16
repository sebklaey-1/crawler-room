/**
 * Typed view over the JSON Schema subset this server publishes.
 * Used by the output validator and by schema assertions in tests, so neither
 * needs `any` to walk a schema that is stored as opaque JSON.
 */

export interface JsonSchemaNode {
  type?: string | string[];
  title?: string;
  description?: string;
  const?: unknown;
  enum?: unknown[];
  format?: string;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  additionalProperties?: boolean;
  oneOf?: JsonSchemaNode[];
  items?: JsonSchemaNode;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

/** Reads opaque JSON as a schema node. */
export function schemaOf(value: unknown): JsonSchemaNode {
  return (value ?? {}) as JsonSchemaNode;
}

/** The published `action` enum of an input schema. */
export function actionEnum(schema: unknown): string[] {
  const values = schemaOf(schema).properties?.["action"]?.enum ?? [];
  return values.filter((value): value is string => typeof value === "string");
}

/** The declared properties of a schema node. */
export function propertiesOf(schema: unknown): Record<string, JsonSchemaNode> {
  return schemaOf(schema).properties ?? {};
}

/** The `oneOf` branches of a schema node. */
export function branchesOf(schema: unknown): JsonSchemaNode[] {
  return schemaOf(schema).oneOf ?? [];
}

/** Reads an unknown value as a plain record. */
export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
