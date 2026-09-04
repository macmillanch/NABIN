const { supabaseAdmin, isLivePostgres } = require('../supabase');

const LEGACY_USER_MAP = {
  'usr_1': '00000000-0000-0000-0000-000000000001',
  'usr_2': '00000000-0000-0000-0000-000000000002',
  'usr_3': '00000000-0000-0000-0000-000000000003'
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizePhone(phone) {
  if (!phone) return '';
  return phone.replace(/\s+/g, '');
}

function mapRowToUser(row, legacyId = null) {
  if (!row) return null;
  return {
    id: legacyId || row.id,
    uuid: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    dob: row.dob,
    address: row.address,
    rating: parseFloat(row.rating || 5.0),
    walletBalance: parseFloat(row.wallet_balance !== undefined ? row.wallet_balance : 0.0),
    identityStatus: row.identity_status === 'PENDING' ? 'IDENTITY_VERIFICATION_PENDING' : row.identity_status,
    accountStatus: row.account_status || 'ACTIVE',
    currentApplicationId: row.current_application_id || null,
    createdAt: row.created_at || new Date().toISOString()
  };
}

class UserRepository {
  constructor(db) {
    this.db = db;
  }

  resolveUuid(id) {
    if (!id) return null;
    if (UUID_REGEX.test(id)) return id;
    if (LEGACY_USER_MAP[id]) return LEGACY_USER_MAP[id];
    if (this.db.users) {
      const u = this.db.users.find(x => x.id === id);
      if (u && u.uuid) return u.uuid;
    }
    return null;
  }

  findById(id) {
    if (!id) return null;
    const targetUuid = this.resolveUuid(id);

    // 1. Fast cache lookup
    if (this.db.users) {
      const found = this.db.users.find(u => u.id === id || (targetUuid && (u.uuid === targetUuid || u.id === targetUuid)));
      if (found) return found;
    }
    return null;
  }

  async findByIdAsync(id) {
    if (!id) return null;
    const cached = this.findById(id);
    if (cached) return cached;

    if (isLivePostgres && supabaseAdmin) {
      const targetUuid = this.resolveUuid(id) || id;
      const { data, error } = await supabaseAdmin
        .from('users')
        .select('*')
        .eq(UUID_REGEX.test(targetUuid) ? 'id' : 'phone', targetUuid)
        .maybeSingle();

      if (!error && data) {
        const user = mapRowToUser(data, id);
        if (this.db.users) this.db.users.push(user);
        return user;
      }
    }
    return null;
  }

  findByPhone(phone) {
    if (!phone) return null;
    const clean = normalizePhone(phone);
    if (this.db.users) {
      const found = this.db.users.find(u => normalizePhone(u.phone) === clean);
      if (found) return found;
    }
    return null;
  }

  async findByPhoneAsync(phone) {
    if (!phone) return null;
    const clean = normalizePhone(phone);
    const cached = this.findByPhone(clean);
    if (cached) return cached;

    if (isLivePostgres && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('users')
        .select('*')
        .eq('phone', phone)
        .maybeSingle();

      if (!error && data) {
        const user = mapRowToUser(data);
        if (this.db.users) this.db.users.push(user);
        return user;
      }
    }
    return null;
  }

  /**
   * Authoritative User Creation in PostgreSQL
   */
  async create(userData) {
    const rawStatus = userData.identityStatus || 'PENDING';
    const dbIdentityStatus = rawStatus === 'IDENTITY_VERIFICATION_PENDING' ? 'PENDING' : rawStatus;

    const payload = {
      name: userData.name,
      phone: userData.phone,
      email: userData.email || null,
      dob: userData.dob || null,
      address: userData.address || null,
      rating: userData.rating || 5.0,
      wallet_balance: userData.walletBalance || 0.0,
      identity_status: dbIdentityStatus,
      account_status: userData.accountStatus || 'ACTIVE'
    };

    if (userData.uuid && UUID_REGEX.test(userData.uuid)) {
      payload.id = userData.uuid;
    } else if (userData.id && UUID_REGEX.test(userData.id)) {
      payload.id = userData.id;
    }

    if (isLivePostgres && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('users')
        .insert([payload])
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create user in PostgreSQL: ${error.message}`);
      }

      const createdUser = mapRowToUser(data, userData.id && !UUID_REGEX.test(userData.id) ? userData.id : null);
      if (this.db.users) {
        this.db.users.unshift(createdUser);
      }
      return createdUser;
    }

    // Fallback for non-postgres mode
    const fallbackUser = {
      id: userData.id || `usr_${Date.now().toString().slice(-5)}`,
      uuid: payload.id || null,
      ...userData,
      walletBalance: Number(userData.walletBalance || 0),
      createdAt: new Date().toISOString()
    };
    if (this.db.users) this.db.users.unshift(fallbackUser);
    return fallbackUser;
  }

  /**
   * Authoritative User Update in PostgreSQL
   */
  async update(userId, updateData) {
    let user = this.findById(userId);
    if (!user) {
      user = await this.findByIdAsync(userId);
    }
    if (!user) return null;

    const targetUuid = this.resolveUuid(userId) || (user && user.uuid) || (UUID_REGEX.test(userId) ? userId : null);
    const dbUpdates = {};
    if (updateData.name !== undefined) dbUpdates.name = updateData.name;
    if (updateData.email !== undefined) dbUpdates.email = updateData.email;
    if (updateData.phone !== undefined) dbUpdates.phone = normalizePhone(updateData.phone);
    if (updateData.address !== undefined) dbUpdates.address = updateData.address;
    if (updateData.dob !== undefined) dbUpdates.dob = updateData.dob;
    if (updateData.rating !== undefined) dbUpdates.rating = updateData.rating;

    const rawIdentity = updateData.identityStatus !== undefined ? updateData.identityStatus : updateData.identity_status;
    if (rawIdentity !== undefined) {
      dbUpdates.identity_status = rawIdentity === 'IDENTITY_VERIFICATION_PENDING' ? 'PENDING' : rawIdentity;
    }

    const rawAccount = updateData.accountStatus !== undefined ? updateData.accountStatus : updateData.account_status;
    if (rawAccount !== undefined) {
      dbUpdates.account_status = rawAccount;
    }

    dbUpdates.updated_at = new Date().toISOString();

    if (isLivePostgres && supabaseAdmin && targetUuid) {
      const { error } = await supabaseAdmin
        .from('users')
        .update(dbUpdates)
        .eq('id', targetUuid);

      if (error) {
        throw new Error(`Failed to update user in PostgreSQL: ${error.message}`);
      }
    }

    // Update in-memory cache after successful PostgreSQL persistence
    Object.assign(user, updateData);
    if (dbUpdates.identity_status) {
      user.identityStatus = dbUpdates.identity_status;
    }
    if (dbUpdates.account_status) {
      user.accountStatus = dbUpdates.account_status;
    }
    user.updatedAt = dbUpdates.updated_at;
    return user;
  }

  /**
   * Authoritative Wallet Mutation via adjust_wallet_atomic RPC
   */
  async updateWalletBalance(userId, deltaAmount, reason = '', referenceId = null) {
    const user = this.findById(userId);
    if (!user) return null;

    const ownerUuid = this.resolveUuid(userId);
    if (isLivePostgres && supabaseAdmin && ownerUuid) {
      const numAmount = Number(deltaAmount);
      const debitAccount = numAmount >= 0 ? 'PAYMENT_GATEWAY_ESCROW' : 'CUSTOMER_WALLET_LIABILITY';
      const creditAccount = numAmount >= 0 ? 'CUSTOMER_WALLET_LIABILITY' : 'PLATFORM_COMMISSION_REVENUE';

      const rpcResult = await this.db.ledgerRepo.adjustWallet({
        ownerId: ownerUuid,
        ownerType: 'CUSTOMER',
        amount: numAmount,
        category: reason.includes('REFUND') ? 'DISPUTE_REFUND' : 'WALLET_TOPUP',
        description: reason || `Customer wallet adjustment: ${numAmount}`,
        referenceId: referenceId || `usr_adj_${Date.now()}`,
        debitAccount,
        creditAccount
      });

      if (rpcResult && rpcResult.balance !== undefined) {
        user.walletBalance = Number(rpcResult.balance);
        return user;
      }
    }

    // Fallback if not postgres live
    user.walletBalance = Math.round(((user.walletBalance || 0) + deltaAmount) * 100) / 100;
    return user;
  }

  /**
   * Authoritative Identity Verification Status Update in PostgreSQL
   */
  async updateIdentityStatus(userId, status, reviewerId = 'SYSTEM') {
    const user = this.findById(userId);
    if (!user) return null;

    const targetUuid = this.resolveUuid(userId);
    const dbIdentityStatus = status === 'IDENTITY_VERIFICATION_PENDING' ? 'PENDING' : status;
    const accountStatus = status === 'VERIFIED' ? 'ACTIVE' : (status === 'REJECTED' ? 'SUSPENDED' : user.accountStatus || 'ACTIVE');

    if (isLivePostgres && supabaseAdmin && targetUuid) {
      const { error } = await supabaseAdmin
        .from('users')
        .update({
          identity_status: dbIdentityStatus,
          account_status: accountStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', targetUuid);

      if (error) {
        throw new Error(`Failed to update identity status in PostgreSQL: ${error.message}`);
      }
    }

    user.identityStatus = status;
    user.accountStatus = accountStatus;
    user.updatedAt = new Date().toISOString();
    return user;
  }
}

module.exports = UserRepository;
