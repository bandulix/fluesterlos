/** How finished a part of the school looks. */
export type BuildStage = "ghost" | "sketch" | "material" | "real";

export function buildingStage(percent: number): BuildStage {
  if (percent >= 100) return "real";
  if (percent >= 60) return "material";
  if (percent > 0) return "sketch";
  return "ghost";
}
