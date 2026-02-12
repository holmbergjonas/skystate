import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useStore } from '@/store';
import { formatCents, capitalize } from '@/lib/format';

const statusStyles: Record<string, string> = {
  paid: 'text-emerald-400 bg-emerald-400/10',
  pending: 'text-amber-400 bg-amber-400/10',
  failed: 'text-red-400 bg-red-400/10',
  void: 'text-text-dim bg-white/5',
};

function formatPeriod(start: string, end: string): string {
  const s = new Date(start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const e = new Date(end).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${s} \u2013 ${e}`;
}

export function InvoiceHistory() {
  const invoices = useStore(s => s.invoices);
  const invoicesLoading = useStore(s => s.invoicesLoading);
  const invoicesError = useStore(s => s.invoicesError);
  const loadInvoices = useStore(s => s.loadInvoices);

  useEffect(() => {
    if (invoices.length === 0) {
      loadInvoices();
    }
  }, [invoices.length, loadInvoices]);

  return (
    <div>
      <h3 className="text-xs uppercase tracking-widest text-text-secondary mb-3 px-1">
        Invoice history
      </h3>

      {invoicesLoading && (
        <div className="flex items-center justify-center gap-2 py-12 text-text-secondary">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading invoices...</span>
        </div>
      )}

      {invoicesError && !invoicesLoading && (
        <p className="text-destructive text-sm text-center py-12">
          {invoicesError}
        </p>
      )}

      {!invoicesLoading && !invoicesError && invoices.length === 0 && (
        <p className="text-text-secondary text-sm text-center py-12">
          No invoices yet
        </p>
      )}

      {!invoicesLoading && !invoicesError && invoices.length > 0 && (
        <div className="rounded-xl bg-white/[0.03] border border-white/5 overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-white/[0.03]">
              <tr>
                <th className="text-xs uppercase tracking-wider text-text-dim font-semibold px-5 py-3">Date</th>
                <th className="text-xs uppercase tracking-wider text-text-dim font-semibold px-5 py-3">Tier</th>
                <th className="text-xs uppercase tracking-wider text-text-dim font-semibold px-5 py-3">Amount</th>
                <th className="text-xs uppercase tracking-wider text-text-dim font-semibold px-5 py-3">Status</th>
                <th className="text-xs uppercase tracking-wider text-text-dim font-semibold px-5 py-3">Billing period</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr
                  key={invoice.invoiceId}
                  className="border-t border-white/5 hover:bg-white/[0.02] transition-colors"
                >
                  <td className="px-5 py-4 text-sm text-text-secondary">
                    {new Date(invoice.createdAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="px-5 py-4 text-sm text-foreground">
                    {capitalize(invoice.tier)}
                    {invoice.boostMultiplier > 1 && (
                      <span className="text-text-dim"> ({invoice.boostMultiplier}x boost)</span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-sm text-foreground font-medium">
                    {formatCents(invoice.amountPaidCents)}
                  </td>
                  <td className="px-5 py-4">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium inline-block ${statusStyles[invoice.status] ?? 'text-text-dim bg-white/5'}`}
                    >
                      {capitalize(invoice.status)}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-sm text-text-secondary">
                    {formatPeriod(invoice.billingPeriodStart, invoice.billingPeriodEnd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
