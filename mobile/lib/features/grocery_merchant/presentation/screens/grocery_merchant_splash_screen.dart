import 'package:flutter/material.dart';

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
            // App Logo
            Container(
              width: 120,
              height: 120,
              decoration: BoxDecoration(
                color: const Color(0xFF4CAF50), // Green
                borderRadius: BorderRadius.circular(24),
              ),
              child: const Icon(
                Icons.shopping_bag_outlined,
                size: 60,
                color: Colors.white,
              ),
            ),
            const SizedBox(height: 24),
            const Text(
              'NABIN Grocery',
              style: TextStyle(
                fontSize: 32,
                fontWeight: FontWeight.w900,
                color: Color(0xFF2E7D32),
              ),
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
