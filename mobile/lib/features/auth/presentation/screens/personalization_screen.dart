import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/app_theme.dart';

class PersonalizationScreen extends StatefulWidget {
  const PersonalizationScreen({super.key});

  @override
  State<PersonalizationScreen> createState() => _PersonalizationScreenState();
}

class _PersonalizationScreenState extends State<PersonalizationScreen> {
  final TextEditingController _nameController = TextEditingController(text: 'Rahul Sharma');
  final TextEditingController _emailController = TextEditingController(text: 'rahul.sharma@example.com');
  int _selectedLang = 0;
  bool _isLoading = false;

  final List<String> _languages = ['English', 'हिंदी (Hindi)', 'বাংলা (Bengali)', 'తెలుగు (Telugu)'];

  void _finishSetup() {
    setState(() => _isLoading = true);
    Future.delayed(const Duration(milliseconds: 600), () {
      if (mounted) {
        setState(() => _isLoading = false);
        context.go('/identity-verification-submit');
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new, color: AppTheme.onSurface, size: 20),
          onPressed: () => context.canPop() ? context.pop() : context.go('/otp-verification'),
        ),
        title: const Text('NABIN', style: TextStyle(fontWeight: FontWeight.w900, fontSize: 20, color: AppTheme.primary, letterSpacing: 0.5)),
        centerTitle: true,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 12),
              const Text(
                'Complete your profile',
                style: TextStyle(fontSize: 28, fontWeight: FontWeight.w900, color: AppTheme.onSurface, letterSpacing: -0.5),
              ),
              const SizedBox(height: 6),
              const Text(
                'Personalize your super-app experience for rides, dining, and parcels.',
                style: TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 14),
              ),
              const SizedBox(height: 28),

              // Avatar Container with Edit Icon
              Center(
                child: Stack(
                  children: [
                    Container(
                      width: 100,
                      height: 100,
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          colors: [AppTheme.primary, AppTheme.primaryContainer],
                        ),
                        shape: BoxShape.circle,
                        boxShadow: [
                          BoxShadow(
                            color: AppTheme.primary.withValues(alpha: 0.3),
                            blurRadius: 16,
                            offset: const Offset(0, 6),
                          ),
                        ],
                      ),
                      child: const Center(
                        child: Text('RS', style: TextStyle(fontSize: 32, fontWeight: FontWeight.w900, color: Colors.white)),
                      ),
                    ),
                    Positioned(
                      bottom: 0,
                      right: 0,
                      child: GestureDetector(
                        onTap: () {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Avatar updated')),
                          );
                        },
                        child: Container(
                          padding: const EdgeInsets.all(8),
                          decoration: const BoxDecoration(
                            color: Colors.white,
                            shape: BoxShape.circle,
                            boxShadow: [BoxShadow(color: Colors.black26, blurRadius: 4)],
                          ),
                          child: const Icon(Icons.camera_alt_rounded, size: 16, color: AppTheme.primary),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 32),

              // Name Field
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                decoration: BoxDecoration(
                  color: AppTheme.surfaceContainerLowest,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: AppTheme.outlineVariant),
                  boxShadow: const [BoxShadow(color: Colors.black12, blurRadius: 4, offset: Offset(0, 2))],
                ),
                child: TextField(
                  controller: _nameController,
                  style: const TextStyle(fontWeight: FontWeight.bold, color: AppTheme.onSurface, fontSize: 16),
                  decoration: const InputDecoration(
                    labelText: 'Full Name',
                    labelStyle: TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 13),
                    border: InputBorder.none,
                    icon: Icon(Icons.person_outline, color: AppTheme.primary),
                  ),
                ),
              ),
              const SizedBox(height: 16),

              // Email Field
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                decoration: BoxDecoration(
                  color: AppTheme.surfaceContainerLowest,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: AppTheme.outlineVariant),
                  boxShadow: const [BoxShadow(color: Colors.black12, blurRadius: 4, offset: Offset(0, 2))],
                ),
                child: TextField(
                  controller: _emailController,
                  keyboardType: TextInputType.emailAddress,
                  style: const TextStyle(fontWeight: FontWeight.bold, color: AppTheme.onSurface, fontSize: 16),
                  decoration: const InputDecoration(
                    labelText: 'Email Address',
                    labelStyle: TextStyle(color: AppTheme.onSurfaceVariant, fontSize: 13),
                    border: InputBorder.none,
                    icon: Icon(Icons.email_outlined, color: AppTheme.primary),
                  ),
                ),
              ),
              const SizedBox(height: 24),

              // Preferred Language Selector
              const Text('App Language', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w900, color: AppTheme.onSurface)),
              const SizedBox(height: 10),
              Wrap(
                spacing: 10,
                runSpacing: 10,
                children: List.generate(_languages.length, (idx) {
                  final isSelected = _selectedLang == idx;
                  return GestureDetector(
                    onTap: () => setState(() => _selectedLang = idx),
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 200),
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                      decoration: BoxDecoration(
                        color: isSelected ? AppTheme.primary : AppTheme.surfaceContainerLowest,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: isSelected ? AppTheme.primary : AppTheme.outlineVariant),
                      ),
                      child: Text(
                        _languages[idx],
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w800,
                          color: isSelected ? Colors.white : AppTheme.onSurface,
                        ),
                      ),
                    ),
                  );
                }),
              ),
              const SizedBox(height: 40),

              ElevatedButton(
                onPressed: _isLoading ? null : _finishSetup,
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppTheme.primaryContainer,
                  foregroundColor: Colors.white,
                  minimumSize: const Size(double.infinity, 56),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  elevation: 2,
                  shadowColor: AppTheme.primary.withValues(alpha: 0.35),
                ),
                child: _isLoading
                    ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5))
                    : const Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text('Get Moving', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
                          SizedBox(width: 8),
                          Icon(Icons.arrow_forward, size: 18),
                        ],
                      ),
              ),
              const SizedBox(height: 20),
            ],
          ),
        ),
      ),
    );
  }
}
