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
        <div key={line.id} className="nabin-row" style={{ gap: "var(--space-xs)", alignItems: "center" }}>
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
            style={{ width: 76, minWidth: 60, textAlign: "center", padding: "10px var(--space-xs)" }}
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
            style={{
              minHeight: 44,
              minWidth: 44,
              width: 44,
              padding: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
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
        style={{
          minHeight: 40,
          alignSelf: "flex-start",
          padding: "0 var(--space-md)",
          fontSize: 14,
        }}
        onClick={() => onChange([...lines, blankLine(Date.now() + lines.length)])}
        disabled={disabled}
      >
        + Add item
      </button>
    </div>
  );
}
