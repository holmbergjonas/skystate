import type { SliceCreator, BillingSlice } from './types';
import { api } from '@/lib/api';

export const createBillingSlice: SliceCreator<BillingSlice> = (set) => ({
  billing: null,
  billingLoading: false,
  billingError: null,

  loadBilling: async () => {
    set({ billingLoading: true, billingError: null });
    try {
      const billing = await api.billing.status();
      set({ billing, billingLoading: false });
    } catch (err) {
      set({ billingError: (err as Error).message, billingLoading: false });
    }
  },

  invoices: [],
  invoicesLoading: false,
  invoicesError: null,

  loadInvoices: async () => {
    set({ invoicesLoading: true, invoicesError: null });
    try {
      const invoices = await api.invoices.list();
      set({ invoices, invoicesLoading: false });
    } catch (err) {
      set({ invoicesError: (err as Error).message, invoicesLoading: false });
    }
  },
});
