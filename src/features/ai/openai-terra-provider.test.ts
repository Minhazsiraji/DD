import { describe, expect, it } from "vitest";
import { providerJsonSchema, validateProviderProposal } from "./contracts";
import {
  OpenAiProposalProviderError,
  OpenAiTerraProposalParser,
  PA1_TERRA_MODEL,
  toOpenAiStrictSchema,
} from "./openai-terra-provider";

const input = {
  taskType: "PRESCRIPTION_MEDICINE" as const,
  authoredText: "Napa 500 mg one tablet BD for 5 days",
  languageHints: ["en-US"],
  jsonSchema: providerJsonSchema("PRESCRIPTION_MEDICINE"),
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parserWith(fetchImpl: typeof fetch, enabled = true) {
  return new OpenAiTerraProposalParser({
    apiKey: "synthetic-eval-test-key-never-sent-to-browser",
    fetchImpl,
    syntheticEvaluationEnabled: enabled,
  });
}

describe("OpenAI Terra synthetic-only proposal adapter", () => {
  it("is hard-gated to synthetic evaluation", async () => {
    const parser = parserWith(async () => jsonResponse({}), false);
    await expect(parser.parse(input, new AbortController().signal)).rejects.toThrowError(
      new OpenAiProposalProviderError("OPENAI_SYNTHETIC_EVAL_DISABLED"),
    );
  });

  it("adapts DD optional nullable fields to OpenAI strict Structured Outputs", () => {
    const schema = toOpenAiStrictSchema(input.jsonSchema) as Record<string, unknown>;
    const properties = schema.properties as Record<string, unknown>;
    const medicine = properties.medicine as Record<string, unknown>;
    const medicineProperties = medicine.properties as Record<string, unknown>;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(Object.keys(properties));
    expect(medicine.additionalProperties).toBe(false);
    expect(medicine.required).toEqual(Object.keys(medicineProperties));
    expect(medicineProperties.route).toEqual({
      anyOf: [{ type: "string", minLength: 1 }, { type: "null" }],
    });
  });

  it("sends server-side Responses request with store=false and strict json_schema", async () => {
    let requestBody: Record<string, unknown> | null = null;
    let authorization = "";
    const fetchImpl: typeof fetch = async (_url, init) => {
      authorization = new Headers(init?.headers).get("Authorization") ?? "";
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({
        id: "resp_synthetic_001",
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  kind: "PRESCRIPTION_MEDICINE",
                  medicine: {
                    display_name: "Napa",
                    brand_name: null,
                    generic_name: null,
                    strength_text: "500 mg",
                    dose_text: "one tablet",
                    dosage_form: null,
                    route: null,
                    schedule_text: "BD",
                    duration_text: "5 days",
                    quantity_text: null,
                    food_relation: null,
                    is_prn: null,
                    instructions: null,
                    substitution_allowed: null,
                  },
                  uncertainties: [],
                  requires_review: true,
                }),
              },
            ],
          },
        ],
        usage: { input_tokens: 90, output_tokens: 80 },
      });
    };

    const result = await parserWith(fetchImpl).parse(input, new AbortController().signal);
    expect(authorization).toBe("Bearer synthetic-eval-test-key-never-sent-to-browser");
    expect(requestBody?.model).toBe(PA1_TERRA_MODEL);
    expect(requestBody?.store).toBe(false);
    const text = requestBody?.text as { format?: Record<string, unknown> };
    expect(text.format?.type).toBe("json_schema");
    expect(text.format?.strict).toBe(true);
    expect(result.provider).toEqual({
      provider: "openai",
      model: "gpt-5.6-terra",
      requestRef: "resp_synthetic_001",
    });
    const validated = validateProviderProposal("PRESCRIPTION_MEDICINE", result.rawProposal);
    if (validated.kind !== "PRESCRIPTION_MEDICINE") throw new Error("wrong kind");
    expect(validated.medicine.display_name).toBe("Napa");
    expect(validated.medicine.route).toBeNull();
  });

  it("does not let provider-native schema compliance bypass DD validator", async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({
        id: "resp_bad_extra",
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  kind: "PRESCRIPTION_MEDICINE",
                  medicine: { display_name: "Napa", diagnosis: "viral fever" },
                  uncertainties: [],
                  requires_review: true,
                }),
              },
            ],
          },
        ],
      });
    const result = await parserWith(fetchImpl).parse(input, new AbortController().signal);
    expect(() => validateProviderProposal("PRESCRIPTION_MEDICINE", result.rawProposal)).toThrow(
      /unexpected field/,
    );
  });

  it("fails closed on provider refusal", async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({
        status: "completed",
        output: [{ type: "message", content: [{ type: "refusal", refusal: "cannot comply" }] }],
      });
    await expect(parserWith(fetchImpl).parse(input, new AbortController().signal)).rejects.toThrowError(
      new OpenAiProposalProviderError("OPENAI_PROVIDER_REFUSAL"),
    );
  });

  it("fails closed on incomplete, HTTP and malformed responses", async () => {
    await expect(
      parserWith(async () => jsonResponse({ status: "incomplete" })).parse(
        input,
        new AbortController().signal,
      ),
    ).rejects.toThrowError(new OpenAiProposalProviderError("OPENAI_PROVIDER_INCOMPLETE"));

    await expect(
      parserWith(async () => jsonResponse({ error: { message: "bad request" } }, 400)).parse(
        input,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "OPENAI_PROVIDER_HTTP", status: 400 });

    await expect(
      parserWith(async () =>
        jsonResponse({
          status: "completed",
          output: [{ type: "message", content: [{ type: "output_text", text: "not-json" }] }],
        }),
      ).parse(input, new AbortController().signal),
    ).rejects.toThrowError(new OpenAiProposalProviderError("OPENAI_PROVIDER_MALFORMED"));
  });
});
