import 'package:flutter/material.dart';
import '../theme/grocery_theme.dart';
import 'grocery_home_screen.dart';
import 'grocery_categories_screen.dart';
import 'grocery_deals_screen.dart';
import 'grocery_cart_screen.dart';
import 'grocery_account_screen.dart';

class GroceryAppShell extends StatefulWidget {
  const GroceryAppShell({super.key});

  @override
  State<GroceryAppShell> createState() => _GroceryAppShellState();
}

class _GroceryAppShellState extends State<GroceryAppShell> {
  int _currentIndex = 0;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(
        index: _currentIndex,
        children: [
          const GroceryHomeScreen(),
          GroceryCategoriesScreen(
            onAddToCart: (title) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text('Added "$title" to Grocery Cart!'),
                  backgroundColor: GroceryTheme.primaryAction,
                ),
              );
            },
          ),
          GroceryDealsScreen(
            onAddToCart: (title) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text('Added "$title" to Grocery Cart!'),
                  backgroundColor: GroceryTheme.primaryAction,
                ),
              );
            },
          ),
          const GroceryCartScreen(),
          const GroceryAccountScreen(),
        ],
      ),
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          color: GroceryTheme.surfaceWhite,
          border: const Border(top: BorderSide(color: GroceryTheme.borderLight, width: 1)),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.05),
              blurRadius: 10,
              offset: const Offset(0, -3),
            ),
          ],
        ),
        child: NavigationBar(
          selectedIndex: _currentIndex,
          onDestinationSelected: (idx) => setState(() => _currentIndex = idx),
          backgroundColor: GroceryTheme.surfaceWhite,
          indicatorColor: GroceryTheme.sectionFill,
          destinations: const [
            NavigationDestination(
              icon: Icon(Icons.home_outlined),
              selectedIcon: Icon(Icons.home_rounded, color: GroceryTheme.primaryAction),
              label: 'Home',
            ),
            NavigationDestination(
              icon: Icon(Icons.grid_view_outlined),
              selectedIcon: Icon(Icons.grid_view_rounded, color: GroceryTheme.primaryAction),
              label: 'Categories',
            ),
            NavigationDestination(
              icon: Icon(Icons.local_offer_outlined),
              selectedIcon: Icon(Icons.local_offer_rounded, color: GroceryTheme.primaryAction),
              label: 'Deals',
            ),
            NavigationDestination(
              icon: Icon(Icons.shopping_bag_outlined),
              selectedIcon: Icon(Icons.shopping_bag_rounded, color: GroceryTheme.primaryAction),
              label: 'Cart',
            ),
            NavigationDestination(
              icon: Icon(Icons.person_outline_rounded),
              selectedIcon: Icon(Icons.person_rounded, color: GroceryTheme.primaryAction),
              label: 'Account',
            ),
          ],
        ),
      ),
    );
  }
}

