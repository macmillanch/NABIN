import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/core/network/nabin_api_service.dart';
import '../providers/admin_auth_provider.dart';
import '../providers/admin_metrics_provider.dart';
import '../theme/admin_theme.dart';

class AdminDashboardScreen extends ConsumerStatefulWidget {
  const AdminDashboardScreen({super.key});

  @override
  ConsumerState<AdminDashboardScreen> createState() => _AdminDashboardScreenState();
}

class _AdminDashboardScreenState extends ConsumerState<AdminDashboardScreen> {
  bool _isLoading = true;
  Map<String, dynamic>? _profile;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    final profile = await NabinApiService.getAdminProfile();
    setState(() {
      _profile = profile;
      _isLoading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final metricsState = ref.watch(adminMetricsProvider);

    return Scaffold(
      backgroundColor: AdminTheme.bgOffWhite,
      appBar: AppBar(
        title: const Text('Admin Dashboard'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () {
              ref.read(adminMetricsProvider.notifier).fetchMetrics();
            },
          ),
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: () {
              ref.read(adminAuthProvider.notifier).logout();
              context.go('/login');
            },
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: () async {
                await ref.read(adminMetricsProvider.notifier).fetchMetrics();
              },
              child: SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Welcome, ${_profile?['user']?['name'] ?? 'Admin'}',
                      style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 24),
                    
                    // Metrics Section
                    metricsState.when(
                      loading: () => const Center(child: CircularProgressIndicator()),
                      error: (err, stack) => Container(
                        padding: const EdgeInsets.all(16),
                        color: Colors.red.shade50,
                        child: Text('Failed to load metrics: $err', style: const TextStyle(color: Colors.red)),
                      ),
                      data: (metrics) {
                        if (metrics == null) return const SizedBox.shrink();
                        return Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text('System Overview', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                            const SizedBox(height: 16),
                            Wrap(
                              spacing: 16,
                              runSpacing: 16,
                              children: [
                                _buildMetricCard('Total Drivers', metrics['totalDrivers']?.toString() ?? '0', Icons.directions_car),
                                _buildMetricCard('Total Merchants', metrics['totalRestaurants']?.toString() ?? '0', Icons.store),
                                _buildMetricCard('Total Users', metrics['totalUsers']?.toString() ?? '0', Icons.people),
                                _buildMetricCard('Active Jobs', metrics['activeJobs']?.toString() ?? '0', Icons.receipt_long),
                              ],
                            ),
                            const SizedBox(height: 24),
                          ],
                        );
                      },
                    ),

                    const Text('Management Modules', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 16),
                    Wrap(
                      spacing: 16,
                      runSpacing: 16,
                      children: [
                        _buildActionCard(
                          'Feature Controls',
                          Icons.toggle_on,
                          () => context.push('/features'),
                        ),
                        _buildActionCard(
                          'Users',
                          Icons.people,
                          () => context.push('/users'),
                        ),
                        _buildActionCard(
                          'Drivers',
                          Icons.directions_car,
                          () => context.push('/drivers'),
                        ),
                        _buildActionCard(
                          'Merchants',
                          Icons.storefront,
                          () => context.push('/merchants'),
                        ),
                        _buildActionCard(
                          'Orders',
                          Icons.receipt,
                          () => context.push('/orders'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
    );
  }

  Widget _buildMetricCard(String title, String value, IconData icon) {
    return Container(
      width: 150,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AdminTheme.primaryBlue.withOpacity(0.1),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AdminTheme.primaryBlue.withOpacity(0.2)),
      ),
      child: Column(
        children: [
          Icon(icon, size: 28, color: AdminTheme.primaryBlue),
          const SizedBox(height: 8),
          Text(value, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: AdminTheme.primaryBlue)),
          const SizedBox(height: 4),
          Text(title, textAlign: TextAlign.center, style: TextStyle(fontSize: 12, color: Colors.grey.shade700)),
        ],
      ),
    );
  }

  Widget _buildActionCard(String title, IconData icon, VoidCallback onTap) {
    return InkWell(
      onTap: onTap,
      child: Container(
        width: 150,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.05),
              blurRadius: 10,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Column(
          children: [
            Icon(icon, size: 40, color: AdminTheme.primaryBlue),
            const SizedBox(height: 12),
            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(fontWeight: FontWeight.bold),
            ),
          ],
        ),
      ),
    );
  }
}
