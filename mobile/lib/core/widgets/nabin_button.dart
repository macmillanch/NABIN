import 'package:flutter/material.dart';
import '../theme/nabin_palette.dart';
import '../theme/nabin_tokens.dart';

class NabinButton extends StatefulWidget {
  final String text;
  final VoidCallback onPressed;

  /// Null means "paint the current brand", which is the only way a published
  /// palette can reach a CTA. A caller that passes a colour deliberately wins,
  /// because a service-tinted button is a decision made in code, not a theme.
  final Color? color;
  final IconData? icon;
  final bool isLoading;
  final double height;
  final double borderRadius;
  final TextStyle? textStyle;

  const NabinButton({
    super.key,
    required this.text,
    required this.onPressed,
    this.color,
    this.icon,
    this.isLoading = false,
    this.height = 54.0,
    this.borderRadius = 16.0,
    this.textStyle,
  });

  @override
  State<NabinButton> createState() => _NabinButtonState();
}

class _NabinButtonState extends State<NabinButton> with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _scaleAnimation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 100),
    );
    _scaleAnimation = Tween<double>(begin: 1.0, end: 0.97).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final NabinPalette palette = NabinPalette.of(context);
    final Color fill = widget.color ?? palette.brand;
    // The label is chosen against the fill rather than assumed white, so a
    // light published brand cannot ship an unreadable button.
    final Color ink = NabinTheme.on(fill, palette);

    return GestureDetector(
      onTapDown: (_) => _controller.forward(),
      onTapUp: (_) => _controller.reverse(),
      onTapCancel: () => _controller.reverse(),
      onTap: widget.isLoading ? null : widget.onPressed,
      child: AnimatedBuilder(
        animation: _scaleAnimation,
        builder: (context, child) => Transform.scale(
          scale: _scaleAnimation.value,
          child: child,
        ),
        child: Container(
          width: double.infinity,
          height: widget.height,
          decoration: BoxDecoration(
            color: fill,
            borderRadius: BorderRadius.circular(widget.borderRadius),
            boxShadow: [
              BoxShadow(
                color: fill.withValues(alpha: 0.25),
                blurRadius: 10,
                offset: const Offset(0, 4),
                spreadRadius: 0,
              ),
            ],
          ),
          child: Center(
            child: widget.isLoading
                ? SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(
                      strokeWidth: 2.5,
                      valueColor: AlwaysStoppedAnimation<Color>(ink),
                    ),
                  )
                : Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      if (widget.icon != null) ...[
                        Icon(widget.icon, size: 20, color: ink),
                        const SizedBox(width: 8),
                      ],
                      Text(
                        widget.text,
                        style: widget.textStyle ??
                            TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w800,
                              letterSpacing: 0.3,
                              color: ink,
                            ),
                      ),
                    ],
                  ),
          ),
        ),
      ),
    );
  }
}
