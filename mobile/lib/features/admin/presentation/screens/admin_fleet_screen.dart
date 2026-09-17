import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/admin_drivers_provider.dart';
import '../theme/admin_theme.dart';

class AdminFleetScreen extends ConsumerWidget {
  const AdminFleetScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final driversState = ref.watch(adminDriversProvider);

    return Scaffold(
      backgroundColor: AdminTheme.bgOffWhite,
      appBar: AppBar(
        title: const Text('Fleet Management'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.read(adminDriversProvider.notifier).fetchDrivers(),
          ),
        ],
      ),
      body: driversState.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, stack) => Center(
          child: Text('Failed to load drivers: $err', style: const TextStyle(color: Colors.red)),
        ),
        data: (drivers) {
          if (drivers.isEmpty) {
            return const Center(child: Text('No drivers found.'));
          }
          return ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: drivers.length,
            itemBuilder: (context, index) {
              final driver = drivers[index];
              return Card(
                elevation: 2,
                margin: const EdgeInsets.only(bottom: 16),
                child: ListTile(
                  leading: CircleAvatar(
                    backgroundColor: AdminTheme.primaryBlue.withOpacity(0.1),
                    child: const Icon(Icons.directions_car, color: AdminTheme.primaryBlue),
                  ),
                  title: Text(driver['name'] ?? 'Unknown Driver', style: const TextStyle(fontWeight: FontWeight.bold)),
                  subtitle: Text('ID: ${driver['id']}\nStatus: ${driver['status']}\nVehicle: ${driver['vehicleType']}'),
                  isThreeLine: true,
                  trailing: PopupMenuButton<String>(
                    onSelected: (value) async {
                      final success = await ref.read(adminDriversProvider.notifier).updateDriverStatus(driver['id'], value);
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text(success ? 'Driver status updated' : 'Failed to update status')),
                        );
                      }
                    },
                    itemBuilder: (context) => [
                      const PopupMenuItem(value: 'ACTIVE', child: Text('Activate')),
                      const PopupMenuItem(value: 'SUSPENDED', child: Text('Suspend')),
                      const PopupMenuItem(value: 'PENDING_KYC', child: Text('Set Pending KYC')),
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
