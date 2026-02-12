import type { SliceCreator, AuthSlice } from './types';
import { api } from '@/lib/api';

export const createAuthSlice: SliceCreator<AuthSlice> = (set, get) => ({
  user: null,
  setUser: (user) => set({ user }),
  updateUserRetention: async (days) => {
    await api.users.updateRetention({ days });
    const user = get().user;
    if (user) {
      set({ user: { ...user, customRetentionDays: days } });
    }
  },
});
