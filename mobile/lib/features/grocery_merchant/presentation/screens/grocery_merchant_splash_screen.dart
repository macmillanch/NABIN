import 'package:flutter/material.dart';
import '../../../../core/widgets/nabin_brand_logo.dart';

/// Grocery Merchant Splash Screen
/// Entry point for NABIN Grocery Merchant App
class GroceryMerchantSplashScreen extends StatelessWidget {
  const GroceryMerchantSplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const NabinBrandLogo(
              fontSize: 32,
              showIcon: true,
              badge: 'GROCERY',
              badgeColor: Color(0xFFE8F5E9),
              badgeTextColor: Color(0xFF2E7D32),
            ),
            const SizedBox(height: 8),
            const Text(
              'Merchant Partner Console',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w500,
                color: Color(0xFF666666),
              ),
            ),
            const SizedBox(height: 40),
            const SizedBox(
              width: 40,
              height: 40,
              child: CircularProgressIndicator(
                color: Color(0xFF4CAF50),
                strokeWidth: 3,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
