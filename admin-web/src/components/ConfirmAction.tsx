'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
 */
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
}

type ConfirmFn = (confirmation: Confirmation) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(async () => false);

export function ConfirmActionProvider({ children }: { children: React.ReactNode }) {
  const [spec, setSpec] = useState<Confirmation | null>(null);
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  const settle = useCallback((confirmed: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setSpec(null);
    if (resolve) resolve(confirmed);
    // Back to the button the operator was on, so a keyboard walk does not restart at the
    // top of the table after every refusal.
    openerRef.current?.focus?.();
    openerRef.current = null;
  }, []);

  const confirm = useCallback<ConfirmFn>((confirmation) => {
    return new Promise<boolean>((resolve) => {
      // A second request while one is open is refused, not queued. Two dialogs stacked on
      // the same operator is exactly how a wrong "yes" gets clicked.
      if (resolverRef.current) {
        resolve(false);
        return;
      }
      openerRef.current = document.activeElement as HTMLElement | null;
      resolverRef.current = resolve;
      setSpec(confirmation);
    });
  }, []);

  useEffect(() => {
    if (!spec) return;
    // Cancel takes focus, never the confirm button: an accidental Enter on a freshly
    // opened dialog must not be the dangerous answer.
    cancelRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        settle(false);
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled])')
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
    <ConfirmContext.Provider value={confirm}>
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

export function useConfirmAction() {
  return useContext(ConfirmContext);
}
