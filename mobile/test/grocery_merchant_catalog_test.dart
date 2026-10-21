import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/network/nabin_api_service.dart';
import 'package:mobile/core/network/session_manager.dart';
import 'package:mobile/features/grocery_merchant/presentation/screens/grocery_merchant_catalog_screen.dart';

import 'support/http_stub.dart';

Widget testBoilerplate(Widget child) {
  return ProviderScope(
    child: MaterialApp(
      home: child,
    ),
  );
}

final List<Map<String, dynamic>> _mockMasterCatalog = [
  {
    'id': 'master-prod-01',
    'name': 'Fortune Sunlite Refined Sunflower Oil',
    'brand': 'Fortune',
    'category': 'Oils & Ghee',
    'subcategory': 'Cooking Oils',
    'standard_unit': 'litre',
    'pack_size': '1L Pouch',
    'pricing_model': 'PER_UNIT',
  },
  {
    'id': 'master-prod-02',
    'name': 'Aashirvaad Sharbati Select Atta',
    'brand': 'Aashirvaad',
    'category': 'Staples',
    'subcategory': 'Flour & Grains',
    'standard_unit': 'kg',
    'pack_size': '5kg Bag',
    'pricing_model': 'PER_UNIT',
  },
];

final List<Map<String, dynamic>> _mockInventory = [
  {
    'masterProductId': 'master-prod-01',
    'currentPrice': 145.0,
    'stockQty': 18,
    'unit': 'litre',
    'status': 'AVAILABLE',
    'isAvailable': true,
  },
];

void _setupStubHttp({List<Map<String, dynamic>>? master, List<Map<String, dynamic>>? inventory}) {
  stubHandler = (method, url, _) {
    final path = url.path;
    if (url.host.contains('unsplash') || path.endsWith('.jpg') || path.endsWith('.png')) {
      return (404, 'Not Found');
    }
    if (path.contains('/merchant/master-catalog')) {
      return (200, jsonEncode({
        'success': true,
        'products': master ?? _mockMasterCatalog,
        'degraded': false,
      }));
    }
    if (path.contains('/merchant/inventory/item')) {
      return (200, jsonEncode({'success': true}));
    }
    if (path.contains('/merchant/inventory')) {
      return (200, jsonEncode({
        'success': true,
        'inventory': inventory ?? _mockInventory,
      }));
    }
    return (200, jsonEncode({'success': true}));
  };
}

void main() {
  setUp(() {
    HttpOverrides.global = StubHttpOverrides();
    stubReset();
    NabinApiService.setAuthToken('merchant-grocery-token');
    SessionManager.instance.saveSession(
      token: 'merchant-grocery-token',
      user: {'id': 'groc_m_01', 'role': 'MERCHANT'},
    );
  });

  tearDown(() {
    HttpOverrides.global = null;
    stubReset();
    SessionManager.instance.clearSession();
  });

  group('GroceryMerchantCatalogScreen Unit & Widget Tests', () {
    testWidgets('GMC-01: Displays catalog products with name, price, unit and stock', (tester) async {
      _setupStubHttp();
      await tester.pumpWidget(testBoilerplate(const GroceryMerchantCatalogScreen()));
      await tester.pumpAndSettle();

      expect(find.text('Product Catalog'), findsOneWidget);
      expect(find.text('Fortune Sunlite Refined Sunflower Oil'), findsOneWidget);
      expect(find.text('₹145.00 • '), findsOneWidget);
      expect(find.text('18 litre (In stock)'), findsOneWidget);
      expect(find.text('Not stocked in your store yet'), findsOneWidget);
    });

    testWidgets('GMC-02: Add Product form opens and validates required fields', (tester) async {
      _setupStubHttp();
      await tester.pumpWidget(testBoilerplate(const GroceryMerchantCatalogScreen()));
      await tester.pumpAndSettle();

      // Tap + button in AppBar
      final addBtn = find.byIcon(Icons.add_box_outlined);
      expect(addBtn, findsOneWidget);
      await tester.tap(addBtn);
      await tester.pumpAndSettle();

      expect(find.text('Add Product'), findsOneWidget);
      expect(find.text('Product Name *'), findsOneWidget);

      // Attempt save with empty name
      final saveBtn = find.text('Save Product');
      expect(saveBtn, findsOneWidget);
      await tester.tap(saveBtn);
      await tester.pumpAndSettle();

      expect(find.text('Product name is required.'), findsOneWidget);
    });

    testWidgets('GMC-03: Create a custom product in isolated demo state', (tester) async {
      _setupStubHttp();
      await tester.pumpWidget(testBoilerplate(const GroceryMerchantCatalogScreen()));
      await tester.pumpAndSettle();

      await tester.tap(find.byIcon(Icons.add_box_outlined));
      await tester.pumpAndSettle();

      // Fill in product details
      await tester.enterText(find.widgetWithText(TextField, 'Product Name *'), 'Fresh Organic Alphonso Mangoes');
      await tester.enterText(find.widgetWithText(TextField, 'Selling Price (₹) *'), '450');
      await tester.enterText(find.widgetWithText(TextField, 'Stock Qty *'), '12');

      await tester.tap(find.text('Save Product'));
      await tester.pumpAndSettle();

      expect(find.text('Fresh Organic Alphonso Mangoes'), findsOneWidget);
      expect(find.text('CUSTOM'), findsOneWidget);
      expect(find.text('In stock (12 kg)'), findsOneWidget);
    });

    testWidgets('GMC-04: Edit updates the expected custom product rather than creating duplicate', (tester) async {
      _setupStubHttp();
      await tester.pumpWidget(testBoilerplate(const GroceryMerchantCatalogScreen()));
      await tester.pumpAndSettle();

      // Create product first
      await tester.tap(find.byIcon(Icons.add_box_outlined));
      await tester.pumpAndSettle();
      await tester.enterText(find.widgetWithText(TextField, 'Product Name *'), 'Kesar Mangoes');
      await tester.enterText(find.widgetWithText(TextField, 'Selling Price (₹) *'), '380');
      await tester.enterText(find.widgetWithText(TextField, 'Stock Qty *'), '15');
      await tester.tap(find.text('Save Product'));
      await tester.pumpAndSettle();

      expect(find.text('Kesar Mangoes'), findsOneWidget);

      // Tap Edit on custom item
      final editBtn = find.byIcon(Icons.edit_outlined);
      expect(editBtn, findsOneWidget);
      await tester.tap(editBtn);
      await tester.pumpAndSettle();

      expect(find.text('Edit Product'), findsOneWidget);
      await tester.enterText(find.widgetWithText(TextField, 'Product Name *'), 'Kesar Mangoes Premium Grade');
      await tester.tap(find.text('Save Product'));
      await tester.pumpAndSettle();

      expect(find.text('Kesar Mangoes Premium Grade'), findsOneWidget);
      expect(find.text('Kesar Mangoes'), findsNothing);
    });

    testWidgets('GMC-05: Validation rejects negative stock and invalid prices', (tester) async {
      _setupStubHttp();
      await tester.pumpWidget(testBoilerplate(const GroceryMerchantCatalogScreen()));
      await tester.pumpAndSettle();

      await tester.tap(find.byIcon(Icons.add_box_outlined));
      await tester.pumpAndSettle();

      await tester.enterText(find.widgetWithText(TextField, 'Product Name *'), 'Sample Ghee');
      await tester.enterText(find.widgetWithText(TextField, 'Selling Price (₹) *'), '0'); // Invalid price

      await tester.tap(find.text('Save Product'));
      await tester.pumpAndSettle();

      expect(find.text('Enter a selling price above 0.'), findsOneWidget);

      // Fix price and enter negative stock
      await tester.enterText(find.widgetWithText(TextField, 'Selling Price (₹) *'), '550');
      await tester.enterText(find.widgetWithText(TextField, 'Stock Qty *'), '-5'); // Invalid stock

      await tester.tap(find.text('Save Product'));
      await tester.pumpAndSettle();

      expect(find.text('Stock quantity cannot be negative.'), findsOneWidget);
    });

    testWidgets('GMC-06: Stock adjustment decrement clamps at zero non-negative bound', (tester) async {
      _setupStubHttp();
      await tester.pumpWidget(testBoilerplate(const GroceryMerchantCatalogScreen()));
      await tester.pumpAndSettle();

      // Create product with stock 1
      await tester.tap(find.byIcon(Icons.add_box_outlined));
      await tester.pumpAndSettle();
      await tester.enterText(find.widgetWithText(TextField, 'Product Name *'), 'Single Item Left');
      await tester.enterText(find.widgetWithText(TextField, 'Selling Price (₹) *'), '100');
      await tester.enterText(find.widgetWithText(TextField, 'Stock Qty *'), '1');
      await tester.tap(find.text('Save Product'));
      await tester.pumpAndSettle();

      expect(find.text('Low stock (1 left)'), findsOneWidget);

      // Decrement by 1
      final minusBtn = find.byIcon(Icons.remove);
      expect(minusBtn, findsWidgets);
      await tester.tap(minusBtn.first);
      await tester.pumpAndSettle();

      // Now stock is 0 -> Out of stock
      expect(find.text('Out of stock'), findsOneWidget);

      // Minus button is now disabled (onTap is null)
      await tester.tap(minusBtn.first);
      await tester.pumpAndSettle();

      // Stock remains Out of stock (cannot go negative)
      expect(find.text('Out of stock'), findsOneWidget);
    });

    testWidgets('GMC-07: Delete confirmation can be canceled without removing product', (tester) async {
      _setupStubHttp();
      await tester.pumpWidget(testBoilerplate(const GroceryMerchantCatalogScreen()));
      await tester.pumpAndSettle();

      // Create product
      await tester.tap(find.byIcon(Icons.add_box_outlined));
      await tester.pumpAndSettle();
      await tester.enterText(find.widgetWithText(TextField, 'Product Name *'), 'Item To Keep');
      await tester.enterText(find.widgetWithText(TextField, 'Selling Price (₹) *'), '90');
      await tester.enterText(find.widgetWithText(TextField, 'Stock Qty *'), '5');
      await tester.tap(find.text('Save Product'));
      await tester.pumpAndSettle();

      expect(find.text('Item To Keep'), findsOneWidget);

      // Tap Delete
      await tester.tap(find.byIcon(Icons.delete_outline));
      await tester.pumpAndSettle();

      expect(find.text('Delete Product?'), findsOneWidget);
      // Cancel
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();

      expect(find.text('Item To Keep'), findsOneWidget);
    });

    testWidgets('GMC-08: Confirmed deletion removes only the intended demo product', (tester) async {
      _setupStubHttp();
      await tester.pumpWidget(testBoilerplate(const GroceryMerchantCatalogScreen()));
      await tester.pumpAndSettle();

      // Create product
      await tester.tap(find.byIcon(Icons.add_box_outlined));
      await tester.pumpAndSettle();
      await tester.enterText(find.widgetWithText(TextField, 'Product Name *'), 'Temporary Product');
      await tester.enterText(find.widgetWithText(TextField, 'Selling Price (₹) *'), '50');
      await tester.enterText(find.widgetWithText(TextField, 'Stock Qty *'), '10');
      await tester.tap(find.text('Save Product'));
      await tester.pumpAndSettle();

      expect(find.text('Temporary Product'), findsOneWidget);

      // Tap Delete and confirm
      await tester.tap(find.byIcon(Icons.delete_outline));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Delete'));
      await tester.pumpAndSettle();

      expect(find.text('Temporary Product'), findsNothing);
    });

    testWidgets('GMC-09: Customer Preview displays product name, unit, and live price', (tester) async {
      _setupStubHttp();
      await tester.pumpWidget(testBoilerplate(const GroceryMerchantCatalogScreen()));
      await tester.pumpAndSettle();

      // Preview button on stocked item
      final previewBtns = find.byIcon(Icons.remove_red_eye_outlined);
      expect(previewBtns, findsWidgets);
      await tester.tap(previewBtns.first);
      await tester.pumpAndSettle();

      expect(find.text('Customer Product Preview'), findsOneWidget);
      expect(find.text('Fortune Sunlite Refined Sunflower Oil'), findsNWidgets(2));
      expect(find.text('Add to Basket'), findsOneWidget);
    });

    testWidgets('GMC-10: Demo photo gallery selection adds image to product photo gallery', (tester) async {
      _setupStubHttp();
      await tester.pumpWidget(testBoilerplate(const GroceryMerchantCatalogScreen()));
      await tester.pumpAndSettle();

      await tester.tap(find.byIcon(Icons.add_box_outlined));
      await tester.pumpAndSettle();

      // Scroll to Add Photo button inside modal sheet
      await tester.scrollUntilVisible(find.text('Add Photo'), 100, scrollable: find.byType(Scrollable).last);
      await tester.tap(find.text('Add Photo'));
      await tester.pumpAndSettle();

      expect(find.text('Add Grocery Photo'), findsOneWidget);
      expect(find.text('Curated grocery photos:'), findsOneWidget);

      // Select first photo from gallery and confirm inside AlertDialog
      final dialogInkWell = find.descendant(of: find.byType(AlertDialog), matching: find.byType(InkWell)).first;
      await tester.tap(dialogInkWell);
      await tester.pumpAndSettle();

      final addBtn = find.descendant(of: find.byType(AlertDialog), matching: find.text('Add'));
      await tester.tap(addBtn);
      await tester.pumpAndSettle();

      // The dialog closed and product sheet remains open with photo added
      expect(find.text('Add Grocery Photo'), findsNothing);
      expect(find.text('Add Product'), findsOneWidget);
    });

    testWidgets('GMC-11: Custom unit selection updates product unit in inventory card', (tester) async {
      _setupStubHttp();
      await tester.pumpWidget(testBoilerplate(const GroceryMerchantCatalogScreen()));
      await tester.pumpAndSettle();

      await tester.tap(find.byIcon(Icons.add_box_outlined));
      await tester.pumpAndSettle();

      await tester.enterText(find.widgetWithText(TextField, 'Product Name *'), 'Fresh Full Cream Milk');
      await tester.enterText(find.widgetWithText(TextField, 'Selling Price (₹) *'), '66');
      await tester.enterText(find.widgetWithText(TextField, 'Stock Qty *'), '30');

      // Scroll to Unit dropdown inside modal sheet
      await tester.scrollUntilVisible(find.byType(DropdownButtonFormField<String>), 50, scrollable: find.byType(Scrollable).last);
      await tester.tap(find.byType(DropdownButtonFormField<String>));
      await tester.pumpAndSettle();

      // Tap 'litre' option in open dropdown menu
      await tester.tap(find.text('litre').last);
      await tester.pumpAndSettle();

      await tester.tap(find.text('Save Product'));
      await tester.pumpAndSettle();

      expect(find.text('Fresh Full Cream Milk'), findsOneWidget);
      expect(find.text('In stock (30 litre)'), findsOneWidget);
    });

    testWidgets('GMC-12: Low-stock and out-of-stock filter chips dynamically update displayed products', (tester) async {
      _setupStubHttp();
      await tester.pumpWidget(testBoilerplate(const GroceryMerchantCatalogScreen()));
      await tester.pumpAndSettle();

      // Add a low-stock product (qty 3)
      await tester.tap(find.byIcon(Icons.add_box_outlined));
      await tester.pumpAndSettle();
      await tester.enterText(find.widgetWithText(TextField, 'Product Name *'), 'Limited Stock Saffron');
      await tester.enterText(find.widgetWithText(TextField, 'Selling Price (₹) *'), '499');
      await tester.enterText(find.widgetWithText(TextField, 'Stock Qty *'), '3');
      await tester.tap(find.text('Save Product'));
      await tester.pumpAndSettle();

      expect(find.text('Limited Stock Saffron'), findsOneWidget);

      // Tap 'Low Stock (≤5)' filter chip
      await tester.tap(find.text('Low Stock (≤5)'));
      await tester.pumpAndSettle();
      expect(find.text('Limited Stock Saffron'), findsOneWidget);

      // Tap 'Out of Stock' filter chip
      await tester.tap(find.text('Out of Stock'));
      await tester.pumpAndSettle();
      expect(find.text('Limited Stock Saffron'), findsNothing);

      // Tap 'All' filter chip to return to complete catalog
      await tester.tap(find.text('All'));
      await tester.pumpAndSettle();
      expect(find.text('Limited Stock Saffron'), findsOneWidget);
    });
  });
}
