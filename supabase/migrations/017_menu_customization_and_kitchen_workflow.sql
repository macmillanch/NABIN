-- =========================================================================
-- NABIN PLATFORM — MIGRATION 017: MENU CUSTOMIZATION, KITCHEN WORKFLOW & TAX INVOICING
-- =========================================================================
-- Architecture:
-- 1. Menu Modifier Groups & Options (Multi-Tenant, Scoped RLS, Composite Integrity)
-- 2. Products table composite uniqueness (merchant_id, id)
-- 3. Product-Modifier Group Associations (Dual Composite FKs for Cross-Tenant Isolation)
-- 4. Dynamic Tax Configurations by Charge Component (Deterministic Resolution)
-- 5. Per-Merchant Invoice Series Tracking & Global Sequence
-- 6. Atomic Concurrency-Safe Invoice Generation Function
-- 7. Historical Order Items & Modifier Snapshots (ON DELETE RESTRICT)
-- 8. Authoritative Tax Invoices (ON DELETE RESTRICT, Legal Snapshots, Trigger Immutability)
-- =========================================================================

-- 1. MENU MODIFIER GROUPS
CREATE TABLE IF NOT EXISTS menu_modifier_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
    name VARCHAR(150) NOT NULL,
    selection_type VARCHAR(20) NOT NULL CHECK (selection_type IN ('SINGLE', 'MULTIPLE')),
    min_selections INTEGER NOT NULL DEFAULT 0 CHECK (min_selections >= 0),
    max_selections INTEGER NOT NULL DEFAULT 1 CHECK (max_selections >= 1 AND max_selections >= min_selections),
    is_required BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_required_min_selections CHECK (is_required = false OR min_selections >= 1),
    CONSTRAINT uq_modifier_group_merchant UNIQUE (merchant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_modifier_groups_merchant_status 
    ON menu_modifier_groups(merchant_id, status);

-- 2. MENU MODIFIER OPTIONS
CREATE TABLE IF NOT EXISTS menu_modifier_options (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    modifier_group_id UUID NOT NULL,
    merchant_id UUID NOT NULL,
    name VARCHAR(150) NOT NULL,
    price_delta NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (price_delta >= 0.00),
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT fk_modifier_option_group_merchant 
        FOREIGN KEY (merchant_id, modifier_group_id) 
        REFERENCES menu_modifier_groups(merchant_id, id) ON DELETE RESTRICT,
    CONSTRAINT uq_modifier_option_merchant UNIQUE (merchant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_modifier_options_group 
    ON menu_modifier_options(modifier_group_id, status);
CREATE INDEX IF NOT EXISTS idx_modifier_options_merchant 
    ON menu_modifier_options(merchant_id, status);

-- 3. COMPOSITE INTEGRITY ON PRODUCTS
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_product_merchant'
    ) THEN
        ALTER TABLE products ADD CONSTRAINT uq_product_merchant UNIQUE (merchant_id, id);
    END IF;
END $$;

-- 4. MENU ITEM MODIFIERS (Product-Modifier Association with Dual Composite FKs)
CREATE TABLE IF NOT EXISTS menu_item_modifiers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL,
    product_id UUID NOT NULL,
    modifier_group_id UUID NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT fk_item_modifier_product_merchant 
        FOREIGN KEY (merchant_id, product_id) 
        REFERENCES products(merchant_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_item_modifier_group_merchant 
        FOREIGN KEY (merchant_id, modifier_group_id) 
        REFERENCES menu_modifier_groups(merchant_id, id) ON DELETE RESTRICT,
    CONSTRAINT uq_item_modifier_binding UNIQUE (product_id, modifier_group_id)
);

CREATE INDEX IF NOT EXISTS idx_menu_item_modifiers_product 
    ON menu_item_modifiers(product_id, is_active);
CREATE INDEX IF NOT EXISTS idx_menu_item_modifiers_group 
    ON menu_item_modifiers(modifier_group_id);

-- 5. DYNAMIC TAX CONFIGURATIONS BY CHARGE COMPONENT
CREATE TABLE IF NOT EXISTS tax_configurations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_type VARCHAR(30) NOT NULL CHECK (service_type IN ('RIDE', 'FOOD', 'PARCEL', 'GROCERY', 'ALL')),
    charge_component VARCHAR(40) NOT NULL 
        CHECK (charge_component IN ('FOOD_ITEM', 'PACKAGING_FEE', 'DELIVERY_FEE', 'PLATFORM_FEE', 'SURGE_FEE', 'OTHER')),
    category_code VARCHAR(50) NOT NULL DEFAULT 'DEFAULT',
    hsn_sac_code VARCHAR(20) NOT NULL,
    tax_rate_percent NUMERIC(5, 2) NOT NULL CHECK (tax_rate_percent >= 0.00 AND tax_rate_percent <= 100.00),
    is_inter_state_split BOOLEAN NOT NULL DEFAULT TRUE,
    pricing_mode VARCHAR(20) NOT NULL DEFAULT 'EXCLUSIVE' CHECK (pricing_mode IN ('INCLUSIVE', 'EXCLUSIVE')),
    priority INTEGER NOT NULL DEFAULT 100,
    effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    effective_to TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_tax_config_effective_range CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tax_configs_active_uniq 
    ON tax_configurations (service_type, charge_component, category_code) 
    WHERE (is_active = true AND effective_to IS NULL);

CREATE INDEX IF NOT EXISTS idx_tax_configs_lookup 
    ON tax_configurations (service_type, charge_component, category_code, priority DESC);

-- 6. MERCHANT INVOICE SERIES TRACKING & GLOBAL SEQUENCE
CREATE SEQUENCE IF NOT EXISTS tax_invoice_seq START WITH 1001 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS merchant_invoice_series (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
    financial_year VARCHAR(10) NOT NULL,
    series_prefix VARCHAR(30) NOT NULL,
    current_sequence INTEGER NOT NULL DEFAULT 0 CHECK (current_sequence >= 0),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_merchant_invoice_series_fy UNIQUE (merchant_id, financial_year)
);

CREATE INDEX IF NOT EXISTS idx_invoice_series_merchant_fy 
    ON merchant_invoice_series(merchant_id, financial_year);

-- 7. ATOMIC CONCURRENCY-SAFE INVOICE NUMBER GENERATION FUNCTION
CREATE OR REPLACE FUNCTION fn_generate_invoice_number(
    p_merchant_id UUID,
    p_financial_year VARCHAR(10) DEFAULT NULL
) RETURNS VARCHAR(100)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
    v_fy VARCHAR(10);
    v_series merchant_invoice_series%ROWTYPE;
    v_next_seq INTEGER;
    v_prefix VARCHAR(30);
    v_clean_fy VARCHAR(10);
    v_formatted_num VARCHAR(100);
BEGIN
    IF p_financial_year IS NOT NULL AND p_financial_year <> '' THEN
        v_fy := p_financial_year;
    ELSE
        IF EXTRACT(MONTH FROM NOW()) >= 4 THEN
            v_fy := EXTRACT(YEAR FROM NOW())::TEXT || '-' || SUBSTRING((EXTRACT(YEAR FROM NOW()) + 1)::TEXT FROM 3 FOR 2);
        ELSE
            v_fy := (EXTRACT(YEAR FROM NOW()) - 1)::TEXT || '-' || SUBSTRING(EXTRACT(YEAR FROM NOW())::TEXT FROM 3 FOR 2);
        END IF;
    END IF;

    v_clean_fy := REPLACE(v_fy, '-', '');

    SELECT * INTO v_series 
      FROM merchant_invoice_series 
     WHERE merchant_id = p_merchant_id AND financial_year = v_fy 
       FOR UPDATE;

    IF NOT FOUND THEN
        v_prefix := 'MCHT-' || UPPER(SUBSTRING(p_merchant_id::TEXT FROM 1 FOR 4));
        INSERT INTO merchant_invoice_series (merchant_id, financial_year, series_prefix, current_sequence)
        VALUES (p_merchant_id, v_fy, v_prefix, 1)
        RETURNING * INTO v_series;
        v_next_seq := 1;
    ELSE
        v_next_seq := v_series.current_sequence + 1;
        UPDATE merchant_invoice_series 
           SET current_sequence = v_next_seq, updated_at = NOW()
         WHERE id = v_series.id;
    END IF;

    v_formatted_num := 'NABIN/' || v_series.series_prefix || '/' || v_clean_fy || '/' || LPAD(v_next_seq::TEXT, 5, '0');
    RETURN v_formatted_num;
END;
$$;

-- 8. HISTORICAL ORDER LINE ITEMS & MODIFIER SNAPSHOTS
CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
    item_name_snapshot VARCHAR(200) NOT NULL,
    item_sku_snapshot VARCHAR(100),
    category_snapshot VARCHAR(100),
    base_unit_price NUMERIC(10, 2) NOT NULL CHECK (base_unit_price >= 0.00),
    quantity INTEGER NOT NULL CHECK (quantity >= 1),
    item_subtotal NUMERIC(10, 2) NOT NULL CHECK (item_subtotal >= 0.00),
    modifiers_subtotal NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (modifiers_subtotal >= 0.00),
    total_item_amount NUMERIC(10, 2) NOT NULL CHECK (total_item_amount >= 0.00),
    tax_rate_snapshot NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    tax_amount_snapshot NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    hsn_sac_snapshot VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_order_item_total CHECK (total_item_amount = item_subtotal + modifiers_subtotal)
);

CREATE INDEX IF NOT EXISTS idx_order_items_job_id ON order_items(job_id);
CREATE INDEX IF NOT EXISTS idx_order_items_merchant ON order_items(merchant_id);

CREATE TABLE IF NOT EXISTS order_item_modifiers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
    modifier_option_id UUID REFERENCES menu_modifier_options(id) ON DELETE SET NULL,
    group_name_snapshot VARCHAR(150) NOT NULL,
    option_name_snapshot VARCHAR(150) NOT NULL,
    price_delta_snapshot NUMERIC(10, 2) NOT NULL CHECK (price_delta_snapshot >= 0.00),
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_item_modifiers_item ON order_item_modifiers(order_item_id);

-- 9. AUTHORITATIVE TAX INVOICES TABLE
CREATE TABLE IF NOT EXISTS tax_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number VARCHAR(100) UNIQUE NOT NULL,
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
    checkout_id UUID REFERENCES checkouts(id) ON DELETE RESTRICT,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status VARCHAR(30) NOT NULL DEFAULT 'ISSUED' 
        CHECK (status IN ('DRAFT', 'ISSUED', 'CANCELLED_WITH_CREDIT_NOTE')),
    financial_year VARCHAR(10) NOT NULL,
    series_owner_type VARCHAR(20) NOT NULL DEFAULT 'MERCHANT' 
        CHECK (series_owner_type IN ('PLATFORM', 'MERCHANT')),
    
    -- Merchant Legal Identity Snapshot
    merchant_legal_name_snapshot VARCHAR(200) NOT NULL,
    merchant_trade_name_snapshot VARCHAR(200),
    merchant_gstin_snapshot VARCHAR(20),
    merchant_pan_snapshot VARCHAR(20),
    merchant_fssai_snapshot VARCHAR(50),
    merchant_address_snapshot TEXT NOT NULL,
    merchant_state_code_snapshot VARCHAR(10) NOT NULL,

    -- Customer Legal Identity Snapshot
    customer_name_snapshot VARCHAR(150) NOT NULL,
    customer_phone_snapshot VARCHAR(20),
    customer_billing_address_snapshot TEXT NOT NULL,
    customer_gstin_snapshot VARCHAR(20),
    customer_state_code_snapshot VARCHAR(10) NOT NULL,

    -- Financial Breakdown
    is_inter_state BOOLEAN NOT NULL DEFAULT FALSE,
    food_subtotal NUMERIC(12, 2) NOT NULL CHECK (food_subtotal >= 0.00),
    packaging_fee NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (packaging_fee >= 0.00),
    delivery_fee NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (delivery_fee >= 0.00),
    platform_fee NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (platform_fee >= 0.00),
    surge_fee NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (surge_fee >= 0.00),
    discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (discount_amount >= 0.00),
    taxable_amount NUMERIC(12, 2) NOT NULL CHECK (taxable_amount >= 0.00),
    cgst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (cgst_amount >= 0.00),
    sgst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (sgst_amount >= 0.00),
    igst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (igst_amount >= 0.00),
    total_tax_amount NUMERIC(12, 2) NOT NULL CHECK (total_tax_amount >= 0.00),
    final_total NUMERIC(12, 2) NOT NULL CHECK (final_total >= 0.00),
    
    tax_breakdown_json JSONB NOT NULL DEFAULT '[]',
    items_summary_json JSONB NOT NULL DEFAULT '[]',
    pdf_url TEXT,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT uq_tax_invoice_job UNIQUE (job_id),
    CONSTRAINT chk_tax_invoice_total_tax CHECK (total_tax_amount = cgst_amount + sgst_amount + igst_amount)
);

CREATE INDEX IF NOT EXISTS idx_tax_invoices_job_id ON tax_invoices(job_id);
CREATE INDEX IF NOT EXISTS idx_tax_invoices_merchant ON tax_invoices(merchant_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_tax_invoices_customer ON tax_invoices(customer_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_tax_invoices_number ON tax_invoices(invoice_number);

-- 10. IMMUTABILITY TRIGGER ON TAX INVOICES
CREATE OR REPLACE FUNCTION fn_tax_invoices_immutable()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status = 'ISSUED' THEN
        IF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION 'Database security violation: Issued tax invoice % cannot be deleted.', OLD.invoice_number
                USING ERRCODE = '23001';
        END IF;

        IF (NEW.invoice_number <> OLD.invoice_number OR
            NEW.job_id <> OLD.job_id OR
            NEW.merchant_id <> OLD.merchant_id OR
            NEW.customer_id <> OLD.customer_id OR
            NEW.taxable_amount <> OLD.taxable_amount OR
            NEW.total_tax_amount <> OLD.total_tax_amount OR
            NEW.final_total <> OLD.final_total OR
            NEW.cgst_amount <> OLD.cgst_amount OR
            NEW.sgst_amount <> OLD.sgst_amount OR
            NEW.igst_amount <> OLD.igst_amount OR
            NEW.merchant_gstin_snapshot <> OLD.merchant_gstin_snapshot OR
            NEW.issued_at <> OLD.issued_at) THEN
            RAISE EXCEPTION 'Database security violation: Issued tax invoice % is immutable.', OLD.invoice_number
                USING ERRCODE = '23001';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tax_invoices_immutable ON tax_invoices;
CREATE TRIGGER trg_tax_invoices_immutable
    BEFORE UPDATE OR DELETE ON tax_invoices
    FOR EACH ROW
    EXECUTE FUNCTION fn_tax_invoices_immutable();

-- 11. INITIAL SEED FOR DYNAMIC TAX CONFIGURATIONS (Business Policy Data)
INSERT INTO tax_configurations (service_type, charge_component, category_code, hsn_sac_code, tax_rate_percent, is_inter_state_split, pricing_mode, priority)
VALUES 
    ('FOOD', 'FOOD_ITEM', 'DEFAULT', '996331', 5.00, true, 'EXCLUSIVE', 100),
    ('FOOD', 'PACKAGING_FEE', 'DEFAULT', '996331', 18.00, true, 'EXCLUSIVE', 100),
    ('FOOD', 'DELIVERY_FEE', 'DEFAULT', '996813', 18.00, true, 'EXCLUSIVE', 100),
    ('FOOD', 'PLATFORM_FEE', 'DEFAULT', '998314', 18.00, true, 'EXCLUSIVE', 100),
    ('FOOD', 'SURGE_FEE', 'DEFAULT', '996813', 18.00, true, 'EXCLUSIVE', 100)
ON CONFLICT (service_type, charge_component, category_code) 
WHERE (is_active = true AND effective_to IS NULL)
DO UPDATE SET 
    hsn_sac_code = EXCLUDED.hsn_sac_code,
    tax_rate_percent = EXCLUDED.tax_rate_percent,
    updated_at = NOW();

-- 12. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE menu_modifier_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_modifier_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_item_modifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_invoice_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_item_modifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_invoices ENABLE ROW LEVEL SECURITY;

-- Modifier Groups Policies
CREATE POLICY "Public read active modifier groups" 
    ON menu_modifier_groups FOR SELECT 
    TO anon, authenticated 
    USING (status = 'ACTIVE');

CREATE POLICY "Merchants manage own modifier groups" 
    ON menu_modifier_groups FOR ALL 
    TO authenticated 
    USING (auth.uid() = merchant_id);

CREATE POLICY "Admins full access modifier groups" 
    ON menu_modifier_groups FOR ALL 
    TO authenticated 
    USING ((auth.jwt() ->> 'role') IN ('SUPER_ADMIN', 'service_role'));

-- Modifier Options Policies
CREATE POLICY "Public read available modifier options" 
    ON menu_modifier_options FOR SELECT 
    TO anon, authenticated 
    USING (status = 'ACTIVE' AND is_available = true);

CREATE POLICY "Merchants manage own modifier options" 
    ON menu_modifier_options FOR ALL 
    TO authenticated 
    USING (auth.uid() = merchant_id);

CREATE POLICY "Admins full access modifier options" 
    ON menu_modifier_options FOR ALL 
    TO authenticated 
    USING ((auth.jwt() ->> 'role') IN ('SUPER_ADMIN', 'service_role'));

-- Menu Item Modifiers Policies
CREATE POLICY "Public read active product modifier bindings" 
    ON menu_item_modifiers FOR SELECT 
    TO anon, authenticated 
    USING (is_active = true);

CREATE POLICY "Merchants manage own item modifiers" 
    ON menu_item_modifiers FOR ALL 
    TO authenticated 
    USING (auth.uid() = merchant_id);

CREATE POLICY "Admins full access item modifiers" 
    ON menu_item_modifiers FOR ALL 
    TO authenticated 
    USING ((auth.jwt() ->> 'role') IN ('SUPER_ADMIN', 'service_role'));

-- Tax Configurations Policies
CREATE POLICY "Public read active tax configs" 
    ON tax_configurations FOR SELECT 
    TO anon, authenticated 
    USING (is_active = true);

CREATE POLICY "Admins full access tax configs" 
    ON tax_configurations FOR ALL 
    TO authenticated 
    USING ((auth.jwt() ->> 'role') IN ('SUPER_ADMIN', 'FINANCE_AUDITOR', 'service_role'));

-- Merchant Invoice Series Policies
CREATE POLICY "Merchants manage own invoice series" 
    ON merchant_invoice_series FOR ALL 
    TO authenticated 
    USING (auth.uid() = merchant_id);

CREATE POLICY "Admins full access invoice series" 
    ON merchant_invoice_series FOR ALL 
    TO authenticated 
    USING ((auth.jwt() ->> 'role') IN ('SUPER_ADMIN', 'FINANCE_AUDITOR', 'service_role'));

-- Order Items Policies
CREATE POLICY "Customers view own order items" 
    ON order_items FOR SELECT 
    TO authenticated 
    USING (EXISTS (SELECT 1 FROM jobs j WHERE j.id = order_items.job_id AND j.customer_id = auth.uid()));

CREATE POLICY "Admins full access order items" 
    ON order_items FOR ALL 
    TO authenticated 
    USING ((auth.jwt() ->> 'role') IN ('SUPER_ADMIN', 'OPERATIONS', 'FINANCE_AUDITOR', 'service_role'));

-- Order Item Modifiers Policies
CREATE POLICY "Customers view own modifier snapshots" 
    ON order_item_modifiers FOR SELECT 
    TO authenticated 
    USING (EXISTS (
        SELECT 1 FROM order_items oi 
        JOIN jobs j ON j.id = oi.job_id 
        WHERE oi.id = order_item_modifiers.order_item_id AND j.customer_id = auth.uid()
    ));

CREATE POLICY "Admins full access item modifier snapshots" 
    ON order_item_modifiers FOR ALL 
    TO authenticated 
    USING ((auth.jwt() ->> 'role') IN ('SUPER_ADMIN', 'OPERATIONS', 'FINANCE_AUDITOR', 'service_role'));

-- Tax Invoices Policies
CREATE POLICY "Customers view own invoices" 
    ON tax_invoices FOR SELECT 
    TO authenticated 
    USING (auth.uid() = customer_id);

CREATE POLICY "Merchants view own invoices" 
    ON tax_invoices FOR SELECT 
    TO authenticated 
    USING (auth.uid() = merchant_id);

CREATE POLICY "Admins full access tax invoices" 
    ON tax_invoices FOR ALL 
    TO authenticated 
    USING ((auth.jwt() ->> 'role') IN ('SUPER_ADMIN', 'FINANCE_AUDITOR', 'service_role'));
