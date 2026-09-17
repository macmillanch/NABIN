import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/core/network/nabin_api_service.dart';
import '../theme/admin_theme.dart';

class AdminFeatureControlsScreen extends ConsumerStatefulWidget {
  const AdminFeatureControlsScreen({super.key});

  @override
  ConsumerState<AdminFeatureControlsScreen> createState() => _AdminFeatureControlsScreenState();
}

class _AdminFeatureControlsScreenState extends ConsumerState<AdminFeatureControlsScreen> {
  bool _isLoading = true;
  List<dynamic> _features = [];

  @override
  void initState() {
    super.initState();
    _loadFeatures();
  }

  Future<void> _loadFeatures() async {
    setState(() => _isLoading = true);
    final response = await NabinApiService.getAdminFeatures();
    if (response != null && response['success'] == true) {
      setState(() {
        _features = response['features'] ?? [];
      });
    }
    setState(() => _isLoading = false);
  }

  Future<void> _toggleFeature(String key, bool currentValue) async {
    final response = await NabinApiService.updateAdminFeature(key, {'enabled': !currentValue});
    if (response != null && response['success'] == true) {
      await _loadFeatures();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Feature $key updated successfully'), backgroundColor: AdminTheme.primaryGreen),
        );
      }
    } else {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to update feature'), backgroundColor: AdminTheme.accentRose),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AdminTheme.bgOffWhite,
      appBar: AppBar(
        title: const Text('Feature Controls'),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _loadFeatures,
              child: ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: _features.length,
                itemBuilder: (context, index) {
                  final feature = _features[index];
                  final isEnabled = feature['is_enabled'] ?? false;
                  return Card(
                    child: SwitchListTile(
                      title: Text(
                        feature['feature_key'] ?? 'Unknown',
                        style: const TextStyle(fontWeight: FontWeight.bold),
                      ),
                      subtitle: Text(feature['description'] ?? 'No description'),
                      value: isEnabled,
                      activeColor: AdminTheme.primaryGreen,
                      onChanged: (val) => _toggleFeature(feature['feature_key'], isEnabled),
                    ),
                  );
                },
              ),
            ),
    );
  }
}
