/**
 * NABIN Tax Calculation Service
 * Dynamic tax rules engine by charge_component, category_code, and jurisdiction.
 */
const { supabaseAdmin, isLivePostgres } = require('../supabase');

const DEFAULT_TAX_RULES = {
  'FOOD_ITEM': { hsn_sac_code: '996331', tax_rate_percent: 5.0, is_inter_state_split: true },
  'PACKAGING_FEE': { hsn_sac_code: '996331', tax_rate_percent: 18.0, is_inter_state_split: true },
  'DELIVERY_FEE': { hsn_sac_code: '996813', tax_rate_percent: 18.0, is_inter_state_split: true },
  'PLATFORM_FEE': { hsn_sac_code: '998314', tax_rate_percent: 18.0, is_inter_state_split: true },
  'SURGE_FEE': { hsn_sac_code: '996813', tax_rate_percent: 18.0, is_inter_state_split: true }
};

class TaxCalculationService {
  constructor(db) {
    this.db = db;
  }

  /**
   * Resolve active tax rule for a given component and category
   */
  async resolveRule(serviceType, chargeComponent, categoryCode = 'DEFAULT') {
    if (isLivePostgres && supabaseAdmin) {
      try {
        const nowIso = new Date().toISOString();
        const { data, error } = await supabaseAdmin
          .from('tax_configurations')
          .select('*')
          .in('service_type', [serviceType, 'ALL'])
          .eq('charge_component', chargeComponent)
          .eq('is_active', true)
          .lte('effective_from', nowIso)
          .or(`effective_to.is.null,effective_to.gte.${nowIso}`)
          .order('priority', { ascending: false })
          .order('created_at', { ascending: false });

        if (!error && data && data.length > 0) {
          // Check for exact category match first
          const exact = data.find(r => r.category_code === categoryCode);
          if (exact) return exact;
          // Fallback to DEFAULT category
          const def = data.find(r => r.category_code === 'DEFAULT');
          if (def) return def;
          return data[0];
        }
      } catch (e) {
        console.warn('⚠️ TaxCalculationService DB lookup notice:', e.message);
      }
    }

    const fallback = DEFAULT_TAX_RULES[chargeComponent] || {
      hsn_sac_code: '996331',
      tax_rate_percent: 5.0,
      is_inter_state_split: true
    };
    return {
      service_type: serviceType,
      charge_component: chargeComponent,
      category_code: 'DEFAULT',
      hsn_sac_code: fallback.hsn_sac_code,
      tax_rate_percent: fallback.tax_rate_percent,
      is_inter_state_split: fallback.is_inter_state_split,
      pricing_mode: 'EXCLUSIVE'
    };
  }

  /**
   * Calculate taxes for an entire order breakdown
   */
  async calculateOrderTaxes({
    serviceType = 'FOOD',
    components = {}, // { FOOD_ITEM: 200, PACKAGING_FEE: 15, DELIVERY_FEE: 40, PLATFORM_FEE: 5, SURGE_FEE: 0 }
    merchantStateCode = '07', // Delhi default
    customerStateCode = '07'
  }) {
    const isInterState = String(merchantStateCode).trim() !== String(customerStateCode).trim();
    const breakdown = [];
    let totalTaxable = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;

    for (const [componentKey, amountRaw] of Object.entries(components)) {
      const taxable = Number(amountRaw || 0);
      if (taxable <= 0) continue;

      totalTaxable += taxable;
      const rule = await this.resolveRule(serviceType, componentKey);
      const rate = Number(rule.tax_rate_percent || 0);
      const taxTotal = Math.round((taxable * (rate / 100)) * 100) / 100;

      let cgst = 0;
      let sgst = 0;
      let igst = 0;

      if (!isInterState || !rule.is_inter_state_split) {
        // Intra-state split 50/50
        cgst = Math.round((taxTotal / 2) * 100) / 100;
        sgst = Math.round((taxTotal - cgst) * 100) / 100;
        totalCgst += cgst;
        totalSgst += sgst;
      } else {
        // Inter-state IGST
        igst = taxTotal;
        totalIgst += igst;
      }

      breakdown.push({
        chargeComponent: componentKey,
        hsnSacCode: rule.hsn_sac_code,
        taxableAmount: taxable,
        taxRatePercent: rate,
        isInterState,
        cgstAmount: cgst,
        sgstAmount: sgst,
        igstAmount: igst,
        totalTaxAmount: taxTotal
      });
    }

    const totalTax = Math.round((totalCgst + totalSgst + totalIgst) * 100) / 100;

    return {
      isInterState,
      merchantStateCode,
      customerStateCode,
      taxableAmount: Math.round(totalTaxable * 100) / 100,
      cgstAmount: Math.round(totalCgst * 100) / 100,
      sgstAmount: Math.round(totalSgst * 100) / 100,
      igstAmount: Math.round(totalIgst * 100) / 100,
      totalTaxAmount: totalTax,
      breakdown
    };
  }
}

module.exports = TaxCalculationService;
