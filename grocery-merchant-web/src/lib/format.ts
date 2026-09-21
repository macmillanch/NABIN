interface ErrorBody {
  error?: string;
  message?: string;
  servicePaused?: boolean;
  resumeAt?: string | null;
  reason?: string | null;
}

export interface RequestFailure {
  message: string;
  status?: number;
  servicePaused: boolean;
  resumeAt?: string | null;
}

export const inr = (amount?: number | null) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount ?? 0);

export const dateTime = (value?: string | number | Date | null) => {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export function toFailure(err: unknown, fallback = 'Request failed. Please try again.'): RequestFailure {
  const response = (err as { response?: { status?: number; data?: ErrorBody } })?.response;
  const body = response?.data ?? {};
  return {
    message: body.error || body.message || fallback,
    status: response?.status,
    servicePaused: Boolean(body.servicePaused),
    resumeAt: body.resumeAt ?? null,
  };
}
