'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { TriangleAlert } from 'lucide-react';

/**
 * The one place a dangerous admin action asks first (area 49).
 *
 * Before this, three of the four privileged mutations on these screens fired straight from
 * a row button — suspend a merchant, suspend a driver, archive a campaign — and the fourth
 * (pause a service) confirmed by swapping the button for two more buttons in the same
 * square, whose copy said "Confirm pause" and nothing about what a pause does to the
 * people on the other end. Area 49's requirement is not a yes/no box, it is *a
 * confirmation that states exactly what will happen*, so the effect line below is not
 * optional: the dialog cannot be opened without one.
 *
 * Two deliberate limits:
 *
 *   - The dialog decides nothing about permissions. It is a mistake-prevention step in
 *     front of the same gated mutation the operator could always reach over HTTP; the
 *     server remains the enforcement point (§2.1, area 50).
 *   - With no provider mounted, `useConfirmAction()` resolves `false`. A dialog that
 *     cannot open does not wave the action through.
 *
 * A spec may also carry a `reason` field, which makes the dialog collect a sentence before
 * it will confirm, and `useConfirmDetails()` is the hook that reads it back. The confirm
 * button stays disabled while the field is short of the server's own minimum.
 */
export interface ReasonField {
  label: string;
  placeholder?: string;
  /**
   * The minimum the server refuses below. Mirrored here rather than discovered by a 400:
   * a customer suspension is rejected outright under five characters, because the audit
   * record is the only notice the customer ever gets of it.
   */
  minLength: number;
  help?: string;
}

export interface Confirmation {
  /** Names the object being changed, e.g. `Suspend Fresh Bites`. */
  title: string;
  /**
   * What the mutation does, in the operator's terms and in the present tense. This is the
   * line area 49 exists for, so it is required rather than encouraged.
   */
  effect: string;
  /** The parts an operator would learn afterwards, e.g. reversibility and blast radius. */
  consequences?: string[];
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` for a state change that stops something working; `warning` for the rest. */
  tone?: 'danger' | 'warning';
  /** Set this to make the dialog collect a sentence before it will confirm. */
  reason?: ReasonField;
}

/** What an open dialog resolves to: the answer, and whatever was typed into it. */
export interface ConfirmationResult {
  confirmed: boolean;
  reason: string;
}

type OpenFn = (confirmation: Confirmation) => Promise<ConfirmationResult>;
type ConfirmFn = (confirmation: Confirmation) => Promise<boolean>;

interface ConfirmApi {
  open: OpenFn;
  confirm: ConfirmFn;
}

const ConfirmContext = createContext<ConfirmApi>({
  open: async () => ({ confirmed: false, reason: '' }),
  confirm: async () => false
});

export function ConfirmActionProvider({ children }: { children: React.ReactNode }) {
  const [spec, setSpec] = useState<Confirmation | null>(null);
  const [reasonValue, setReasonValue] = useState('');
  const resolverRef = useRef<((result: ConfirmationResult) => void) | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);

  const settle = useCallback((confirmed: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setSpec(null);
    if (resolve) resolve({ confirmed, reason: reasonValue.trim() });
    // Back to the button the operator was on, so a keyboard walk does not restart at the
    // top of the table after every refusal.
    openerRef.current?.focus?.();
    openerRef.current = null;
  }, [reasonValue]);

  const open = useCallback<OpenFn>((confirmation) => {
    return new Promise<ConfirmationResult>((resolve) => {
      // A second request while one is open is refused, not queued. Two dialogs stacked on
      // the same operator is exactly how a wrong "yes" gets clicked.
      if (resolverRef.current) {
        resolve({ confirmed: false, reason: '' });
        return;
      }
      openerRef.current = document.activeElement as HTMLElement | null;
      resolverRef.current = resolve;
      setReasonValue('');
      setSpec(confirmation);
    });
  }, []);

  const confirm = useCallback(async (confirmation: Confirmation) => {
    return (await open(confirmation)).confirmed;
  }, [open]);

  const api = useMemo<ConfirmApi>(() => ({ open, confirm }), [open, confirm]);

  const requiredLength = spec?.reason?.minLength ?? 0;
  const reasonMissing = reasonValue.trim().length < requiredLength;

  useEffect(() => {
    if (!spec) return;
    // Cancel takes focus, never the confirm button: an accidental Enter on a freshly
    // opened dialog must not be the dangerous answer. With a reason to type, the field
    // takes it instead, and Enter inside a textarea is a newline rather than a yes.
    // `preventScroll` because the reason field sits below the consequences, and on a
    // phone-height viewport focusing it scrolled the very copy being confirmed out of
    // sight. Focus still lands there for typing; the panel stays where it opened.
    if (spec.reason) reasonRef.current?.focus({ preventScroll: true });
    else cancelRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        settle(false);
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled])')
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panelRef.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [spec, settle]);

  return (
    <ConfirmContext.Provider value={api}>
      {children}
      {spec && (
        <div
          className="nabin-scrim nabin-scrim--modal"
          onClick={() => settle(false)}
          role="presentation"
        >
          <div
            ref={panelRef}
            className="nabin-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="nabin-confirm-title"
            aria-describedby="nabin-confirm-effect"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="nabin-confirm-title" className="nabin-modal__title">
              <TriangleAlert size={18} aria-hidden="true" /> {spec.title}
            </h2>
            <p id="nabin-confirm-effect" className="nabin-modal__effect">
              {spec.effect}
            </p>
            {spec.consequences && spec.consequences.length > 0 && (
              <ul className="nabin-modal__list">
                {spec.consequences.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
            {spec.reason && (
              <div className="nabin-stack" style={{ gap: 'var(--space-xxs)' }}>
                <label className="nabin-label" htmlFor="nabin-confirm-reason">
                  {spec.reason.label}
                </label>
                <textarea
                  id="nabin-confirm-reason"
                  ref={reasonRef}
                  className="nabin-input"
                  rows={3}
                  value={reasonValue}
                  placeholder={spec.reason.placeholder}
                  onChange={(event) => setReasonValue(event.target.value)}
                />
                <span className="nabin-cell-meta">
                  {spec.reason.help ??
                    `At least ${spec.reason.minLength} characters. The server refuses a shorter one.`}
                </span>
              </div>
            )}
            <div className="nabin-row" style={{ justifyContent: 'flex-end' }}>
              <button
                ref={cancelRef}
                type="button"
                onClick={() => settle(false)}
                className="nabin-btn nabin-btn--ghost"
              >
                {spec.cancelLabel ?? 'Cancel'}
              </button>
              <button
                type="button"
                onClick={() => settle(true)}
                // Missing required text is not a confirmable state; the alternative is a
                // 400 from the route and an operator who has to read why.
                disabled={reasonMissing}
                className={`nabin-btn ${spec.tone === 'danger' ? 'nabin-btn--danger' : 'nabin-btn--primary'}`}
              >
                {spec.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirmAction(): ConfirmFn {
  return useContext(ConfirmContext).confirm;
}

/**
 * The same dialog for an action the server will not accept without a sentence: a customer
 * suspension or block is refused under five characters of reason, because the audit record
 * is the only notice the account holder gets — this write sends no notification.
 */
export function useConfirmDetails(): OpenFn {
  return useContext(ConfirmContext).open;
}
