export function analyticsChain(raw: string | null): number | undefined {
  if (!raw || raw === "all") return undefined;
  const id = Number(raw);
  if (id !== 5042 && id !== 4663) throw new Error("Unsupported analytics network");
  return id;
}
