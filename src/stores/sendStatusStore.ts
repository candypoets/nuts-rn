import type { ConnectionStatus } from '@candypoets/nipworker';
import { create } from 'zustand';

type SendStatusStore = {
  sendStatuses: Record<string, Record<string, ConnectionStatus>>;
  updateSendStatus(sendId: string, statusMap: Record<string, ConnectionStatus>): void;
  clearSendStatus(sendId: string): void;
};

const expiryTimers: Record<string, ReturnType<typeof setTimeout>> = {};

export const useSendStatusStore = create<SendStatusStore>()((set, get) => ({
  sendStatuses: {},
  updateSendStatus: (sendId, statusMap) => {
    set(state => ({ sendStatuses: { ...state.sendStatuses, [sendId]: statusMap } }));

    if (expiryTimers[sendId]) clearTimeout(expiryTimers[sendId]);
    expiryTimers[sendId] = setTimeout(() => get().clearSendStatus(sendId), 5200);
  },
  clearSendStatus: sendId => {
    set(state => {
      const next = { ...state.sendStatuses };
      delete next[sendId];
      return { sendStatuses: next };
    });
    if (expiryTimers[sendId]) {
      clearTimeout(expiryTimers[sendId]);
      delete expiryTimers[sendId];
    }
  },
}));

