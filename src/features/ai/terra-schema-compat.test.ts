import { describe, expect, it } from "vitest";
import {
  AI_TASK_TYPES,
  providerJsonSchema,
  validateProviderProposal,
  type AiTaskType,
} from "./contracts";
import { toOpenAiStrictSchema } from "./openai-terra-provider";

type ConstNode = {
  path: string;
  value: unknown;
  type: unknown;
};

function collectConstNodes(value: unknown, path = "$"): ConstNode[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectConstNodes(entry, `${path}[${index}]`));
  }
  if (!value || typeof value !== "object") return [];

  const row = value as Record<string, unknown>;
  const current = Object.prototype.hasOwnProperty.call(row, "const")
    ? [{ path, value: row.const, type: row.type }]
    : [];
  return [
    ...current,
    ...Object.entries(row).flatMap(([key, child]) => collectConstNodes(child, `${path}.${key}`)),
  ];
}

function assertStrictObjects(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) assertStrictObjects(entry);
    return;
  }
  if (!value || typeof value !== "object") return;

  const row = value as Record<string, unknown>;
  if (row.type === "object" && row.properties && typeof row.properties === "object") {
    const properties = row.properties as Record<string, unknown>;
    expect(row.additionalProperties).toBe(false);
    expect(row.required).toEqual(Object.keys(properties));
  }
  for (const child of Object.values(row)) assertStrictObjects(child);
}

function schemaProperties(taskType: AiTaskType): Record<string, Record<string, unknown>> {
  const schema = providerJsonSchema(taskType);
  return schema.properties as Record<string, Record<string, unknown>>;
}

describe("PA1 Terra strict-schema compatibility", () => {
  it("types kind and requires_review consts explicitly for every task", () => {
    const expectedReview = new Map<AiTaskType, boolean>([
      ["PRESCRIPTION_MEDICINE", true],
      ["INVESTIGATION_LIST", true],
      ["CLINICAL_NOTE", true],
      ["NAVIGATION_COMMAND", false],
    ]);

    for (const taskType of AI_TASK_TYPES) {
      const properties = schemaProperties(taskType);
      expect(properties.kind).toEqual({ type: "string", const: taskType });
      expect(properties.requires_review).toEqual({
        type: "boolean",
        const: expectedReview.get(taskType),
      });
    }
  });

  it("recursively rejects any provider const node without a matching explicit type", () => {
    const allNodes = AI_TASK_TYPES.flatMap((taskType) =>
      collectConstNodes(providerJsonSchema(taskType)).map((node) => ({ taskType, ...node })),
    );

    expect(allNodes).toHaveLength(8);
    for (const node of allNodes) {
      const expectedType = typeof node.value;
      expect(["string", "boolean"]).toContain(expectedType);
      expect(node.type, `${node.taskType} ${node.path}`).toBe(expectedType);
    }
  });

  it("keeps OpenAI strict transformation recursive while preserving nullable fields and typed consts", () => {
    for (const taskType of AI_TASK_TYPES) {
      const strict = toOpenAiStrictSchema(providerJsonSchema(taskType)) as Record<string, unknown>;
      assertStrictObjects(strict);
      const properties = strict.properties as Record<string, Record<string, unknown>>;
      expect(properties.kind).toEqual({ type: "string", const: taskType });
      expect(properties.requires_review?.type).toBe("boolean");
    }

    const prescription = toOpenAiStrictSchema(
      providerJsonSchema("PRESCRIPTION_MEDICINE"),
    ) as Record<string, unknown>;
    const prescriptionProperties = prescription.properties as Record<string, Record<string, unknown>>;
    const medicine = prescriptionProperties.medicine;
    const medicineProperties = medicine.properties as Record<string, unknown>;
    expect(medicineProperties.route).toEqual({
      anyOf: [{ type: "string", minLength: 1 }, { type: "null" }],
    });
    expect(medicine.required).toEqual(Object.keys(medicineProperties));
  });

  it("leaves DD independent proposal validation semantics intact", () => {
    expect(
      validateProviderProposal("PRESCRIPTION_MEDICINE", {
        kind: "PRESCRIPTION_MEDICINE",
        medicine: { display_name: "Synthetic Item" },
        uncertainties: [],
        requires_review: true,
      }),
    ).toMatchObject({ kind: "PRESCRIPTION_MEDICINE", requires_review: true });

    expect(() =>
      validateProviderProposal("PRESCRIPTION_MEDICINE", {
        kind: "PRESCRIPTION_MEDICINE",
        medicine: { display_name: "Synthetic Item" },
        uncertainties: [],
        requires_review: false,
      }),
    ).toThrow(/requires_review must be true/);

    expect(
      validateProviderProposal("NAVIGATION_COMMAND", {
        kind: "NAVIGATION_COMMAND",
        command: "OPEN_PATIENT_SEARCH",
        requires_review: false,
      }),
    ).toEqual({
      kind: "NAVIGATION_COMMAND",
      command: "OPEN_PATIENT_SEARCH",
      requires_review: false,
    });

    expect(() =>
      validateProviderProposal("NAVIGATION_COMMAND", {
        kind: "NAVIGATION_COMMAND",
        command: "OPEN_PATIENT_SEARCH",
        requires_review: true,
      }),
    ).toThrow(/requires_review must be false/);
  });
});
