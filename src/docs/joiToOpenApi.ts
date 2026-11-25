import Joi from "joi";

/**
 * Turns a Joi schema into an OpenAPI 3 schema, so the API docs are generated from the same
 * validators that check the requests (they can never drift apart). Covers what our validators use.
 */
type Described = {
  type: string;
  flags?: { presence?: string; default?: unknown; only?: boolean; description?: string };
  allow?: unknown[];
  rules?: { name: string; args?: Record<string, unknown> }[];
  keys?: Record<string, Described>;
  items?: Described[];
  [k: string]: unknown;
};

const convert = (d: Described): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  const rule = (name: string) => d.rules?.find((r) => r.name === name)?.args;

  switch (d.type) {
    case "string": {
      out.type = "string";
      if (d.flags?.only && d.allow) out.enum = d.allow.filter((v) => v !== "");
      const min = rule("min");
      const max = rule("max");
      const pattern = rule("pattern") as { regex?: string } | undefined;
      if (min) out.minLength = min.limit;
      if (max) out.maxLength = max.limit;
      if (rule("guid")) out.format = "uuid";
      if (pattern?.regex) out.pattern = String(pattern.regex).replace(/^\/|\/[a-z]*$/g, "");
      break;
    }
    case "number": {
      out.type = d.rules?.some((r) => r.name === "integer") ? "integer" : "number";
      const min = rule("min");
      const max = rule("max");
      if (min) out.minimum = min.limit;
      if (max) out.maximum = max.limit;
      break;
    }
    case "boolean":
      out.type = "boolean";
      break;
    case "array": {
      out.type = "array";
      if (d.items?.[0]) out.items = convert(d.items[0]);
      const min = rule("min");
      const max = rule("max");
      const length = rule("length");
      if (min) out.minItems = min.limit;
      if (max) out.maxItems = max.limit;
      if (length) out.minItems = out.maxItems = length.limit;
      if (d.rules?.some((r) => r.name === "unique")) out.uniqueItems = true;
      break;
    }
    case "object": {
      out.type = "object";
      const keys = d.keys ?? {};
      out.properties = Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, convert(v)]));
      const required = Object.entries(keys)
        .filter(([, v]) => v.flags?.presence === "required")
        .map(([k]) => k);
      if (required.length) out.required = required;
      break;
    }
    default:
      break;
  }
  if (d.flags?.default !== undefined && typeof d.flags.default !== "function") out.default = d.flags.default;
  if (d.flags?.description) out.description = d.flags.description;
  return out;
};

export const joiToOpenApi = (schema: Joi.Schema) => convert(schema.describe() as Described);

/** Query or path parameters from an object schema. */
export const joiToParameters = (schema: Joi.ObjectSchema, where: "query" | "path") => {
  const body = joiToOpenApi(schema) as { properties: Record<string, unknown>; required?: string[] };
  return Object.entries(body.properties).map(([name, s]) => ({
    name,
    in: where,
    required: where === "path" || (body.required ?? []).includes(name),
    schema: s
  }));
};
