import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config/nabin_app_config.dart';
import '../config/nabin_config_controller.dart';
import '../models/nabin_advertisements.dart';
import '../theme/nabin_palette.dart';

/// A published campaign slot. It is the only banner surface that can change
/// without a release, so it is also the surface that has to be honest about
/// having nothing to show.
///
/// Empty, loading and failed all render nothing on purpose: an ad slot is not
/// information the customer asked for, and a placeholder box would read as a
/// campaign the server never published.
class NabinRemoteBanner extends ConsumerWidget {
  const NabinRemoteBanner({super.key, this.placement = kHomeBannerPlacement});

  final String placement;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final config = ref.watch(nabinConfigProvider);
    final feed = ref.watch(nabinAdvertisementsProvider(placement));
    // A degraded answer means the store could not be read at all, which is not
    // the same claim as "nothing is published" — but a banner is not something
    // the customer asked to be told about, so the state is reported through the
    // feed object for any surface that wants it and stays invisible here.
    final items = feed.valueOrNull?.activeAt(config.serverNowUtc) ?? const <NabinAdvertisement>[];
    if (items.isEmpty) return const SizedBox.shrink();

    final palette = NabinPalette.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final ad in items.take(3))
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: _BannerTile(ad: ad, palette: palette),
            ),
        ],
      ),
    );
  }
}

class _BannerTile extends StatelessWidget {
  const _BannerTile({required this.ad, required this.palette});

  final NabinAdvertisement ad;
  final NabinPalette palette;

  @override
  Widget build(BuildContext context) {
    // A campaign may point at an in-app route or at the open web. Only the first
    // is a navigation; the second has to leave the app.
    final target = ad.targetUrl;
    final inAppRoute = target != null && target.startsWith('/');
    final onTap = target == null || target.isEmpty
        ? null
        : inAppRoute
            ? () => context.push(target)
            : () async {
                final uri = Uri.tryParse(target);
                if (uri == null) return;
                if (await canLaunchUrl(uri)) {
                  await launchUrl(uri, mode: LaunchMode.externalApplication);
                }
              };

    return GestureDetector(
      onTap: onTap,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(18),
        child: Container(
          height: 128,
          width: double.infinity,
          color: palette.surfaceMuted,
          child: Stack(
            fit: StackFit.expand,
            children: [
              if (ad.imageUrl != null)
                Image.network(
                  ad.imageUrl!,
                  fit: BoxFit.cover,
                  // A creative that cannot be fetched still has to say what it
                  // was for, so the title below survives this fallback.
                  errorBuilder: (context, error, stackTrace) => ColoredBox(
                    color: palette.surfaceEmphasized,
                  ),
                  loadingBuilder: (context, child, progress) => progress == null
                      ? child
                      : ColoredBox(color: palette.surfaceEmphasized),
                )
              else
                ColoredBox(color: palette.brand.withValues(alpha: 0.08)),
              Align(
                alignment: Alignment.bottomLeft,
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  color: palette.surface.withValues(alpha: 0.86),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          ad.title,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 13.5,
                            fontWeight: FontWeight.w900,
                            color: palette.onSurface,
                            height: 1.25,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      // The store has no sponsor or creative column, so the only
                      // honest label here is the one that says what it is.
                      Text(
                        'Promoted',
                        style: TextStyle(
                          fontSize: 9,
                          fontWeight: FontWeight.w900,
                          letterSpacing: 0.6,
                          color: palette.onSurfaceMuted,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Platform state the operator has published: a paused or degraded service, or an
/// emergency stop, with the notice and the server's own resume time.
///
/// Nothing here is inferred from a local timer. A paused service whose
/// `resumeAt` has passed on the device clock still reads as paused until the
/// server says otherwise.
class NabinPlatformNotice extends ConsumerWidget {
  const NabinPlatformNotice({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final config = ref.watch(nabinConfigProvider);
    final blocked = config.services.values
        .where((service) => service.status != 'ACTIVE' && service.status != 'UNKNOWN')
        .toList(growable: false);
    // A lockdown is published as the summary with every row still listed, so the
    // rollup alone is enough to show the strip.
    if (blocked.isEmpty && !config.emergencyStop) return const SizedBox.shrink();

    final palette = NabinPalette.of(context);
    final emergency = config.emergencyStop;
    final accent = emergency ? palette.danger : palette.warning;
    final lead = emergency && blocked.isEmpty ? null : blocked.first;

    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: accent.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: accent.withValues(alpha: 0.35)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(emergency ? Icons.do_not_disturb_on_rounded : Icons.pause_circle_filled,
              size: 20, color: accent),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _headline(lead, emergency),
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w900,
                    color: palette.onSurface,
                  ),
                ),
                if (lead?.broadcastNotice != null && lead!.broadcastNotice!.trim().isNotEmpty) ...[
                  const SizedBox(height: 3),
                  Text(
                    lead.broadcastNotice!.trim(),
                    style: TextStyle(fontSize: 11.5, color: palette.onSurfaceMuted, height: 1.35),
                  ),
                ],
                const SizedBox(height: 3),
                Text(
                  _scheduleText(blocked, lead, config),
                  style: TextStyle(fontSize: 10.5, color: palette.onSurfaceMuted),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  String _headline(NabinServiceState? lead, bool emergency) {
    if (emergency) return 'NABIN is temporarily stopped';
    final name = lead!.name ?? lead.id;
    // Degraded is not paused: saying so would overstate what the server reported.
    return lead.status == 'DEGRADED' ? '$name is running with reduced capacity' : '$name is paused';
  }

  String _scheduleText(List<NabinServiceState> blocked, NabinServiceState? lead, NabinAppConfig config) {
    if (lead == null) {
      return config.services.isEmpty
          ? 'No service state has been published.'
          : 'Every service is stopped until the platform resumes it.';
    }
    if (blocked.length > 1) return '${blocked.length} services are not accepting orders.';
    final resume = lead.resumeAt;
    if (resume == null) return 'No resume time has been published.';
    final now = config.serverNowUtc;
    if (now == null) return 'Scheduled to resume at ${_clock(resume)}.';
    final remaining = resume.difference(now);
    if (remaining.isNegative) {
      return 'Past its published resume time of ${_clock(resume)}.';
    }
    final minutes = remaining.inMinutes;
    return 'Resumes in ${minutes < 1 ? 'under a minute' : '$minutes min'} '
        '(${_clock(resume)}).';
  }

  String _clock(DateTime moment) {
    final local = moment.toLocal();
    return '${local.hour.toString().padLeft(2, '0')}:'
        '${local.minute.toString().padLeft(2, '0')}';
  }
}
