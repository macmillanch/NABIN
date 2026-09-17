import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/admin_merchants_provider.dart';
import '../theme/admin_theme.dart';

class AdminMerchantsScreen extends ConsumerWidget {
  const AdminMerchantsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final merchantsState = ref.watch(adminMerchantsProvider);

    return Scaffold(
      backgroundColor: AdminTheme.bgOffWhite,
      appBar: AppBar(
        title: const Text('Merchant Management'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.read(adminMerchantsProvider.notifier).fetchMerchants(),
          ),
        ],
      ),
      body: merchantsState.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, stack) => Center(
          child: Text('Failed to load merchants: $err', style: const TextStyle(color: Colors.red)),
        ),
        data: (merchants) {
          if (merchants.isEmpty) {
            return const Center(child: Text('No merchants found.'));
          }
          return ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: merchants.length,
            itemBuilder: (context, index) {
              final merchant = merchants[index];
              return Card(
                elevation: 2,
                margin: const EdgeInsets.only(bottom: 16),
                child: ListTile(
                  leading: CircleAvatar(
                    backgroundColor: AdminTheme.primaryBlue.withOpacity(0.1),
                    child: Icon(
                      merchant['merchant_type'] == 'GROCERY' ? Icons.local_grocery_store : Icons.restaurant,
                      color: AdminTheme.primaryBlue,
                    ),
                  ),
                  title: Text(merchant['name'] ?? 'Unknown Merchant', style: const TextStyle(fontWeight: FontWeight.bold)),
                  subtitle: Text('Type: ${merchant['merchant_type']}\nStatus: ${merchant['status']}\nAddress: ${merchant['address']}'),
                  isThreeLine: true,
                  trailing: PopupMenuButton<String>(
                    onSelected: (value) async {
                      final success = await ref.read(adminMerchantsProvider.notifier).updateMerchantStatus(merchant['id'], value);
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text(success ? 'Merchant status updated' : 'Failed to update status')),
                        );
                      }
                    },
                    itemBuilder: (context) => [
                      const PopupMenuItem(value: 'ACTIVE', child: Text('Activate')),
                      const PopupMenuItem(value: 'SUSPENDED', child: Text('Suspend')),
                    ],
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }
}
