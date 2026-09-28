/**
 * The numeric domain of a merchant's own grocery listing.
 *
 * `POST /api/merchant/inventory` used to do `parseFloat(currentPrice)` and
 * `parseInt(stockQty)` and write whatever came out. `parseFloat` accepts `-1`, `-0.01`,
 * `'-50'`, `' 12abc'` (→ 12) and `1e999` (→ Infinity); `parseInt` accepts `-1` and
 * silently truncates `12.9` to `12`. The database did not catch any of it either:
 * `merchant_grocery_inventory` was created in migration 001 as
 * `store_price NUMERIC(10,2) NOT NULL` and `stock_quantity INTEGER NOT NULL DEFAULT 0`
 * with no CHECK, and a scan of the deployed schema confirms this table carries **zero**
 * CHECK constraints today. So a negative price reached a row that `create_order_with_lines_atomic`
 * snapshots into `order_lines.unit_price_snapshot` — i.e. straight into what a customer is
 * charged and what the merchant is later paid.
 *
 * The bounds here are read off the schema, not invented:
 *   store_price    NUMERIC(10,2)  → 0 < price ≤ 99999999.99, at most 2 decimals
 *   stock_quantity INTEGER (int4)  → 0 ≤ stock ≤ 2147483647, whole numbers only
 *
 * Zero price is rejected deliberately. `master_grocery_catalog.pricing_model` holds only
 * `FIXED_PRICE` (14 of 14 rows), no listing has ever had `store_price = 0`, and "not
 * selling this" is already expressed by `is_available` / `status='INACTIVE'`. Nothing in the
 * platform means "free", so 0 is treated as an accident — which matters because
 * `grocery-merchant-web` builds its payload with `Number(payload.currentPrice)`, and
 * `Number('') === 0`, so an untouched price cell in a stock-only edit silently re-prices the
 * product to zero. That call site is fixed alongside this file.
 *
 * Strings are matched against a strict pattern instead of being handed to `Number()`, which
 * would accept `'1e2'`, `' 5 '`, `'+5'`, `'0x10'`, `'1_000'` and — since `Number('')` is 0
 * while `Number('   ')` is 0 too — the exact blank-input case that caused the bug above.
 */

const PRICE_PATTERN = /^(?:[1-9]\d{0,7}|0)(?:\.\d{1,2})?$/;
const STOCK_PATTERN = /^\d{1,10}$/;

const STORE_PRICE_MAX = 99999999.99; // NUMERIC(10,2)
const STOCK_QUANTITY_MAX = 2147483647; // INTEGER / int4

class InventoryValueError extends Error {
  constructor(field, reason, received) {
    super(`${field} ${reason}`);
    this.code = 'INVALID_INVENTORY_VALUE';
    this.status = 400;
    this.statusCode = 400;
    this.field = field;
    this.reason = reason;
    this.received = typeof received === 'string' ? received : String(received);
  }
}

/**
 * @returns {number|undefined} the validated price, or undefined when the caller is not
 *                             changing the price at all (a partial, stock-only update).
 */
function validateStorePrice(raw) {
  if (raw === undefined) return undefined;
  if (raw === null || typeof raw === 'boolean' || typeof raw === 'object') {
    throw new InventoryValueError('currentPrice', 'must be a decimal number', raw);
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) {
      throw new InventoryValueError('currentPrice', 'must be a finite number', raw);
    }
    if (!Number.isInteger(raw * 100) || Math.round(raw * 100) / 100 !== raw) {
      throw new InventoryValueError('currentPrice', 'may not have more than 2 decimal places', raw);
    }
    if (raw <= 0) {
      throw new InventoryValueError('currentPrice', 'must be greater than zero — NABIN has no free-product rule', raw);
    }
    if (raw > STORE_PRICE_MAX) {
      throw new InventoryValueError('currentPrice', `must not exceed ${STORE_PRICE_MAX}`, raw);
    }
    return raw;
  }
  const text = String(raw).trim();
  if (text === '') {
    throw new InventoryValueError('currentPrice', 'must not be blank', raw);
  }
  if (!PRICE_PATTERN.test(text)) {
    throw new InventoryValueError('currentPrice', 'must be a plain decimal amount with at most 2 decimals', raw);
  }
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0 || value > STORE_PRICE_MAX) {
    throw new InventoryValueError('currentPrice', `must be greater than zero and no more than ${STORE_PRICE_MAX}`, raw);
  }
  return value;
}

/**
 * @returns {number|undefined} the validated stock, or undefined when the caller is not
 *                             changing it. 0 is legitimate and means sold out, which the
 *                     existing status derivation already encodes as OUT_OF_STOCK.
 */
function validateStockQuantity(raw) {
  if (raw === undefined) return undefined;
  if (raw === null || typeof raw === 'boolean' || typeof raw === 'object') {
    throw new InventoryValueError('stockQty', 'must be a whole number', raw);
  }
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw)) {
      throw new InventoryValueError('stockQty', 'must be a whole number of units, not a fraction', raw);
    }
    if (raw < 0) {
      throw new InventoryValueError('stockQty', 'may not be negative', raw);
    }
    if (raw > STOCK_QUANTITY_MAX) {
      throw new InventoryValueError('stockQty', `must not exceed ${STOCK_QUANTITY_MAX}`, raw);
    }
    return raw;
  }
  const text = String(raw).trim();
  if (!STOCK_PATTERN.test(text)) {
    throw new InventoryValueError('stockQty', 'must be a plain non-negative integer', raw);
  }
  const value = Number(text);
  if (!Number.isInteger(value) || value < 0 || value > STOCK_QUANTITY_MAX) {
    throw new InventoryValueError('stockQty', `must be between 0 and ${STOCK_QUANTITY_MAX}`, raw);
  }
  return value;
}

module.exports = {
  validateStorePrice,
  validateStockQuantity,
  InventoryValueError,
  STORE_PRICE_MAX,
  STOCK_QUANTITY_MAX,
};
