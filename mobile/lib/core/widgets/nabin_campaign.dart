import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../config/nabin_app_config.dart';
import '../config/nabin_config_controller.dart';
import '../theme/nabin_palette.dart';

/// Everything a customer sees that a campaign published.
///
/// There is no festival content in this file: each widget asks the configuration
/// feed which campaign is live for a surface, and paints what that campaign
/// carries — its creatives, its offers, its copy. An operator publishing
/// "Christmas 2026" changes these screens without a new build, and taking it
/// down changes them back the same way.
///
/// All of them render `SizedBox.shrink()` (or the caller's fallback) when no
/// campaign applies. A placeholder would read as a campaign the server never
/// published.

/// The campaign wordmark or logo, in place of the built-in wordmark.
///
/// [serviceType] narrows which campaign's logo counts: a food-only campaign
/// should not relabel the whole platform's header.
class NabinCampaignWordmark extends ConsumerWidget {
  const NabinCampaignWordmark({super.key, required this.fallback, this.serviceType});

  final Widget fallback;
  final String? serviceType;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final config = ref.watch(nabinConfigProvider);
    final campaign = config.campaignFor(serviceType);
    final url = campaign?.theme.wordmarkUrl ?? campaign?.theme.logoUrl;
    if (url == null) return fallback;

    final palette = NabinPalette.of(context);
    // A logo the device cannot fetch must not leave a blank header: the built-in
    // wordmark is the fallback for a failure, not just for an absence.
    return Image.network(
      url,
      height: 26,
      fit: BoxFit.contain,
      semanticLabel: campaign!.name,
      errorBuilder: (context, error, stackTrace) => Icon(
        Icons.image_not_supported_outlined,
        size: 20,
        color: palette.onSurfaceMuted,
      ),
      loadingBuilder: (context, child, progress) => progress == null ? child : fallback,
    );
  }
}

/// A campaign's creatives, labelled with the campaign's own name.
///
/// Distinct from the promoted banner slot in `nabin_remote_banner.dart`: a
/// first-party campaign must not be tagged "Promoted", and a paid ad must not
/// borrow a festival's identity.
class NabinCampaignBanner extends ConsumerWidget {
  const NabinCampaignBanner({super.key, this.serviceType});

  final String? serviceType;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final config = ref.watch(nabinConfigProvider);
    final campaign = config.campaignFor(serviceType);
    if (campaign == null) return const SizedBox.shrink();

    final creatives = _matchingLanguage(context, campaign.creatives, (row) => row.locale);
    final offers = campaign.offers.where((offer) {
      if (offer.copy == null && offer.savingsText == null) return false;
      // An offer aimed at another service belongs on that service's surface.
      return campaign.targets(offer.serviceType);
    }).toList(growable: false);
    if (creatives.isEmpty && offers.isEmpty) return const SizedBox.shrink();

    final palette = NabinPalette.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final creative in creatives.take(3))
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(18),
                child: Container(
                  height: 128,
                  width: double.infinity,
                  color: palette.surfaceMuted,
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      Image.network(
                        creative.url,
                        fit: BoxFit.cover,
                        semanticLabel: creative.altText ?? campaign.name,
                        errorBuilder: (context, error, stackTrace) => ColoredBox(
                          color: palette.surfaceEmphasized,
                        ),
                        loadingBuilder: (context, child, progress) => progress == null
                            ? child
                            : ColoredBox(color: palette.surfaceEmphasized),
                      ),
                      Align(
                        alignment: Alignment.bottomLeft,
                        child: Container(
                          width: double.infinity,
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                          color: palette.surface.withValues(alpha: 0.86),
                          child: Text(
                            campaign.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 13.5,
                              fontWeight: FontWeight.w900,
                              color: palette.onSurface,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          if (offers.isNotEmpty) _OfferPills(offers: offers, campaignName: campaign.name),
        ],
      ),
    );
  }
}

/// Campaign copy the operator published for this surface: an announcement, an
/// inline banner, or a toast. A `POPUP` is [NabinCampaignPopup]'s business.
class NabinCampaignAnnouncement extends ConsumerWidget {
  const NabinCampaignAnnouncement({
    super.key,
    required this.surface,
    this.serviceType,
    this.triggers = const <String>{'APP_OPEN', 'HOME'},
  });

  final String surface;
  final String? serviceType;

  /// Which `triggerEvent` values may paint inline here. A copy written for
  /// checkout or after a trip is not this surface's to show.
  final Set<String> triggers;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final config = ref.watch(nabinConfigProvider);
    final campaign = config.campaignFor(serviceType);
    if (campaign == null) return const SizedBox.shrink();

    final message = _firstMessage(context, campaign, surface, triggers,
        kinds: const <String>{'ANNOUNCEMENT', 'INLINE_BANNER', 'TOAST'});
    if (message == null) return const SizedBox.shrink();

    final palette = NabinPalette.of(context);
    final accent = palette.brand;
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: accent.withValues(alpha: 0.07),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: accent.withValues(alpha: 0.3)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.campaign_rounded, size: 20, color: accent),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  (message.title?.trim().isNotEmpty ?? false)
                      ? message.title!.trim()
                      : campaign.name,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w900,
                    color: palette.onSurface,
                  ),
                ),
                if (message.body?.trim().isNotEmpty ?? false) ...[
                  const SizedBox(height: 3),
                  Text(
                    message.body!.trim(),
                    style: TextStyle(
                      fontSize: 11.5,
                      color: palette.onSurfaceMuted,
                      height: 1.35,
                    ),
                  ),
                ],
                const SizedBox(height: 3),
                Text(
                  campaign.name,
                  style: TextStyle(fontSize: 10.5, color: palette.onSurfaceMuted),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// A `POPUP` campaign message, shown once per launch and — when the campaign
/// asks for it — once ever.
class NabinCampaignPopup extends ConsumerStatefulWidget {
  const NabinCampaignPopup({
    super.key,
    required this.surface,
    this.serviceType,
    this.triggers = const <String>{'APP_OPEN', 'HOME'},
  });

  final String surface;
  final String? serviceType;
  final Set<String> triggers;

  @override
  ConsumerState<NabinCampaignPopup> createState() => _NabinCampaignPopupState();
}

class _NabinCampaignPopupState extends ConsumerState<NabinCampaignPopup> {
  bool _scheduled = false;

  @override
  void initState() {
    super.initState();
    // The popup is decided after the first frame so the dialog is never built
    // while the tree is, and so a configuration that has not arrived yet simply
    // shows nothing rather than a stale campaign.
    WidgetsBinding.instance.addPostFrameCallback((_) => _maybeShow());
  }

  Future<void> _maybeShow() async {
    if (_scheduled || !mounted) return;
    final config = ref.read(nabinConfigProvider);
    final campaign = config.campaignFor(widget.serviceType);
    if (campaign == null) return;

    final message = _firstMessage(
      context,
      campaign,
      widget.surface,
      widget.triggers,
      kinds: const <String>{'POPUP'},
    );
    if (message == null || !mounted) return;

    final key = 'nabin.campaign.${campaign.code}.${message.kind}';
    if (await _CampaignPopupMemory.hasSeen(key)) return;
    if (!mounted) return;
    _scheduled = true;

    final palette = NabinPalette.of(context);
    final dialog = AlertDialog(
      backgroundColor: palette.surface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22)),
      title: Text(
        (message.title?.trim().isNotEmpty ?? false) ? message.title!.trim() : campaign.name,
        style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: palette.onSurface),
      ),
      content: Text(
        message.body?.trim() ?? '',
        style: TextStyle(fontSize: 13, height: 1.4, color: palette.onSurfaceMuted),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          // `dismissible: false` is the operator saying this one has to be read,
          // so the only way out is acknowledging it.
          child: Text(
            message.dismissible ? 'Maybe later' : 'Got it',
            style: TextStyle(fontWeight: FontWeight.w900, color: palette.brand),
          ),
        ),
      ],
    );
    await _CampaignPopupMemory.markSeen(key);
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      barrierDismissible: message.dismissible,
      builder: (_) => dialog,
    );
  }

  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}

/// The campaign's discounts as pills under its creatives.
///
/// The percentage or rupee figure comes from the coupon row the campaign
/// references and is display copy only: checkout validates the coupon against
/// the server's own `promotions` row, so a published number can describe a
/// discount but never set one.
class _OfferPills extends StatelessWidget {
  const _OfferPills({required this.offers, required this.campaignName});

  final List<NabinCampaignOffer> offers;
  final String campaignName;

  @override
  Widget build(BuildContext context) {
    final palette = NabinPalette.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final offer in offers.take(4))
          Container(
            width: double.infinity,
            margin: const EdgeInsets.only(bottom: 6),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
            decoration: BoxDecoration(
              color: palette.brandTint,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Row(
              children: [
                Icon(
                  offer.hasCoupon ? Icons.local_offer_rounded : Icons.local_fire_department_outlined,
                  size: 14,
                  color: palette.brand,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    _text(offer),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: palette.brand),
                  ),
                ),
                if (offer.hasCoupon)
                  Text(
                    offer.couponCode!,
                    style: TextStyle(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 0.4,
                      color: palette.onSurfaceMuted,
                    ),
                  ),
              ],
            ),
          ),
      ],
    );
  }

  String _text(NabinCampaignOffer offer) {
    final copy = offer.copy?.trim();
    final savings = offer.savingsText;
    if (copy != null && copy.isNotEmpty && savings != null) return '$copy — $savings';
    if (copy != null && copy.isNotEmpty) return copy;
    return '${_serviceName(offer.serviceType)}: $savings';
  }

  String _serviceName(String serviceType) {
    switch (serviceType) {
      case 'RIDE':
        return 'Rides';
      case 'FOOD':
        return 'NABIN Food';
      case 'GROCERY':
        return 'NABIN Grocery';
      case 'PARCEL':
        return 'Parcel';
      default:
        return serviceType;
    }
  }
}

NabinCampaignMessage? _firstMessage(
  BuildContext context,
  NabinCampaign campaign,
  String surface,
  Set<String> triggers, {
  required Set<String> kinds,
}) {
  final wanted = _language(context);
  for (final message in campaign.messages) {
    if (!kinds.contains(message.kind)) continue;
    if ((message.surface ?? surface) != surface) continue;
    if (message.triggerEvent != null && !triggers.contains(message.triggerEvent)) continue;
    if (!_localeMatches(wanted, message.locale)) continue;
    if (!message.hasText) continue;
    return message;
  }
  return null;
}

/// Keep rows the device's language matches; when nothing does, keep rows that
/// named no language at all rather than showing a foreign-language creative.
List<T> _matchingLanguage<T>(BuildContext context, List<T> rows, String? Function(T) locale) {
  final wanted = _language(context);
  final matching = rows.where((row) => _localeMatches(wanted, locale(row))).toList(growable: false);
  return matching.isEmpty
      ? rows.where((row) => locale(row) == null).toList(growable: false)
      : matching;
}

bool _localeMatches(String language, String? locale) {
  if (locale == null || locale.isEmpty) return true;
  return locale.split(RegExp('[-_]')).first.toLowerCase() == language;
}

String _language(BuildContext context) {
  final locale =
      Localizations.maybeLocaleOf(context) ?? WidgetsBinding.instance.platformDispatcher.locale;
  return locale.languageCode.toLowerCase();
}

/// Which popup messages the device has already shown.
///
/// Best-effort persistence: a device without the storage plugin still will not
/// see the same popup twice in one launch, which is the failure that actually
/// annoys a customer.
class _CampaignPopupMemory {
  static final Set<String> _seenThisLaunch = <String>{};

  static Future<bool> hasSeen(String key) async {
    if (_seenThisLaunch.contains(key)) return true;
    final prefs = await _prefs();
    return prefs?.getBool(key) ?? false;
  }

  static Future<void> markSeen(String key) async {
    _seenThisLaunch.add(key);
    final prefs = await _prefs();
    await prefs?.setBool(key, true);
  }

  static Future<SharedPreferences?> _prefs() async {
    try {
      return await SharedPreferences.getInstance();
    } on Exception {
      return null;
    }
  }
}
