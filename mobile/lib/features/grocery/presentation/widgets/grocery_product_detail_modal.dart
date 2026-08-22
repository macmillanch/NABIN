import 'package:flutter/material.dart';
import '../theme/grocery_theme.dart';

/// Modal Popup for Product Detail with Scrollable Multi-Image Gallery,
/// Favorites (❤️) and Save for Later (🔖) functionality.
class GroceryProductDetailModal extends StatefulWidget {
  final Map<String, dynamic> product;
  final int initialQuantity;
  final Function(int qty) onQuantityChanged;

  const GroceryProductDetailModal({
    super.key,
    required this.product,
    this.initialQuantity = 0,
    required this.onQuantityChanged,
  });

  static void show({
    required BuildContext context,
    required Map<String, dynamic> product,
    int initialQuantity = 0,
    required Function(int qty) onQuantityChanged,
  }) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => GroceryProductDetailModal(
        product: product,
        initialQuantity: initialQuantity,
        onQuantityChanged: onQuantityChanged,
      ),
    );
  }

  @override
  State<GroceryProductDetailModal> createState() => _GroceryProductDetailModalState();
}

class _GroceryProductDetailModalState extends State<GroceryProductDetailModal> {
  late int _quantity;
  bool _isFavorite = false;
  bool _isSavedForLater = false;
  int _activeImageIndex = 0;
  late final PageController _imagePageController;

  @override
  void initState() {
    super.initState();
    _quantity = widget.initialQuantity;
    _imagePageController = PageController();
  }

  @override
  void dispose() {
    _imagePageController.dispose();
    super.dispose();
  }

  List<String> get _productImages {
    final baseImage = widget.product['imageUrl'] as String? ?? '';
    final emoji = widget.product['emoji'] as String? ?? '📦';

    // Generate 3 gallery images (primary image + multi-angle details)
    if (baseImage.isNotEmpty) {
      return [
        baseImage,
        'https://images.unsplash.com/photo-1542838132-92c53300491e?w=500&q=80',
        'https://images.unsplash.com/photo-1610832958506-aa56368176cf?w=500&q=80',
      ];
    }
    return [emoji, '$emoji (Pack View)', '$emoji (Organic Mandi Fresh)'];
  }

  void _toggleFavorite() {
    setState(() => _isFavorite = !_isFavorite);
    ScaffoldMessenger.of(context).hideCurrentSnackBar();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Row(
          children: [
            Icon(
              _isFavorite ? Icons.favorite_rounded : Icons.favorite_outline_rounded,
              color: GroceryTheme.accentRose,
              size: 20,
            ),
            const SizedBox(width: 10),
            Text(
              _isFavorite
                  ? '${widget.product['name']} added to Favorites ❤️'
                  : '${widget.product['name']} removed from Favorites',
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
          ],
        ),
        backgroundColor: GroceryTheme.textDark,
        duration: const Duration(seconds: 2),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    );
  }

  void _toggleSaveForLater() {
    setState(() => _isSavedForLater = !_isSavedForLater);
    ScaffoldMessenger.of(context).hideCurrentSnackBar();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Row(
          children: [
            Icon(
              _isSavedForLater ? Icons.bookmark_rounded : Icons.bookmark_outline_rounded,
              color: GroceryTheme.accentAmber,
              size: 20,
            ),
            const SizedBox(width: 10),
            Text(
              _isSavedForLater
                  ? '${widget.product['name']} saved for later 🔖'
                  : '${widget.product['name']} removed from Saved Items',
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
          ],
        ),
        backgroundColor: GroceryTheme.textDark,
        duration: const Duration(seconds: 2),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final images = _productImages;
    final name = widget.product['name'] as String? ?? 'Grocery Item';
    final weight = widget.product['weight'] as String? ?? '1 unit';
    final price = widget.product['price'] as int? ?? 0;
    final mrp = widget.product['mrp'] as int? ?? price;
    final discountPercent = mrp > price ? (((mrp - price) / mrp) * 100).round() : 0;
    final emoji = widget.product['emoji'] as String? ?? '📦';
    final bgColor = widget.product['imageColor'] as Color? ?? GroceryTheme.primaryGreenLight;

    return Container(
      height: MediaQuery.of(context).size.height * 0.82,
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(32)),
      ),
      child: Column(
        children: [
          // Drag Handle
          const SizedBox(height: 12),
          Container(
            width: 48,
            height: 5,
            decoration: BoxDecoration(
              color: GroceryTheme.borderLight,
              borderRadius: BorderRadius.circular(10),
            ),
          ),
          const SizedBox(height: 12),

          // Scrollable Content
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Multi-Image Carousel Box with Action Buttons Overlay
                  Stack(
                    children: [
                      // Carousel Container
                      Container(
                        height: 240,
                        width: double.infinity,
                        decoration: BoxDecoration(
                          color: bgColor,
                          borderRadius: BorderRadius.circular(24),
                        ),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(24),
                          child: PageView.builder(
                            controller: _imagePageController,
                            itemCount: images.length,
                            onPageChanged: (idx) {
                              setState(() => _activeImageIndex = idx);
                            },
                            itemBuilder: (ctx, idx) {
                              final imgPath = images[idx];
                              if (imgPath.startsWith('http')) {
                                return Image.network(
                                  imgPath,
                                  fit: BoxFit.cover,
                                  errorBuilder: (_, __, ___) => Center(
                                    child: Text(emoji, style: const TextStyle(fontSize: 80)),
                                  ),
                                );
                              }
                              return Center(
                                child: Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Text(emoji, style: const TextStyle(fontSize: 84)),
                                    const SizedBox(height: 6),
                                    Text(
                                      imgPath,
                                      style: const TextStyle(
                                        fontSize: 12,
                                        fontWeight: FontWeight.w700,
                                        color: GroceryTheme.textMuted,
                                      ),
                                    ),
                                  ],
                                ),
                              );
                            },
                          ),
                        ),
                      ),

                      // Close Button (Top Left)
                      Positioned(
                        top: 12,
                        left: 12,
                        child: GestureDetector(
                          onTap: () => Navigator.pop(context),
                          child: Container(
                            padding: const EdgeInsets.all(8),
                            decoration: BoxDecoration(
                              color: Colors.white.withValues(alpha: 0.9),
                              shape: BoxShape.circle,
                              boxShadow: [
                                BoxShadow(
                                  color: Colors.black.withValues(alpha: 0.1),
                                  blurRadius: 8,
                                ),
                              ],
                            ),
                            child: const Icon(Icons.close_rounded, color: GroceryTheme.textDark, size: 20),
                          ),
                        ),
                      ),

                      // Action Buttons: Favorite ❤️ & Save for Later 🔖 (Top Right)
                      Positioned(
                        top: 12,
                        right: 12,
                        child: Row(
                          children: [
                            // Save For Later Button
                            GestureDetector(
                              onTap: _toggleSaveForLater,
                              child: Container(
                                padding: const EdgeInsets.all(8),
                                decoration: BoxDecoration(
                                  color: Colors.white.withValues(alpha: 0.9),
                                  shape: BoxShape.circle,
                                  boxShadow: [
                                    BoxShadow(
                                      color: Colors.black.withValues(alpha: 0.1),
                                      blurRadius: 8,
                                    ),
                                  ],
                                ),
                                child: Icon(
                                  _isSavedForLater ? Icons.bookmark_rounded : Icons.bookmark_outline_rounded,
                                  color: _isSavedForLater ? GroceryTheme.accentAmber : GroceryTheme.textDark,
                                  size: 20,
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),

                            // Favorite Button
                            GestureDetector(
                              onTap: _toggleFavorite,
                              child: Container(
                                padding: const EdgeInsets.all(8),
                                decoration: BoxDecoration(
                                  color: Colors.white.withValues(alpha: 0.9),
                                  shape: BoxShape.circle,
                                  boxShadow: [
                                    BoxShadow(
                                      color: Colors.black.withValues(alpha: 0.1),
                                      blurRadius: 8,
                                    ),
                                  ],
                                ),
                                child: Icon(
                                  _isFavorite ? Icons.favorite_rounded : Icons.favorite_outline_rounded,
                                  color: _isFavorite ? GroceryTheme.accentRose : GroceryTheme.textDark,
                                  size: 20,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),

                      // Page Dots Indicator (Bottom Center)
                      Positioned(
                        bottom: 12,
                        left: 0,
                        right: 0,
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: List.generate(images.length, (idx) {
                            final isActive = _activeImageIndex == idx;
                            return AnimatedContainer(
                              duration: const Duration(milliseconds: 300),
                              margin: const EdgeInsets.symmetric(horizontal: 3),
                              width: isActive ? 18 : 7,
                              height: 7,
                              decoration: BoxDecoration(
                                color: isActive ? GroceryTheme.primaryGreenDark : Colors.white.withValues(alpha: 0.8),
                                borderRadius: BorderRadius.circular(10),
                              ),
                            );
                          }),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),

                  // Product Badges
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          color: GroceryTheme.primaryGreenLight,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: const Row(
                          children: [
                            Icon(Icons.bolt_rounded, size: 14, color: GroceryTheme.primaryGreenDark),
                            SizedBox(width: 4),
                            Text(
                              '10-MIN EXPRESS',
                              style: TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.w900,
                                color: GroceryTheme.primaryGreenDark,
                              ),
                            ),
                          ],
                        ),
                      ),
                      if (discountPercent > 0) ...[
                        const SizedBox(width: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                          decoration: BoxDecoration(
                            color: GroceryTheme.accentRose.withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(
                            '$discountPercent% OFF',
                            style: const TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.w900,
                              color: GroceryTheme.accentRose,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 10),

                  // Product Title & Weight
                  Text(
                    name,
                    style: const TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w900,
                      color: GroceryTheme.textDark,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Net Weight: $weight',
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: GroceryTheme.textMuted,
                    ),
                  ),
                  const SizedBox(height: 16),

                  // Price Tag Row
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.baseline,
                    textBaseline: TextBaseline.alphabetic,
                    children: [
                      Text(
                        '₹$price',
                        style: const TextStyle(
                          fontSize: 26,
                          fontWeight: FontWeight.w900,
                          color: GroceryTheme.primaryGreenDark,
                        ),
                      ),
                      if (mrp > price) ...[
                        const SizedBox(width: 10),
                        Text(
                          'MRP ₹$mrp',
                          style: const TextStyle(
                            fontSize: 15,
                            decoration: TextDecoration.lineThrough,
                            color: GroceryTheme.textMuted,
                          ),
                        ),
                      ],
                      const Spacer(),
                      const Row(
                        children: [
                          Icon(Icons.star_rounded, color: GroceryTheme.accentAmber, size: 18),
                          SizedBox(width: 4),
                          Text(
                            '4.9 (1.2k+ reviews)',
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w800,
                              color: GroceryTheme.textDark,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),

                  const Divider(color: GroceryTheme.borderLight),
                  const SizedBox(height: 12),

                  // Mandi & DarkStore Highlights
                  const Text(
                    'Product Information & Quality Guarantee',
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w900,
                      color: GroceryTheme.textDark,
                    ),
                  ),
                  const SizedBox(height: 10),
                  _buildHighlightRow(
                    Icons.verified_rounded,
                    'Freshness Guaranteed',
                    'Directly sourced from Azadpur Mandi / DarkStore #84',
                  ),
                  const SizedBox(height: 8),
                  _buildHighlightRow(
                    Icons.balance_rounded,
                    'Weight-Calibrated Pricing',
                    'Pay only for exact weight packed at darkstore',
                  ),
                  const SizedBox(height: 8),
                  _buildHighlightRow(
                    Icons.published_with_changes_rounded,
                    '100% Easy Returns',
                    'Instant doorstep refund if not satisfied',
                  ),
                  const SizedBox(height: 24),
                ],
              ),
            ),
          ),

          // Bottom Action Bar: Quantity Controls & Add to Cart
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.08),
                  blurRadius: 16,
                  offset: const Offset(0, -4),
                ),
              ],
            ),
            child: SafeArea(
              child: Row(
                children: [
                  // Quantity Increment / Decrement Selector
                  Container(
                    decoration: BoxDecoration(
                      color: GroceryTheme.surfaceElevated,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: GroceryTheme.borderLight),
                    ),
                    child: Row(
                      children: [
                        IconButton(
                          icon: const Icon(Icons.remove_rounded, color: GroceryTheme.primaryGreenDark, size: 20),
                          onPressed: _quantity > 0
                              ? () {
                                  setState(() => _quantity--);
                                  widget.onQuantityChanged(_quantity);
                                }
                              : null,
                        ),
                        Text(
                          '$_quantity',
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w900,
                            color: GroceryTheme.textDark,
                          ),
                        ),
                        IconButton(
                          icon: const Icon(Icons.add_rounded, color: GroceryTheme.primaryGreenDark, size: 20),
                          onPressed: () {
                            setState(() => _quantity++);
                            widget.onQuantityChanged(_quantity);
                          },
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 14),

                  // Add To Express Basket Button
                  Expanded(
                    child: ElevatedButton(
                      onPressed: () {
                        if (_quantity == 0) {
                          setState(() => _quantity = 1);
                        }
                        widget.onQuantityChanged(_quantity);
                        Navigator.pop(context);
                      },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: GroceryTheme.primaryGreenDark,
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16),
                        ),
                      ),
                      child: Text(
                        _quantity > 0 ? 'Update Basket (₹${price * _quantity})' : 'Add to Express Basket (₹$price)',
                        style: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildHighlightRow(IconData icon, String title, String subtitle) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 18, color: GroceryTheme.primaryGreenDark),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: const TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w800,
                  color: GroceryTheme.textDark,
                ),
              ),
              Text(
                subtitle,
                style: const TextStyle(
                  fontSize: 11,
                  color: GroceryTheme.textMuted,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
