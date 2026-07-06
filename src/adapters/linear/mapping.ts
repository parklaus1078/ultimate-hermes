export type LinearExportPolicy = "local_only" | "linear_candidate" | "linear_exported";

export function shouldExportToLinear(policy: LinearExportPolicy): boolean {
  return policy === "linear_candidate";
}
