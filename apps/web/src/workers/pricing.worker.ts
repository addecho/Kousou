import { calculate, optimize, ENGINE_VERSION } from "@kousou/core";
import { planSchema } from "@kousou/contracts";
self.onmessage = ({ data }) => {
  try {
    const plan = planSchema.parse(data.plan);
    self.postMessage({
      id: data.id,
      kind: data.kind,
      engineVersion: ENGINE_VERSION,
      result: data.kind === "optimize" ? optimize(plan) : calculate(plan),
    });
  } catch (e) {
    self.postMessage({
      id: data.id,
      kind: data.kind,
      error: e instanceof Error ? e.message : String(e),
    });
  }
};
