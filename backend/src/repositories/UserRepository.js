const { supabaseAdmin, isConfigured } = require('../supabase');

class UserRepository {
  constructor(db) {
    this.db = db;
  }

  findById(id) {
    return this.db.users.find(u => u.id === id) || null;
  }

  findByPhone(phone) {
    const clean = phone.replace(/\s+/g, '');
    return this.db.users.find(u => u.phone.replace(/\s+/g, '') === clean) || null;
  }

  async updateWalletBalance(userId, deltaAmount, reason = '') {
    const user = this.findById(userId);
    if (!user) return null;
    user.walletBalance = Math.round(((user.walletBalance || 0) + deltaAmount) * 100) / 100;
    this.db.save();

    if (isConfigured && supabaseAdmin) {
      try {
        await supabaseAdmin.from('users').update({
          wallet_balance: user.walletBalance,
          updated_at: new Date().toISOString()
        }).eq('phone', user.phone);
      } catch (err) {
        console.warn('⚠️ Supabase user wallet sync notice:', err.message);
      }
    }
    return user;
  }

  async updateIdentityStatus(userId, status, reviewerId = 'SYSTEM') {
    const user = this.findById(userId);
    if (!user) return null;
    user.identityStatus = status;
    user.accountStatus = status === 'VERIFIED' ? 'ACTIVE' : status;
    this.db.save();

    if (isConfigured && supabaseAdmin) {
      try {
        await supabaseAdmin.from('users').update({
          identity_status: status,
          account_status: user.accountStatus,
          updated_at: new Date().toISOString()
        }).eq('phone', user.phone);
      } catch (err) {
        console.warn('⚠️ Supabase user identity sync notice:', err.message);
      }
    }
    return user;
  }
}

module.exports = UserRepository;
