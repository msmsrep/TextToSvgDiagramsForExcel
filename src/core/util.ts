// Excel shape sizes are in points (1px = 0.75pt at 96 DPI).
export const PX_TO_PT = 0.75;

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
