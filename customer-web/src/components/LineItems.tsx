"use client";

export interface CartLine {
  id: number;
  name: string;
  qty: number;
}

export const blankLine = (id: number): CartLine => ({ id, name: "", qty: 1 });

interface LineItemsProps {
  lines: CartLine[];
  onChange: (lines: CartLine[]) => void;
  disabled?: boolean;
  placeholder?: string;
  qtyLabel?: string;
}

export default function LineItems({
  lines,
  onChange,
  disabled,
  placeholder = "e.g. Chicken Biryani",
  qtyLabel = "Qty",
}: LineItemsProps) {
  const update = (id: number, patch: Partial<CartLine>) =>
    onChange(lines.map((line) => (line.id === id ? { ...line, ...patch } : line)));

  return (
    <div className="nabin-stack" style={{ gap: "var(--space-xs)" }}>
      {lines.map((line, index) => (
        <div key={line.id} className="nabin-row" style={{ gap: "var(--space-xs)" }}>
          <input
            className="nabin-input"
            style={{ flex: 1, minWidth: 0 }}
            type="text"
            value={line.name}
            onChange={(e) => update(line.id, { name: e.target.value })}
            placeholder={index === 0 ? placeholder : "Another item"}
            aria-label={`Item ${index + 1} name`}
            disabled={disabled}
          />
          <input
            className="nabin-input nabin-num"
            style={{ width: 84 }}
            type="number"
            min={1}
            step={1}
            value={line.qty}
            onChange={(e) => update(line.id, { qty: Number(e.target.value) })}
            aria-label={`Item ${index + 1} ${qtyLabel}`}
            disabled={disabled}
          />
          <button
            type="button"
            className="nabin-btn nabin-btn--ghost"
            style={{ minHeight: 44, padding: "0 var(--space-sm)" }}
            onClick={() => onChange(lines.filter((l) => l.id !== line.id))}
            disabled={disabled || lines.length === 1}
            aria-label={`Remove item ${index + 1}`}
          >
            &#10005;
          </button>
        </div>
      ))}
      <button
        type="button"
        className="nabin-btn nabin-btn--ghost"
        style={{ minHeight: 40 }}
        onClick={() => onChange([...lines, blankLine(Date.now() + lines.length)])}
        disabled={disabled}
      >
        + Add item
      </button>
    </div>
  );
}
