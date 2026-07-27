import { useInventoryTransactions } from '../../hooks/useInventoryTransactions';
import EmptyState from '../../components/EmptyState';
import { Page, PageHeading } from '../../components/layout/Page';
import { ContextPanel } from '../../components/layout/Slots';
import InventorySubNav from '../../components/inventory/InventorySubNav';
import { formatDateTime } from '../../utils/formatters';

const TYPE_LABEL: Record<string, string> = {
  opening_balance: 'Opening balance',
  issued: 'Issued',
  purchase_receipt: 'Purchase',
};

export default function InventoryTransactionsPage() {
  const { transactions, isLoading } = useInventoryTransactions();

  return (
    <>
      <ContextPanel><InventorySubNav /></ContextPanel>
      <Page className="space-y-4">
      <PageHeading title="Transactions" meta="Every stock movement, immutable once posted." />

      {isLoading ? (
        <div className="skeleton h-40" />
      ) : transactions.length === 0 ? (
        <EmptyState title="No transactions yet" />
      ) : (
        <div className="card divide-y divide-n-20">
          {transactions.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="text-13 font-semibold text-n-100 truncate">{t.itemName ?? 'Unknown item'}</div>
                <div className="text-xs text-n-70 truncate">
                  {TYPE_LABEL[t.transactionType] ?? t.transactionType} · {t.locationName ?? '—'} · {formatDateTime(t.createdAt)}
                </div>
              </div>
              <div className="text-13 font-semibold tabular-nums text-n-100 flex-shrink-0">
                {t.transactionType === 'issued' ? '−' : '+'}{t.quantity}
              </div>
            </div>
          ))}
        </div>
      )}
      </Page>
    </>
  );
}
