import 'package:flutter/material.dart';

/// The strip that goes on top of a surface which imitates another NABIN app.
///
/// The Customer app can open a Driver console and a Restaurant console so a partner
/// journey can be walked from one device. Nothing in those screens is read from the
/// platform — the name, the rating, the earnings figure and the order queue are written
/// into the widget — so the screen has to say so out loud. A viewer who believes
/// "₹28,450 this week" is reading a demo as a statement about their own account.
///
/// The routes that host this carry the other half of the guarantee: they are only
/// registered when `NabinBuildEnv.allowsDemoConvenience`, so a build addressed at a
/// real user has no such surface to stand in front of.
class NabinDemoSimulatorBanner extends StatelessWidget {
  const NabinDemoSimulatorBanner({super.key, required this.surface});

  /// The real surface being imitated, e.g. 'the Driver app'.
  final String surface;

  @override
  Widget build(BuildContext context) {
    // Fixed colours rather than the ambient palette: this goes on a light driver console
    // and a dark merchant console alike, and it has to stay legible on both.
    return Container(
      width: double.infinity,
      color: const Color(0xFFFFF1CC),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.theater_comedy_rounded, size: 18, color: Color(0xFF8A5A00)),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'DEMO SIMULATOR',
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 0.8,
                    color: Color(0xFF8A5A00),
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'This stands in for $surface. Every name, rating, order and amount on '
                  'screen is sample text written into this build — it is not a partner '
                  'account, and nothing you do here reaches NABIN.',
                  style: const TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                    height: 1.3,
                    color: Color(0xFF6B4A00),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
