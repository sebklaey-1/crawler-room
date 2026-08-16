/**
 * Minimal Zod → JSON Schema converter for the public MCP tool surface.
 *
 * The MCP `inputSchema` must describe exactly what the server validates.
 * Deriving it from the same Zod object makes divergence impossible: enums,
 * length limits, numeric bounds, nullability and `required` always match.
 */
import type { z } from "zod";

type Json = Record<string, unknown>;

interface StringCheck {
  kind: string;
  value?: number;
  regex?: RegExp;
}

function unwrap(schema: any): { inner: any; optional: boolean; nullable: boolean } {
  let inner = schema;
  let optional = false;
  let nullable = false;
  for (;;) {
    const typeName = inner?._def?.typeName;
    if (typeName === "ZodOptional") {
      optional = true;
      inner = inner._def.innerType;
    } else if (typeName === "ZodNullable") {
      nullable = true;
      inner = inner._def.innerType;
    } else if (typeName === "ZodDefault") {
      optional = true;
      inner = inner._def.innerType;
    } else if (typeName === "ZodEffects") {
      inner = inner._def.schema;
    } else {
      return { inner, optional, nullable };
    }
  }
}

function leafSchema(node: any): Json {
  const typeName = node?._def?.typeName;

  if (typeName === "ZodEnum") return { type: "string", enum: [...node._def.values] };
  if (typeName === "ZodLiteral") {
    const value = node._def.value;
    return { type: typeof value === "number" ? "integer" : "string", const: value };
  }
  if (typeName === "ZodBoolean") return { type: "boolean" };

  if (typeName === "ZodString") {
    const out: Json = { type: "string" };
    for (const check of (node._def.checks ?? []) as StringCheck[]) {
      if (check.kind === "max") out["maxLength"] = check.value;
      if (check.kind === "min") out["minLength"] = check.value;
      if (check.kind === "regex" && check.regex) out["pattern"] = check.regex.source;
    }
    return out;
  }

  if (typeName === "ZodNumber") {
    const checks = (node._def.checks ?? []) as StringCheck[];
    const out: Json = { type: checks.some((c) => c.kind === "int") ? "integer" : "number" };
    for (const check of checks) {
      if (check.kind === "max") out["maximum"] = check.value;
      if (check.kind === "min") out["minimum"] = check.value;
    }
    return out;
  }

  if (typeName === "ZodUnion") {
    const options = (node._def.options ?? []).map((option: any) => leafSchema(option));
    const literals = options.filter((option: Json) => "const" in option);
    if (literals.length === options.length && options.length > 0) {
      return {
        type: typeof (node._def.options[0]?._def?.value ?? "") === "number" ? "integer" : "string",
        enum: literals.map((option: Json) => option["const"]),
      };
    }
    return { anyOf: options };
  }

  return {};
}

/** Builds a strict JSON Schema object from a Zod object schema. */
export function inputSchemaFor(
  schema: z.ZodTypeAny,
  descriptions: Record<string, string> = {},
): Json {
  const shape = (schema as any)._def.shape();
  const properties: Json = {};
  const required: string[] = [];

  for (const [key, field] of Object.entries(shape)) {
    const { inner, optional, nullable } = unwrap(field);
    const leaf = leafSchema(inner);
    if (nullable && typeof leaf["type"] === "string") leaf["type"] = [leaf["type"], "null"];
    if (descriptions[key]) leaf["description"] = descriptions[key];
    properties[key] = leaf;
    if (!optional) required.push(key);
  }

  return { type: "object", properties, required, additionalProperties: false };
}
