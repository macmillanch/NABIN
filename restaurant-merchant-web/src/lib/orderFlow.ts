import type { MerchantOrder, OrderLine } from './api';

export interface MerchantAction {
  status: string;
  label: string;
  tone: 'primary' | 'danger';
}

// Mirrors `is_valid_order_transition` (migration 018) intersected with the KDS
// allow-list in server.js (ACCEPTED/REJECTED/PREPARING/PACKING/READY_FOR_PICKUP),
// which is why merchant-facing rows never offer CANCELLED or PICKED_UP.
export const MERCHANT_ACTIONS: Record<string, MerchantAction[]> = {
  RECEIVED: [
    { status: 'ACCEPTED', label: 'Accept order', tone: 'primary' },
    { status: 'REJECTED', label: 'Reject', tone: 'danger' },
  ],
  ACCEPTED: [
    { status: 'PREPARING', label: 'Start preparing', tone: 'primary' },
    { status: 'PACKING', label: 'Move to packing', tone: 'primary' },
  ],
  PREPARING: [{ status: 'READY_FOR_PICKUP', label: 'Ready for pickup', tone: 'primary' }],
  PACKING: [{ status: 'READY_FOR_PICKUP', label: 'Ready for pickup', tone: 'primary' }],
  READY_FOR_PICKUP: [],
  PICKED_UP: [],
  DELIVERED: [],
  REJECTED: [],
  CANCELLED: [],
};

export const REJECTION_REASONS = [
  'ITEM_UNAVAILABLE',
  'MERCHANT_CLOSED',
  'OUT_OF_STOCK',
  'UNABLE_TO_PREPARE',
  'INVALID_ORDER',
  'OTHER',
];

export const STATE_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  RECEIVED: 'warning',
  ACCEPTED: 'warning',
  PREPARING: 'warning',
  PACKING: 'warning',
  READY_FOR_PICKUP: 'warning',
  PICKED_UP: 'neutral',
  DELIVERED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'danger',
};

export const isActive = (state?: string) =>
  !['DELIVERED', 'REJECTED', 'CANCELLED'].includes(state ?? '');

export const humanise = (value?: string | null) =>
  (value ?? '')
    .toLowerCase()
    .split('_')
    .join(' ')
    .replace(/^\w/, (char) => char.toUpperCase());

export const linesOf = (order: MerchantOrder): OrderLine[] =>
  order.lines && order.lines.length ? order.lines : order.items_snapshot ?? [];

export const prettyReason = (reason: string) => humanise(reason);
