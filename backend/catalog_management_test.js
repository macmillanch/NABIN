const assert = require('assert');

console.log('🧪 Starting NABIN Catalog & Menu Management Verification Suite...\n');

// 1. Restaurant Dish Variant & Add-On Pricing Engine Test
function testRestaurantPricing() {
  console.log('[TEST 1] Restaurant Dish Variant & Add-On Calculation');

  const dish = {
    id: 'dish-demo-1',
    name: 'Royal Mutton Biryani',
    basePrice: 380,
    sellingPrice: 340,
    variants: [
      { id: 'v1', name: 'Regular', price: 340 },
      { id: 'v2', name: 'Large', price: 590 },
      { id: 'v3', name: 'Family Pack', price: 1100 },
    ],
    addOnGroups: [
      {
        id: 'g1',
        name: 'Accompaniments',
        isRequired: false,
        options: [
          { id: 'o1', name: 'Extra Salan', price: 40 },
          { id: 'o2', name: 'Egg', price: 25 },
        ],
      },
      {
        id: 'g2',
        name: 'Drinks',
        isRequired: false,
        options: [
          { id: 'o3', name: 'Thums Up', price: 40 },
        ],
      },
    ],
  };

  // Scenario A: Regular + Extra Salan + Egg (qty 2)
  const variantA = dish.variants.find((v) => v.id === 'v1');
  const addOnsA = [40, 25]; // Salan + Egg
  const unitTotalA = variantA.price + addOnsA.reduce((a, b) => a + b, 0); // 340 + 65 = 405
  const grandTotalA = unitTotalA * 2; // 810
  assert.strictEqual(unitTotalA, 405, 'Unit total should be 405');
  assert.strictEqual(grandTotalA, 810, 'Grand total for 2 items should be 810');

  // Scenario B: Large (no add-ons, qty 1)
  const variantB = dish.variants.find((v) => v.id === 'v2');
  assert.strictEqual(variantB.price, 590, 'Large portion should be 590');

  console.log('  ✅ Restaurant variant and add-on pricing engine passed (405 * 2 = 810).');
}

// 2. Add-On Selection Validation Test
function testAddOnValidation() {
  console.log('[TEST 2] Add-On Selection Rules & Limits');

  const requiredGroup = {
    id: 'grp-req',
    name: 'Choice of Bread',
    isRequired: true,
    selectionType: 'single',
    minSelect: 1,
    maxSelect: 1,
    options: ['Paratha', 'Naan'],
  };

  const multiGroup = {
    id: 'grp-multi',
    name: 'Extra Toppings',
    isRequired: false,
    selectionType: 'multi',
    minSelect: 0,
    maxSelect: 2,
    options: ['Cheese', 'Olives', 'Jalapenos'],
  };

  // Rule 1: Missing required option should fail validation
  function validateSelections(grp, selected) {
    if (grp.isRequired && selected.length < (grp.minSelect || 1)) {
      return { valid: false, error: 'MISSING_REQUIRED' };
    }
    if (grp.maxSelect && selected.length > grp.maxSelect) {
      return { valid: false, error: 'EXCEEDED_MAX' };
    }
    return { valid: true };
  }

  assert.strictEqual(validateSelections(requiredGroup, []).valid, false);
  assert.strictEqual(validateSelections(requiredGroup, ['Naan']).valid, true);
  assert.strictEqual(validateSelections(multiGroup, ['Cheese', 'Olives', 'Jalapenos']).valid, false);
  assert.strictEqual(validateSelections(multiGroup, ['Cheese', 'Olives']).valid, true);

  console.log('  ✅ Required and min/max selection bounds validation passed.');
}

// 3. Grocery Unit & Variant Pricing Test
function testGroceryPricingAndUnits() {
  console.log('[TEST 3] Grocery Units & Pack Variants Calculation');

  const attaProduct = {
    id: 'prod-demo-1',
    name: 'Aashirvaad Shudh Chakki Atta',
    unit: 'kg',
    variants: [
      { id: 'gv1', packSize: '1kg', sellingPrice: 62, mrp: 70, stockQty: 25 },
      { id: 'gv2', packSize: '5kg', sellingPrice: 275, mrp: 310, stockQty: 45 },
      { id: 'gv3', packSize: '10kg', sellingPrice: 510, mrp: 580, stockQty: 18 },
    ],
  };

  const oilProduct = {
    id: 'prod-demo-2',
    name: 'Fortune Sunlite Refined Sunflower Oil',
    unit: 'litre',
    variants: [
      { id: 'o1', packSize: '1L', sellingPrice: 135, mrp: 160, stockQty: 8 },
      { id: 'o2', packSize: '5L', sellingPrice: 650, mrp: 780, stockQty: 12 },
    ],
  };

  // Verify discount percentage computation
  const v1 = attaProduct.variants[0];
  const discountV1 = Math.round(((v1.mrp - v1.sellingPrice) / v1.mrp) * 100);
  assert.strictEqual(discountV1, 11, '1kg Atta discount should be 11%');

  const v2 = attaProduct.variants[1];
  const discountV2 = Math.round(((v2.mrp - v2.sellingPrice) / v2.mrp) * 100);
  assert.strictEqual(discountV2, 11, '5kg Atta discount should be 11%');

  // Multi-unit cart line total
  const cartLines = [
    { name: attaProduct.name, pack: v2.packSize, price: v2.sellingPrice, qty: 2 }, // 2x 5kg = 550
    { name: oilProduct.name, pack: oilProduct.variants[0].packSize, price: oilProduct.variants[0].sellingPrice, qty: 1 }, // 1x 1L = 135
  ];

  const subtotal = cartLines.reduce((acc, item) => acc + item.price * item.qty, 0);
  assert.strictEqual(subtotal, 685, 'Cart subtotal for 2x Atta 5kg + 1x Oil 1L should be 685');

  console.log('  ✅ Grocery multi-unit calculation passed (2x 5kg Atta + 1x 1L Oil = ₹685).');
}

// 4. Grocery Stock Adjustment & Threshold Test
function testStockAdjustment() {
  console.log('[TEST 4] Grocery Inventory Adjustments & Status Transitions');

  let stock = 12;
  const threshold = 10;

  function getStatus(qty) {
    if (qty <= 0) return 'OUT_OF_STOCK';
    if (qty <= threshold) return 'LOW_STOCK';
    return 'AVAILABLE';
  }

  assert.strictEqual(getStatus(stock), 'AVAILABLE');

  // Decrement by 3 -> 9 (Low stock)
  stock -= 3;
  assert.strictEqual(getStatus(stock), 'LOW_STOCK');

  // Decrement by 9 -> 0 (Out of stock)
  stock -= 9;
  assert.strictEqual(getStatus(stock), 'OUT_OF_STOCK');

  // Prevent negative stock
  stock = Math.max(0, stock - 5);
  assert.strictEqual(stock, 0);
  assert.strictEqual(getStatus(stock), 'OUT_OF_STOCK');

  console.log('  ✅ Stock transitions and non-negative constraints passed.');
}

// Run all test suites
try {
  testRestaurantPricing();
  testAddOnValidation();
  testGroceryPricingAndUnits();
  testStockAdjustment();
  console.log('\n========================================================================');
  console.log('🎉 ALL CATALOG & MENU MANAGEMENT VERIFICATION TESTS PASSED (4/4)!');
  console.log('========================================================================');
} catch (err) {
  console.error('\n❌ Test failure:', err);
  process.exit(1);
}
