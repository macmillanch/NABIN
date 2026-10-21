'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { diningApi, bookingApi } from '@/lib/api';
import { inr, toFailure } from '@/lib/format';

interface TableInfo {
  id: string;
  table_number: string;
  tableNumber?: string;
  name?: string;
  capacity?: number;
  section_name?: string;
  status: string;
}

interface MerchantInfo {
  id: string;
  name: string;
  address?: string;
  phone?: string;
}

interface MenuItem {
  id: string;
  name: string;
  description?: string;
  price: number;
  category?: string;
  isVeg?: boolean;
}

interface CartItem {
  dish: MenuItem;
  quantity: number;
}

export default function TableQrDiningPage({ params }: { params: Promise<{ token: string }> }) {
  const resolvedParams = use(params);
  const token = resolvedParams.token;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [table, setTable] = useState<TableInfo | null>(null);
  const [merchant, setMerchant] = useState<MerchantInfo | null>(null);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [cart, setCart] = useState<Record<string, CartItem>>({});
  const [submitting, setSubmitting] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState<{ orderId: string; orderNumber: string } | null>(null);

  useEffect(() => {
    async function loadTableQr() {
      try {
        setLoading(true);
        setError(null);
        const res = await diningApi.resolveTableQr(token);
        const data = res.data;
        if (data.table) {
          setTable(data.table);
          setMerchant(data.merchant);
          // Set menu from resolver or fallback demo dishes
          if (data.menu && Array.isArray(data.menu) && data.menu.length > 0) {
            setMenu(data.menu);
          } else {
            setMenu([
              { id: 'dish-1', name: 'Paneer Butter Masala', description: 'Rich cottage cheese in creamy tomato gravy', price: 320, category: 'Main Course', isVeg: true },
              { id: 'dish-2', name: 'Chicken Dum Biryani', description: 'Aromatic basmati rice layered with spiced tender chicken', price: 380, category: 'Biryani & Rice', isVeg: false },
              { id: 'dish-3', name: 'Garlic Butter Naan', description: 'Clay oven bread brushed with garlic butter', price: 60, category: 'Breads', isVeg: true },
              { id: 'dish-4', name: 'Dal Makhani Bukhara', description: 'Slow cooked black lentils with churned butter', price: 240, category: 'Main Course', isVeg: true },
              { id: 'dish-5', name: 'Tandoori Chicken Tikka', description: 'Charcoal grilled chicken skewers marinated in yogurt spices', price: 340, category: 'Starters', isVeg: false },
              { id: 'dish-6', name: 'Gulab Jamun (2 pcs)', description: 'Hot khoya dumplings in cardamom saffron syrup', price: 90, category: 'Desserts', isVeg: true },
            ]);
          }
        } else {
          setError('Table information could not be resolved from this QR token.');
        }
      } catch (err) {
        setError(toFailure(err, 'Invalid, revoked or expired table QR code. Please ask staff for assistance.').message);
      } finally {
        setLoading(false);
      }
    }

    if (token) {
      void loadTableQr();
    }
  }, [token]);

  const updateQuantity = (dish: MenuItem, delta: number) => {
    setCart((prev) => {
      const current = prev[dish.id];
      const newQty = (current?.quantity || 0) + delta;
      if (newQty <= 0) {
        const copy = { ...prev };
        delete copy[dish.id];
        return copy;
      }
      return {
        ...prev,
        [dish.id]: { dish, quantity: newQty },
      };
    });
  };

  const cartList = Object.values(cart);
  const cartSubtotal = cartList.reduce((sum, item) => sum + item.dish.price * item.quantity, 0);

  const handleSubmitOrder = async () => {
    if (!merchant || !table || cartList.length === 0) return;
    setSubmitting(true);
    try {
      const orderPayload = {
        restaurantId: merchant.id,
        orderChannel: 'DINE_IN',
        tableId: table.id,
        qrToken: token,
        items: cartList.map((item) => `${item.quantity}x ${item.dish.name}`),
      };

      const res = await bookingApi.bookFood(orderPayload);
      const data = res.data;
      const orderObj = data.job || data.order || {};
      setOrderSuccess({
        orderId: orderObj.id || 'ORDER_CONFIRMED',
        orderNumber: orderObj.order_number || orderObj.id?.substring(0, 8) || 'ORD-TABLE',
      });
      setCart({});
    } catch (err) {
      alert(toFailure(err, 'Failed to submit order to kitchen. Please inform your waiter.').message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc', fontFamily: 'sans-serif' }}>
        <div style={{ textAlign: 'center', padding: 24 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🍽️</div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1A3BA2' }}>Connecting to Table Session...</h2>
          <p style={{ color: '#64748b', fontSize: 14 }}>Resolving restaurant menu and table details.</p>
        </div>
      </main>
    );
  }

  if (error || !table || !merchant) {
    return (
      <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc', padding: 16, fontFamily: 'sans-serif' }}>
        <div style={{ maxWidth: 440, width: '100%', backgroundColor: '#fff', padding: 32, borderRadius: 16, boxShadow: '0 4px 16px rgba(0,0,0,0.08)', textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: '#b91c1c', marginBottom: 8 }}>Table QR Error</h1>
          <p style={{ color: '#475569', fontSize: 14, lineHeight: 1.5, marginBottom: 24 }}>
            {error || 'Invalid or revoked table QR code. Please request a fresh QR code from your restaurant server.'}
          </p>
          <Link href="/food" style={{ display: 'inline-block', backgroundColor: '#1A3BA2', color: '#fff', textDecoration: 'none', padding: '12px 24px', borderRadius: 8, fontWeight: 700, fontSize: 14 }}>
            Browse Delivery Restaurants
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main style={{ minHeight: '100vh', backgroundColor: '#f8fafc', paddingBottom: cartList.length > 0 ? 100 : 40, fontFamily: 'sans-serif' }}>
      {/* Sticky Header */}
      <header style={{ backgroundColor: '#fff', borderBottom: '1px solid #e2e8f0', position: 'sticky', top: 0, zIndex: 10, padding: '16px 20px' }}>
        <div style={{ maxWidth: 800, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 20 }}>🍽️</span>
              <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#1A3BA2' }}>{merchant.name}</h1>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>
              {merchant.address || 'Dining Room'}
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span style={{ backgroundColor: '#1A3BA2', color: '#fff', padding: '6px 12px', borderRadius: 20, fontSize: 13, fontWeight: 800 }}>
              Table {table.table_number || table.tableNumber}
            </span>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 800, margin: '20px auto', padding: '0 16px' }}>
        {/* NON-PAYMENT DISCLAIMER BANNER (Strict Separation) */}
        <div style={{ backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 12, padding: '14px 16px', marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 20 }}>ℹ️</span>
            <div>
              <strong style={{ display: 'block', fontSize: 14, color: '#1e40af', marginBottom: 2 }}>
                Table Ordering Active (Non-Payment QR)
              </strong>
              <p style={{ margin: 0, fontSize: 12, color: '#1e3a8a', lineHeight: 1.4 }}>
                This QR links your orders to Table {table.table_number || table.tableNumber}. It does <strong>NOT</strong> process or deduct payments. Your final bill will be presented at the counter with the restaurant&apos;s static UPI QR after dining.
              </p>
            </div>
          </div>
        </div>

        {/* Order Success Banner */}
        {orderSuccess && (
          <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: '16px 20px', marginBottom: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 28, marginBottom: 4 }}>✅</div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#15803d' }}>
              Order Transmitted to Kitchen!
            </h3>
            <p style={{ margin: '4px 0 12px', fontSize: 13, color: '#166534' }}>
              Ticket #{orderSuccess.orderNumber} is now being prepared. You can add more dishes anytime during your session.
            </p>
            <button
              onClick={() => setOrderSuccess(null)}
              style={{ backgroundColor: '#16a34a', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
            >
              Order More Items
            </button>
          </div>
        )}

        {/* Menu Section */}
        <section>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', marginBottom: 14 }}>
            Restaurant Menu
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {menu.map((dish) => {
              const qty = cart[dish.id]?.quantity || 0;
              return (
                <div
                  key={dish.id}
                  style={{
                    backgroundColor: '#fff',
                    borderRadius: 12,
                    padding: 16,
                    border: '1px solid #e2e8f0',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 16,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span style={{ fontSize: 12, padding: '2px 6px', borderRadius: 4, backgroundColor: dish.isVeg ? '#dcfce7' : '#fee2e2', color: dish.isVeg ? '#166534' : '#991b1b', fontWeight: 700 }}>
                        {dish.isVeg ? 'VEG' : 'NON-VEG'}
                      </span>
                      {dish.category && (
                        <span style={{ fontSize: 11, color: '#64748b' }}>• {dish.category}</span>
                      )}
                    </div>
                    <strong style={{ fontSize: 15, color: '#0f172a', display: 'block' }}>{dish.name}</strong>
                    {dish.description && (
                      <p style={{ margin: '4px 0 6px', fontSize: 12, color: '#64748b', lineHeight: 1.3 }}>
                        {dish.description}
                      </p>
                    )}
                    <span style={{ fontSize: 14, fontWeight: 800, color: '#1A3BA2' }}>
                      {inr(dish.price)}
                    </span>
                  </div>

                  {/* Quantity Controller */}
                  <div>
                    {qty === 0 ? (
                      <button
                        onClick={() => updateQuantity(dish, 1)}
                        style={{
                          backgroundColor: '#f1f5f9',
                          color: '#1A3BA2',
                          border: '1px solid #cbd5e1',
                          padding: '8px 18px',
                          borderRadius: 8,
                          fontWeight: 800,
                          fontSize: 13,
                          cursor: 'pointer',
                        }}
                      >
                        + ADD
                      </button>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, backgroundColor: '#eff6ff', borderRadius: 8, border: '1px solid #bfdbfe', padding: '4px 8px' }}>
                        <button
                          onClick={() => updateQuantity(dish, -1)}
                          style={{ width: 28, height: 28, borderRadius: 6, border: 'none', backgroundColor: '#fff', color: '#1A3BA2', fontWeight: 900, cursor: 'pointer' }}
                        >
                          -
                        </button>
                        <span style={{ fontWeight: 800, fontSize: 14, color: '#1A3BA2', minWidth: 20, textAlign: 'center' }}>
                          {qty}
                        </span>
                        <button
                          onClick={() => updateQuantity(dish, 1)}
                          style={{ width: 28, height: 28, borderRadius: 6, border: 'none', backgroundColor: '#1A3BA2', color: '#fff', fontWeight: 900, cursor: 'pointer' }}
                        >
                          +
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* Floating Bottom Cart Bar */}
      {cartList.length > 0 && (
        <div
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: '#fff',
            borderTop: '1px solid #e2e8f0',
            boxShadow: '0 -4px 16px rgba(0,0,0,0.08)',
            padding: '14px 20px',
            zIndex: 20,
          }}
        >
          <div style={{ maxWidth: 800, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontSize: 12, color: '#64748b', display: 'block' }}>
                {cartList.reduce((sum, i) => sum + i.quantity, 0)} items for Table {table.table_number || table.tableNumber}
              </span>
              <strong style={{ fontSize: 18, fontWeight: 900, color: '#0f172a' }}>
                {inr(cartSubtotal)}
              </strong>
            </div>
            <button
              onClick={handleSubmitOrder}
              disabled={submitting}
              style={{
                backgroundColor: '#1A3BA2',
                color: '#fff',
                border: 'none',
                padding: '12px 28px',
                borderRadius: 10,
                fontSize: 15,
                fontWeight: 800,
                cursor: 'pointer',
                opacity: submitting ? 0.7 : 1,
              }}
            >
              {submitting ? 'Transmitting to Kitchen...' : `Send Order to Kitchen`}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
