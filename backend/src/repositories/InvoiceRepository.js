/**
 * NABIN Invoice Repository
 * Authoritative Tax Invoice Generation, Series Sequencing, and Immutability.
 */
const { supabaseAdmin, isLivePostgres } = require('../supabase');

function getCurrentFinancialYear(date = new Date()) {
  const month = date.getMonth(); // 0 = Jan, 2 = Mar, 3 = Apr
  const year = date.getFullYear();
  if (month >= 3) {
    // April to Dec
    return `${year}-${(year + 1).toString().slice(-2)}`;
  } else {
    // Jan to March
    return `${year - 1}-${year.toString().slice(-2)}`;
  }
}

class InvoiceRepository {
  constructor(db) {
    this.db = db;
  }

  /**
   * Idempotent Sequential Tax Invoice Issuance
   */
  async createTaxInvoice(invoicePayload) {
    const {
      jobId,
      checkoutId = null,
      merchantId,
      customerId,
      seriesOwnerType = 'MERCHANT',
      financialYear = getCurrentFinancialYear(),
      merchantLegalName,
      merchantTradeName,
      merchantGstin,
      merchantPan,
      merchantFssai,
      merchantAddress,
      merchantStateCode = '07',
      customerName,
      customerPhone,
      customerBillingAddress,
      customerGstin = null,
      customerStateCode = '07',
      isInterState = false,
      foodSubtotal = 0,
      packagingFee = 0,
      deliveryFee = 0,
      platformFee = 0,
      surgeFee = 0,
      discountAmount = 0,
      taxableAmount = 0,
      cgstAmount = 0,
      sgstAmount = 0,
      igstAmount = 0,
      totalTaxAmount = 0,
      finalTotal = 0,
      taxBreakdownJson = [],
      itemsSummaryJson = [],
      pdfUrl = null
    } = invoicePayload;

    if (!jobId || !merchantId || !customerId) {
      throw new Error('jobId, merchantId, and customerId are required for invoice issuance.');
    }

    if (isLivePostgres && supabaseAdmin) {
      // 1. Idempotency Check: Check if invoice already issued for this job
      const { data: existing } = await supabaseAdmin
        .from('tax_invoices')
        .select('*')
        .eq('job_id', jobId)
        .maybeSingle();

      if (existing) {
        return {
          invoice: existing,
          duplicate: true
        };
      }

      // 2. Generate Next Sequence Number
      let invoiceNumber = null;

      if (seriesOwnerType === 'MERCHANT') {
        let seriesPrefix = `INV-${merchantId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase()}`;
        const cleanFy = financialYear.replace(/[^0-9]/g, '').slice(-4); // e.g. 2627

        const { data: seriesRow } = await supabaseAdmin
          .from('merchant_invoice_series')
          .select('*')
          .eq('merchant_id', merchantId)
          .eq('financial_year', financialYear)
          .maybeSingle();

        let nextSeq = 1;
        if (!seriesRow) {
          const { data: newSeries, error: initErr } = await supabaseAdmin
            .from('merchant_invoice_series')
            .insert([{
              merchant_id: merchantId,
              financial_year: financialYear,
              series_prefix: seriesPrefix,
              current_sequence: 1
            }])
            .select()
            .single();

          if (!initErr && newSeries) {
            seriesPrefix = newSeries.series_prefix;
            nextSeq = 1;
          }
        } else {
          seriesPrefix = seriesRow.series_prefix;
          nextSeq = (seriesRow.current_sequence || 0) + 1;
          await supabaseAdmin
            .from('merchant_invoice_series')
            .update({ current_sequence: nextSeq, updated_at: new Date().toISOString() })
            .eq('id', seriesRow.id);
        }

        invoiceNumber = `${seriesPrefix}-${cleanFy}-${String(nextSeq).padStart(6, '0')}`;
      } else {
        // Platform Global Series
        const cleanFy = financialYear.replace(/[^0-9]/g, '').slice(-4);
        const { count } = await supabaseAdmin
          .from('tax_invoices')
          .select('id', { count: 'exact', head: true });

        const nextSeq = 1001 + (count || 0);
        invoiceNumber = `INV-NABIN-${cleanFy}-${String(nextSeq).padStart(6, '0')}`;
      }

      // 3. Insert Authoritative Tax Invoice
      const insertRow = {
        invoice_number: invoiceNumber,
        job_id: jobId,
        checkout_id: checkoutId,
        merchant_id: merchantId,
        customer_id: customerId,
        status: 'ISSUED',
        financial_year: financialYear,
        series_owner_type: seriesOwnerType,
        merchant_legal_name_snapshot: merchantLegalName || 'Restaurant Merchant',
        merchant_trade_name_snapshot: merchantTradeName || merchantLegalName || 'Restaurant Merchant',
        merchant_gstin_snapshot: merchantGstin || '07AAAAA0000A1Z5',
        merchant_pan_snapshot: merchantPan || 'AAAAA0000A',
        merchant_fssai_snapshot: merchantFssai || '10019011000000',
        merchant_address_snapshot: merchantAddress || 'Merchant Address, Delhi',
        merchant_state_code_snapshot: merchantStateCode || '07',
        customer_name_snapshot: customerName || 'Customer',
        customer_phone_snapshot: customerPhone || null,
        customer_billing_address_snapshot: customerBillingAddress || 'Delivery Locality, Delhi',
        customer_gstin_snapshot: customerGstin || null,
        customer_state_code_snapshot: customerStateCode || '07',
        is_inter_state: Boolean(isInterState),
        food_subtotal: Number(foodSubtotal),
        packaging_fee: Number(packagingFee),
        delivery_fee: Number(deliveryFee),
        platform_fee: Number(platformFee),
        surge_fee: Number(surgeFee),
        discount_amount: Number(discountAmount),
        taxable_amount: Number(taxableAmount),
        cgst_amount: Number(cgstAmount),
        sgst_amount: Number(sgstAmount),
        igst_amount: Number(igstAmount),
        total_tax_amount: Number(totalTaxAmount),
        final_total: Number(finalTotal),
        tax_breakdown_json: taxBreakdownJson,
        items_summary_json: itemsSummaryJson,
        pdf_url: pdfUrl,
        issued_at: new Date().toISOString()
      };

      const { data, error } = await supabaseAdmin
        .from('tax_invoices')
        .insert([insertRow])
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          // Unique conflict on job_id or invoice_number
          const { data: existingAfterRace } = await supabaseAdmin
            .from('tax_invoices')
            .select('*')
            .eq('job_id', jobId)
            .maybeSingle();

          if (existingAfterRace) {
            return { invoice: existingAfterRace, duplicate: true };
          }
        }
        throw new Error(`Failed to insert tax invoice: ${error.message}`);
      }

      return {
        invoice: data,
        duplicate: false
      };
    }

    // In-memory fallback
    const fallbackInvoice = {
      id: `inv_${Date.now()}`,
      invoiceNumber: `INV-${Date.now().toString().slice(-6)}`,
      jobId,
      merchantId,
      customerId,
      status: 'ISSUED',
      ...invoicePayload
    };
    return { invoice: fallbackInvoice, duplicate: false };
  }

  async getInvoiceByJobId(jobId) {
    if (isLivePostgres && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('tax_invoices')
        .select('*')
        .eq('job_id', jobId)
        .maybeSingle();

      if (!error && data) return data;
    }
    return null;
  }

  async getInvoiceById(id) {
    if (isLivePostgres && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('tax_invoices')
        .select('*')
        .or(`id.eq.${id},invoice_number.eq.${id}`)
        .maybeSingle();

      if (!error && data) return data;
    }
    return null;
  }

  async getInvoicesByMerchant(merchantId, limit = 50, offset = 0) {
    if (isLivePostgres && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('tax_invoices')
        .select('*')
        .eq('merchant_id', merchantId)
        .order('issued_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (!error && data) return data;
    }
    return [];
  }
}

module.exports = InvoiceRepository;
