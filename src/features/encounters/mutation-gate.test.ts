import { describe, it, expect } from "vitest";
import { MutationGate } from "./mutation-gate";

describe("MutationGate", () => {
  /**
   * THE TIMING BUG, exactly.
   *
   * A conflict used to close the gate from a `useEffect`, but the mutation that
   * discovered it released its in-flight flag in its own `finally` — which runs
   * before any effect. A direct call landing in that window started a second
   * mutation against a version already known to be stale.
   *
   * No renderer here on purpose: the guarantee must hold without React having
   * done anything at all.
   */
  it("refuses the very next call after a mutation closes it, with no effect cycle in between", async () => {
    const gate = new MutationGate();
    let called = 0;
    const action = async () => {
      called += 1;
      return "written";
    };

    // A mutation that discovers a conflict and shuts the gate on its way out.
    await gate.run(async () => {
      gate.close();
    });

    // Immediately afterwards — synchronously, no await of any scheduler.
    const result = await gate.run(action);

    expect(result).toBeNull();
    expect(called).toBe(0);
  });

  it("does not call the action while another mutation is in flight", async () => {
    const gate = new MutationGate();
    let called = 0;
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));

    const first = gate.run(async () => {
      await held;
      return "first";
    });
    const second = await gate.run(async () => {
      called += 1;
      return "second";
    });

    expect(second).toBeNull();
    expect(called).toBe(0);

    release();
    expect(await first).toBe("first");
  });

  it("runs again once the gate is reopened", async () => {
    const gate = new MutationGate();
    gate.close();
    expect(await gate.run(async () => "blocked")).toBeNull();

    gate.open();
    expect(await gate.run(async () => "allowed")).toBe("allowed");
  });

  /** A throwing mutation must not wedge the screen shut. */
  it("releases the in-flight flag even when the mutation throws", async () => {
    const gate = new MutationGate();
    await expect(
      gate.run(async () => {
        throw new Error("network");
      }),
    ).rejects.toThrow("network");

    expect(gate.isBusy).toBe(false);
    expect(await gate.run(async () => "after")).toBe("after");
  });

  it("reports its own state honestly", async () => {
    const gate = new MutationGate();
    expect(gate.isClosed).toBe(false);
    gate.close();
    expect(gate.isClosed).toBe(true);
    gate.open();
    expect(gate.isClosed).toBe(false);
  });
});
