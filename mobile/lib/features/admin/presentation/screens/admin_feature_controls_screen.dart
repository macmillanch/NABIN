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
  Map<String, dynamic> _features = {};

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
        _features = (response['features'] as Map<String, dynamic>?) ?? {};
      });
    }
    setState(() => _isLoading = false);
  }

  Future<void> _toggleFeature(String key, bool currentValue) async {
    // Show confirmation dialog before toggling
    final action = currentValue ? 'disable' : 'enable';
    final isConfirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('${currentValue ? 'Disable' : 'Enable'} Feature?'),
        content: Text('Are you sure you want to $action $key? This may affect active users immediately.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel', style: TextStyle(color: AdminTheme.textMuted)),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(context).pop(true),
            style: ElevatedButton.styleFrom(
              backgroundColor: currentValue ? AdminTheme.accentRose : AdminTheme.primaryGreen,
              foregroundColor: Colors.white,
            ),
            child: Text('Yes, $action'),
          ),
        ],
      ),
    );

    if (isConfirmed != true) return;

    final response = await NabinApiService.updateAdminFeature(key, {'enabled': !currentValue});
    if (response != null && response['success'] == true) {
      await _loadFeatures();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Feature $key updated successfully'), 
            backgroundColor: AdminTheme.primaryGreen,
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } else {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Failed to update feature'), 
            backgroundColor: AdminTheme.accentRose,
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    }
  }

  bool _isGlobalFeature(String key) {
    return ['FEATURE_RIDE', 'FEATURE_FOOD', 'FEATURE_GROCERY', 'FEATURE_PARCEL'].contains(key);
  }

  @override
  Widget build(BuildContext context) {
    final globalFeatures = _features.entries.where((e) => _isGlobalFeature(e.key)).toList();
    final subFeatures = _features.entries.where((e) => !_isGlobalFeature(e.key)).toList();

    return Scaffold(
      backgroundColor: AdminTheme.bgOffWhite,
      appBar: AppBar(
        title: const Text('Feature Controls'),
        backgroundColor: Colors.white,
        foregroundColor: AdminTheme.textDark,
        elevation: 0,
        centerTitle: true,
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _loadFeatures,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  if (globalFeatures.isNotEmpty) ...[
                    const Padding(
                      padding: EdgeInsets.only(left: 8, bottom: 12),
                      child: Text(
                        'Global Services',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w800,
                          color: AdminTheme.textDark,
                        ),
                      ),
                    ),
                    ...globalFeatures.map((e) => _buildFeatureCard(e.key, e.value, isGlobal: true)),
                    const SizedBox(height: 24),
                  ],
                  if (subFeatures.isNotEmpty) ...[
                    const Padding(
                      padding: EdgeInsets.only(left: 8, bottom: 12),
                      child: Text(
                        'Subfeatures & Modules',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                          color: AdminTheme.textMuted,
                        ),
                      ),
                    ),
                    ...subFeatures.map((e) => _buildFeatureCard(e.key, e.value, isGlobal: false)),
                  ],
                ],
              ),
            ),
    );
  }

  Widget _buildFeatureCard(String key, dynamic value, {required bool isGlobal}) {
    final isEnabled = value['enabled'] ?? false;
    final description = value['description'] ?? 'No description available for this feature.';

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: isGlobal 
              ? (isEnabled ? AdminTheme.primaryGreen.withValues(alpha: 0.3) : AdminTheme.accentRose.withValues(alpha: 0.3))
              : AdminTheme.borderLight,
          width: isGlobal ? 2 : 1,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.02),
            blurRadius: 4,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(
                        isGlobal ? Icons.language : Icons.extension_outlined,
                        size: 18,
                        color: isGlobal ? AdminTheme.primaryBlue : AdminTheme.textMuted,
                      ),
                      const SizedBox(width: 8),
                      Text(
                        key,
                        style: TextStyle(
                          fontSize: isGlobal ? 16 : 14,
                          fontWeight: isGlobal ? FontWeight.w800 : FontWeight.w600,
                          color: AdminTheme.textDark,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    description,
                    style: TextStyle(
                      fontSize: 13,
                      color: AdminTheme.textMuted,
                    ),
                  ),
                  if (!isEnabled)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Row(
                        children: [
                          Icon(Icons.warning_amber_rounded, size: 14, color: AdminTheme.accentRose),
                          const SizedBox(width: 4),
                          Text(
                            'Service Disabled',
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                              color: AdminTheme.accentRose,
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(width: 16),
            Switch(
              value: isEnabled,
              activeColor: AdminTheme.primaryGreen,
              inactiveTrackColor: AdminTheme.accentRose.withValues(alpha: 0.2),
              inactiveThumbColor: AdminTheme.accentRose,
              onChanged: (val) => _toggleFeature(key, isEnabled),
            ),
          ],
        ),
      ),
    );
  }
}
