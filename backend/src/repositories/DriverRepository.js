const { supabaseAdmin, isConfigured } = require('../supabase');

class DriverRepository {
  constructor(db) {
    this.db = db;
  }

  findById(id) {
    return this.db.drivers.find(d => d.id === id) || null;
  }

  findByPhone(phone) {
    const clean = phone.replace(/\s+/g, '');
    return this.db.drivers.find(d => d.phone.replace(/\s+/g, '') === clean) || null;
  }

  async updateEarnings(driverId, earningAmount, tripId = null) {
    const driver = this.findById(driverId);
    if (!driver) return null;
    driver.walletBalance = Math.round(((driver.walletBalance || 0) + earningAmount) * 100) / 100;
    driver.todayEarnings = Math.round(((driver.todayEarnings || 0) + earningAmount) * 100) / 100;
    this.db.save();

    if (isConfigured && supabaseAdmin) {
      try {
        await supabaseAdmin.from('drivers').update({
          wallet_balance: driver.walletBalance
        }).eq('phone', driver.phone);
      } catch (err) {
        console.warn('⚠️ Supabase driver earnings sync notice:', err.message);
      }
    }
    return driver;
  }

  async setOnlineStatus(driverId, isOnline) {
    const driver = this.findById(driverId);
    if (!driver) return null;
    driver.isOnline = Boolean(isOnline);
    this.db.save();

    if (isConfigured && supabaseAdmin) {
      try {
        await supabaseAdmin.from('drivers').update({
          is_online: Boolean(isOnline)
        }).eq('phone', driver.phone);
      } catch (err) {
        console.warn('⚠️ Supabase driver online sync notice:', err.message);
      }
    }
    return driver;
  }

  getOnlineFleet(serviceType = null) {
    return this.db.drivers.filter(d => d.isOnline && (!serviceType || d.serviceType === serviceType || d.vehicleType === serviceType));
  }
}

module.exports = DriverRepository;
