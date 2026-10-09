import type { AskOption, AskQuestion } from "../core/ask-user.js";

/**
 * MCP elicitation forms in the terminal: the server's `requestedSchema` (a flat
 * object of string / number / integer / boolean / enum fields, per the MCP
 * spec) becomes `ask_user` questions, so the same keyboard picker renders both.
 */

const SKIP = "\u0000skip";

interface FieldSchema {
  type?: string;
  title?: string;
  description?: string;
  enum?: unknown[];
  enumNames?: unknown[];
  oneOf?: Array<{ const?: unknown; title?: unknown }>;
  items?: { enum?: unknown[]; anyOf?: Array<{ const?: unknown; title?: unknown }> };
  default?: unknown;
  minimum?: number;
  maximum?: number;
}

function fields(schema: Record<string, unknown>): Array<[string, FieldSchema]> {
  const properties = schema.properties;
  if (!properties || typeof properties !== "object") return [];
  return Object.entries(properties as Record<string, FieldSchema>);
}

function required(schema: Record<string, unknown>): Set<string> {
  return new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
}

function choices(field: FieldSchema): AskOption[] | null {
  if (Array.isArray(field.enum)) {
    return field.enum.map((value, i) => ({
      label: String(field.enumNames?.[i] ?? value),
      value: String(value),
    }));
  }
  if (Array.isArray(field.oneOf) && field.oneOf.every((o) => o && "const" in o)) {
    return field.oneOf.map((o) => ({ label: String(o.title ?? o.const), value: String(o.const) }));
  }
  const items = field.items;
  if (Array.isArray(items?.enum))
    return items.enum.map((v) => ({ label: String(v), value: String(v) }));
  if (Array.isArray(items?.anyOf)) {
    return items.anyOf.map((o) => ({ label: String(o.title ?? o.const), value: String(o.const) }));
  }
  return null;
}

/** The form as picker questions, one per field, in schema order. */
export function elicitationToQuestions(schema: Record<string, unknown>): AskQuestion[] {
  const needed = required(schema);
  return fields(schema).map(([key, field]) => {
    const optional = !needed.has(key);
    const label = field.title ?? key;
    const range =
      field.minimum !== undefined || field.maximum !== undefined
        ? ` (${field.minimum ?? "…"}–${field.maximum ?? "…"})`
        : "";
    const base = {
      id: key,
      question: `${label}${optional ? " (optional)" : ""}${range}`,
      ...(field.description ? { detail: field.description } : {}),
    };
    const skip: AskOption[] = optional ? [{ label: "Leave empty", value: SKIP }] : [];
    if (field.type === "boolean") {
      return {
        ...base,
        kind: "choice",
        allowOther: false,
        options: [{ label: "Yes", value: "true" }, { label: "No", value: "false" }, ...skip],
      };
    }
    const options = choices(field);
    if (options) {
      return {
        ...base,
        kind: field.type === "array" ? "multi" : "choice",
        allowOther: false,
        options: [...options, ...(field.type === "array" ? [] : skip)],
      };
    }
    // Free text / numbers: an optional field offers "Leave empty" plus typing.
    return optional
      ? { ...base, kind: "choice", allowOther: true, options: skip }
      : { ...base, kind: "text" };
  });
}

/**
 * Picker answers back to the typed `content` the server asked for. Returns an
 * error naming the field when a number does not parse or is out of range.
 */
export function answersToElicitContent(
  schema: Record<string, unknown>,
  answers: Record<string, string | string[]>,
): { content: Record<string, string | number | boolean | string[]> } | { error: string } {
  const content: Record<string, string | number | boolean | string[]> = {};
  for (const [key, field] of fields(schema)) {
    const answer = answers[key];
    if (answer === undefined || answer === SKIP) continue;
    if (Array.isArray(answer)) {
      content[key] = answer.filter((value) => value !== SKIP);
      continue;
    }
    if (field.type === "boolean") content[key] = answer === "true";
    else if (field.type === "number" || field.type === "integer") {
      const n = Number(answer.trim());
      const label = field.title ?? key;
      if (!Number.isFinite(n) || (field.type === "integer" && !Number.isInteger(n))) {
        return {
          error: `${label} must be ${field.type === "integer" ? "a whole number" : "a number"}.`,
        };
      }
      if (field.minimum !== undefined && n < field.minimum) {
        return { error: `${label} must be at least ${field.minimum}.` };
      }
      if (field.maximum !== undefined && n > field.maximum) {
        return { error: `${label} must be at most ${field.maximum}.` };
      }
      content[key] = n;
    } else content[key] = answer;
  }
  return { content };
}
