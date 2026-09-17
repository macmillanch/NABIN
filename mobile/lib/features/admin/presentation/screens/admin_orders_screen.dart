import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/admin_jobs_provider.dart';
import '../theme/admin_theme.dart';

class AdminOrdersScreen extends ConsumerWidget {
  const AdminOrdersScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final jobsState = ref.watch(adminJobsProvider);

    return Scaffold(
      backgroundColor: AdminTheme.bgOffWhite,
      appBar: AppBar(
        title: const Text('Order Operations'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.read(adminJobsProvider.notifier).fetchJobs(),
          ),
        ],
      ),
      body: jobsState.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, stack) => Center(
          child: Text('Failed to load orders: $err', style: const TextStyle(color: Colors.red)),
        ),
        data: (jobs) {
          if (jobs.isEmpty) {
            return const Center(child: Text('No active orders found.'));
          }
          return ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: jobs.length,
            itemBuilder: (context, index) {
              final job = jobs[index];
              return Card(
                elevation: 2,
                margin: const EdgeInsets.only(bottom: 16),
                child: ListTile(
                  leading: CircleAvatar(
                    backgroundColor: AdminTheme.primaryBlue.withOpacity(0.1),
                    child: Icon(
                      _getIconForService(job['service_type']),
                      color: AdminTheme.primaryBlue,
                    ),
                  ),
                  title: Text('Order: ${job['id']}', style: const TextStyle(fontWeight: FontWeight.bold)),
                  subtitle: Text('Service: ${job['service_type']}\nStatus: ${job['status']}\nCustomer: ${job['customer_id']}'),
                  isThreeLine: true,
                  trailing: Text(
                    '₹${job['estimated_fare'] ?? '0.0'}',
                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.green),
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }

  IconData _getIconForService(String? serviceType) {
    switch (serviceType) {
      case 'RIDE':
        return Icons.local_taxi;
      case 'FOOD':
        return Icons.restaurant;
      case 'GROCERY':
        return Icons.local_grocery_store;
      case 'PARCEL':
        return Icons.local_shipping;
      default:
        return Icons.receipt;
    }
  }
}
