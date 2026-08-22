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

  updateWalletBalance(userId, deltaAmount, reason = '') {
    const user = this.findById(userId);
    if (!user) return null;
    user.walletBalance = Math.round(((user.walletBalance || 0) + deltaAmount) * 100) / 100;
    this.db.save();
    return user;
  }

  updateIdentityStatus(userId, status, reviewerId = 'SYSTEM') {
    const user = this.findById(userId);
    if (!user) return null;
    user.identityStatus = status;
    user.accountStatus = status === 'VERIFIED' ? 'ACTIVE' : status;
    this.db.save();
    return user;
  }
}

module.exports = UserRepository;
