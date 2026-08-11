export function getErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

// Postgres foreign_key_violation (23503) — surfaced when deleting a catalog
// row (item/category/unit/location) that's already referenced by stock,
// transactions, purchases, sales, or requests. `on delete restrict` on
// every one of those FKs means the delete never partially applies; this
// just turns the raw Postgres error into an actionable message instead of
// leaking constraint/table names to the user.
export function friendlyDeleteErrorMessage(err: unknown, entityLabel: string): string {
  const code = (err as { code?: string } | null)?.code;
  if (code === '23503') {
    return `Can't delete this ${entityLabel} — it's already used in stock, transactions, purchases, sales, or requests. Deactivate it instead.`;
  }
  return getErrorMessage(err, `Failed to delete this ${entityLabel}.`);
}
