const { supabaseAdmin, isLivePostgres } = require('../supabase');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LEGACY_APP_MAP = {
  'APP-9021': '00000000-0000-0000-0000-000000009021',
  'APP-9019': '00000000-0000-0000-0000-000000009019',
  'APP-9018': '00000000-0000-0000-0000-000000009018'
};

const REVERSE_LEGACY_APP_MAP = {
  '00000000-0000-0000-0000-000000009021': 'APP-9021',
  '00000000-0000-0000-0000-000000009019': 'APP-9019',
  '00000000-0000-0000-0000-000000009018': 'APP-9018'
};

const LEGACY_USER_MAP = {
  'usr_1': '00000000-0000-0000-0000-000000000001',
  'usr_2': '00000000-0000-0000-0000-000000000002',
  'usr_3': '00000000-0000-0000-0000-000000000003'
};

const REVERSE_LEGACY_USER_MAP = {
  '00000000-0000-0000-0000-000000000001': 'usr_1',
  '00000000-0000-0000-0000-000000000002': 'usr_2',
  '00000000-0000-0000-0000-000000000003': 'usr_3'
};

function maskAadhaar(num) {
  if (!num) return 'XXXX-XXXX-XXXX';
  const clean = num.toString().replace(/\D/g, '');
  if (clean.length < 4) return 'XXXX-XXXX-XXXX';
  const last4 = clean.slice(-4);
  return `XXXX-XXXX-${last4}`;
}

function maskVoterId(id) {
  if (!id) return 'XXX***XXX';
  const clean = id.toString().trim().toUpperCase();
  if (clean.length < 6) return 'XXX***XXX';
  const prefix = clean.slice(0, 3);
  const suffix = clean.slice(-3);
  return `${prefix}***${suffix}`;
}

function mapRowToDTO(row, user = null) {
  if (!row) return null;
  const legacyId = REVERSE_LEGACY_APP_MAP[row.id] || row.id;
  const userId = user ? user.id : (REVERSE_LEGACY_USER_MAP[row.user_id] || row.user_id);
  const status = row.review_status === 'SUBMITTED' ? 'IDENTITY_VERIFICATION_PENDING' : row.review_status;

  return {
    id: legacyId,
    uuid: row.id,
    userId,
    userUuid: row.user_id,
    userName: user ? user.name : 'Unknown User',
    phone: user ? user.phone : '',
    email: user ? user.email : '',
    dob: user ? user.dob : '',
    address: user ? user.address : '',
    aadhaarNumberRaw: row.aadhaar_number_raw,
    aadhaarNumberMasked: row.aadhaar_number_masked || maskAadhaar(row.aadhaar_number_raw),
    aadhaarDocUrl: row.aadhaar_doc_url,
    aadhaarDocStatus: row.review_status,
    voterIdNumberRaw: row.voter_id_number_raw,
    voterIdNumberMasked: row.voter_id_number_masked || maskVoterId(row.voter_id_number_raw),
    voterIdDocUrl: row.voter_id_doc_url,
    voterIdDocStatus: row.review_status,
    status,
    overallDocumentStatus: row.review_status,
    assignedReviewerId: row.reviewed_by_admin_id || null,
    assignedReviewerName: row.reviewed_by_admin_id ? 'NABIN Compliance Officer' : null,
    lockedByAdminId: null,
    lockedByAdminName: null,
    lockedAt: null,
    reviewNotes: row.rejection_reason || row.resubmission_reason || (status === 'VERIFIED' ? 'Manual verification completed. Account identity verified and activated.' : ''),
    rejectionReason: row.rejection_reason || '',
    resubmissionReason: row.resubmission_reason || '',
    priority: 'NORMAL',
    submissionDate: row.submitted_at || new Date().toISOString(),
    updatedAt: row.verified_at || row.submitted_at || new Date().toISOString()
  };
}

class IdentityRepository {
  constructor(db) {
    this.db = db;
  }

  resolveUserUuid(id) {
    if (!id) return null;
    if (UUID_REGEX.test(id)) return id;
    if (LEGACY_USER_MAP[id]) return LEGACY_USER_MAP[id];
    if (this.db && this.db.userRepo) {
      return this.db.userRepo.resolveUuid(id);
    }
    return null;
  }

  resolveAppUuid(id) {
    if (!id) return null;
    if (UUID_REGEX.test(id)) return id;
    if (LEGACY_APP_MAP[id]) return LEGACY_APP_MAP[id];
    const found = this.db.identityApplications ? this.db.identityApplications.find(a => a.id === id) : null;
    if (found && found.uuid) return found.uuid;
    return null;
  }

  getUser(userId) {
    if (!userId) return null;
    if (this.db.getUser) return this.db.getUser(userId);
    if (this.db.userRepo) return this.db.userRepo.findById(userId);
    return null;
  }

  mapRowToDTO(row, user = null) {
    const resolvedUser = user || this.getUser(REVERSE_LEGACY_USER_MAP[row.user_id] || row.user_id);
    return mapRowToDTO(row, resolvedUser);
  }

  /**
   * Hydrate in-memory identityApplications from PostgreSQL public.identity_documents
   */
  async hydrateAll() {
    if (!isLivePostgres || !supabaseAdmin) return [];

    try {
      const { data, error } = await supabaseAdmin
        .from('identity_documents')
        .select('*')
        .order('submitted_at', { ascending: false });

      if (error) {
        console.warn('⚠️ [IdentityRepository] hydrateAll error:', error.message);
        return [];
      }

      if (data && data.length > 0) {
        const dtos = data.map(row => {
          const user = this.getUser(REVERSE_LEGACY_USER_MAP[row.user_id] || row.user_id);
          return mapRowToDTO(row, user);
        });

        // Merge into db.identityApplications
        for (const dto of dtos) {
          const idx = this.db.identityApplications.findIndex(a => a.id === dto.id || a.uuid === dto.uuid);
          if (idx !== -1) {
            this.db.identityApplications[idx] = { ...this.db.identityApplications[idx], ...dto };
          } else {
            this.db.identityApplications.push(dto);
          }
        }
        return dtos;
      }
    } catch (err) {
      console.warn('⚠️ [IdentityRepository] hydrateAll exception:', err.message);
    }
    return [];
  }

  /**
   * Create or update identity application in PostgreSQL and memory
   */
  async submitApplication(payload) {
    const {
      userId,
      name,
      phone,
      email,
      dob,
      address,
      aadhaarNumber,
      aadhaarDocUrl,
      voterIdNumber,
      voterIdDocUrl,
      isResubmission
    } = payload;

    const user = this.getUser(userId);
    const userUuid = this.resolveUserUuid(userId) || (user && user.uuid);
    if (!userUuid) {
      throw new Error(`Unable to resolve user UUID for user [${userId}]`);
    }

    const maskedAadhaar = maskAadhaar(aadhaarNumber);
    const maskedVoter = maskVoterId(voterIdNumber);
    const rawAadhaar = aadhaarNumber ? String(aadhaarNumber).trim() : null;
    const rawVoter = voterIdNumber ? String(voterIdNumber).trim().toUpperCase() : null;

    // Check if user already has an existing application
    const existingIndex = this.db.identityApplications.findIndex(a => a.userId === userId || a.userUuid === userUuid);
    const existingApp = existingIndex !== -1 ? this.db.identityApplications[existingIndex] : null;

    const targetAppId = (existingApp && existingApp.id) || (user && user.currentApplicationId) || `APP-${Math.floor(1000 + Math.random() * 9000)}`;
    const targetUuid = this.resolveAppUuid(targetAppId) || (existingApp ? existingApp.uuid : null);

    let createdOrUpdatedRow = null;

    if (isLivePostgres && supabaseAdmin) {
      let existingRow = null;
      if (targetUuid) {
        try {
          const { data: foundRow } = await supabaseAdmin
            .from('identity_documents')
            .select('id')
            .eq('id', targetUuid)
            .maybeSingle();
          existingRow = foundRow;
        } catch (fErr) {
          console.warn('⚠️ [IdentityRepository] Check existing row error:', fErr.message);
        }
      }

      if (existingRow && targetUuid) {
        // Update existing row
        const { data, error } = await supabaseAdmin
          .from('identity_documents')
          .update({
            aadhaar_number_raw: rawAadhaar || (existingApp && existingApp.aadhaarNumberRaw),
            aadhaar_number_masked: maskedAadhaar,
            aadhaar_doc_url: aadhaarDocUrl || (existingApp && existingApp.aadhaarDocUrl),
            voter_id_number_raw: rawVoter || (existingApp && existingApp.voterIdNumberRaw),
            voter_id_number_masked: maskedVoter,
            voter_id_doc_url: voterIdDocUrl || (existingApp && existingApp.voterIdDocUrl),
            review_status: 'SUBMITTED',
            rejection_reason: null,
            resubmission_reason: null,
            submitted_at: new Date().toISOString()
          })
          .eq('id', targetUuid)
          .select()
          .single();

        if (error) {
          throw new Error(`Failed to update identity document in PostgreSQL: ${error.message}`);
        }
        createdOrUpdatedRow = data;
      } else {
        // Insert new row
        const rowToInsert = {
          user_id: userUuid,
          aadhaar_number_raw: rawAadhaar,
          aadhaar_number_masked: maskedAadhaar,
          aadhaar_doc_url: aadhaarDocUrl || '/docs/mock_aadhaar_user.png',
          voter_id_number_raw: rawVoter,
          voter_id_number_masked: maskedVoter,
          voter_id_doc_url: voterIdDocUrl || '/docs/mock_voter_user.png',
          review_status: 'SUBMITTED',
          submitted_at: new Date().toISOString()
        };
        if (targetUuid) {
          rowToInsert.id = targetUuid;
        }

        const { data, error } = await supabaseAdmin
          .from('identity_documents')
          .insert(rowToInsert)
          .select()
          .single();

        if (error) {
          throw new Error(`Failed to insert identity document into PostgreSQL: ${error.message}`);
        }
        createdOrUpdatedRow = data;
      }
    }

    const appDto = createdOrUpdatedRow
      ? mapRowToDTO(createdOrUpdatedRow, user)
      : {
          id: targetAppId,
          uuid: targetUuid || `00000000-0000-0000-0000-00000000${targetAppId.replace(/\D/g, '')}`,
          userId,
          userUuid,
          userName: (user && user.name) || name || 'New User',
          phone: (user && user.phone) || phone || '',
          email: (user && user.email) || email || '',
          dob: (user && user.dob) || dob || '',
          address: (user && user.address) || address || '',
          aadhaarNumberRaw: rawAadhaar,
          aadhaarNumberMasked: maskedAadhaar,
          aadhaarDocUrl: aadhaarDocUrl || '/docs/mock_aadhaar_user.png',
          aadhaarDocStatus: 'SUBMITTED',
          voterIdNumberRaw: rawVoter,
          voterIdNumberMasked: maskedVoter,
          voterIdDocUrl: voterIdDocUrl || '/docs/mock_voter_user.png',
          voterIdDocStatus: 'SUBMITTED',
          status: 'IDENTITY_VERIFICATION_PENDING',
          overallDocumentStatus: 'SUBMITTED',
          assignedReviewerId: null,
          assignedReviewerName: null,
          lockedByAdminId: null,
          lockedByAdminName: null,
          lockedAt: null,
          reviewNotes: '',
          rejectionReason: '',
          resubmissionReason: '',
          priority: 'NORMAL',
          submissionDate: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

    // Update in-memory database cache
    if (existingIndex !== -1) {
      this.db.identityApplications[existingIndex] = { ...this.db.identityApplications[existingIndex], ...appDto };
    } else {
      this.db.identityApplications.unshift(appDto);
    }

    // Update user's currentApplicationId & identity_status
    if (user) {
      user.currentApplicationId = appDto.id;
      user.identityStatus = 'IDENTITY_VERIFICATION_PENDING';
      user.accountStatus = 'IDENTITY_VERIFICATION_PENDING';
    }

    // Persist user identity_status to PostgreSQL
    if (this.db.userRepo && typeof this.db.userRepo.updateIdentityStatus === 'function') {
      try {
        await this.db.userRepo.updateIdentityStatus(userUuid, 'PENDING', 'SYSTEM');
      } catch (uErr) {
        console.warn('⚠️ [IdentityRepository] updateUser error:', uErr.message);
      }
    }

    return { application: appDto, user };
  }

  /**
   * Update identity verification review status in PostgreSQL and memory
   */
  async reviewApplication(id, decision, reason, checklist, adminId, adminName) {
    const app = this.findById(id);
    if (!app) {
      return { success: false, error: 'Application not found' };
    }

    const user = this.getUser(app.userId);
    const userUuid = this.resolveUserUuid(app.userId);
    const appUuid = this.resolveAppUuid(id) || app.uuid;
    const previousStatus = app.status;

    let reviewStatus = 'SUBMITTED';
    let userDbStatus = 'PENDING';
    let reviewNotes = reason || '';
    let rejectionReason = '';
    let resubmissionReason = '';
    let verifiedAt = null;

    if (decision === 'APPROVE') {
      if (!checklist || !checklist.infoMatches || !checklist.aadhaarValid || !checklist.voterIdValid) {
        return {
          success: false,
          error: 'Cannot approve application without verifying that all documents and personal details match.'
        };
      }
      reviewStatus = 'VERIFIED';
      userDbStatus = 'VERIFIED';
      verifiedAt = new Date().toISOString();
      reviewNotes = reason || 'Manual verification checks passed. Documents validated.';
    } else if (decision === 'REJECT') {
      if (!reason || !reason.trim()) {
        return { success: false, error: 'A mandatory rejection reason is required.' };
      }
      reviewStatus = 'REJECTED';
      userDbStatus = 'REJECTED';
      rejectionReason = reason;
      reviewNotes = reason;
    } else if (decision === 'REQUEST_RESUBMISSION') {
      if (!reason || !reason.trim()) {
        return { success: false, error: 'A mandatory resubmission instruction is required.' };
      }
      reviewStatus = 'RESUBMISSION_REQUIRED';
      userDbStatus = 'RESUBMISSION_REQUIRED';
      resubmissionReason = reason;
      reviewNotes = reason;
    } else if (decision === 'MARK_UNDER_REVIEW') {
      reviewStatus = 'UNDER_REVIEW';
      userDbStatus = 'SUBMITTED'; // users.identity_status CHECK permits SUBMITTED, PENDING, VERIFIED, RESUBMISSION_REQUIRED, REJECTED
      reviewNotes = reason || 'Marked for in-depth compliance verification.';
    } else {
      return { success: false, error: `Invalid decision: ${decision}` };
    }

    // 1. Update PostgreSQL identity_documents table
    if (isLivePostgres && supabaseAdmin && appUuid) {
      const updatePayload = {
        review_status: reviewStatus,
        reviewed_by_admin_id: adminId,
        rejection_reason: rejectionReason || null,
        resubmission_reason: resubmissionReason || null,
        verified_at: verifiedAt
      };

      let existingDoc = null;
      try {
        const { data: foundDoc } = await supabaseAdmin
          .from('identity_documents')
          .select('id')
          .eq('id', appUuid)
          .maybeSingle();
        existingDoc = foundDoc;
      } catch (fErr) {
        console.warn('⚠️ [IdentityRepository] Check existing doc on review error:', fErr.message);
      }

      if (existingDoc) {
        const { error: docErr } = await supabaseAdmin
          .from('identity_documents')
          .update(updatePayload)
          .eq('id', appUuid);

        if (docErr) {
          throw new Error(`Failed to update identity document in PostgreSQL: ${docErr.message}`);
        }
      } else {
        const insertPayload = {
          id: appUuid,
          user_id: userUuid,
          aadhaar_number_raw: app.aadhaarNumberRaw || null,
          aadhaar_number_masked: app.aadhaarNumberMasked || 'XXXX-XXXX-0000',
          aadhaar_doc_url: app.aadhaarDocUrl || '/docs/mock_aadhaar_user.png',
          voter_id_number_raw: app.voterIdNumberRaw || null,
          voter_id_number_masked: app.voterIdNumberMasked || 'XXX0000000',
          voter_id_doc_url: app.voterIdDocUrl || '/docs/mock_voter_user.png',
          ...updatePayload,
          submitted_at: app.submissionDate || new Date().toISOString()
        };
        const { error: docErr } = await supabaseAdmin
          .from('identity_documents')
          .insert(insertPayload);

        if (docErr) {
          throw new Error(`Failed to insert identity document into PostgreSQL on review: ${docErr.message}`);
        }
      }
    }

    // 2. Update PostgreSQL users table
    if (userUuid && this.db.userRepo) {
      try {
        await this.db.userRepo.updateIdentityStatus(userUuid, userDbStatus, adminId);
      } catch (uErr) {
        console.warn('⚠️ [IdentityRepository] Failed to update user status in PostgreSQL:', uErr.message);
      }
    }

    // 3. Update memory cache
    app.status = reviewStatus === 'SUBMITTED' ? 'IDENTITY_VERIFICATION_PENDING' : reviewStatus;
    app.overallDocumentStatus = reviewStatus;
    app.aadhaarDocStatus = reviewStatus;
    app.voterIdDocStatus = reviewStatus;
    app.reviewedByAdminId = adminId;
    app.reviewedByAdminName = adminName;
    app.reviewNotes = reviewNotes;
    app.rejectionReason = rejectionReason;
    app.resubmissionReason = resubmissionReason;
    app.lockedByAdminId = null;
    app.lockedByAdminName = null;
    app.lockedAt = null;
    app.updatedAt = new Date().toISOString();

    if (user) {
      user.identityStatus = app.status;
      if (decision === 'APPROVE') {
        user.accountStatus = 'ACTIVE';
      } else if (decision === 'REJECT') {
        user.accountStatus = 'REJECTED';
      } else if (decision === 'REQUEST_RESUBMISSION') {
        user.accountStatus = 'RESUBMISSION_REQUIRED';
      }
    }

    // 4. Create authoritative audit log
    const auditActionMap = {
      'APPROVE': 'APPROVED',
      'REJECT': 'REJECTED',
      'REQUEST_RESUBMISSION': 'RESUBMISSION_REQUESTED',
      'MARK_UNDER_REVIEW': 'UNDER_REVIEW'
    };

    if (this.db.auditLogRepo && typeof this.db.auditLogRepo.create === 'function') {
      await this.db.auditLogRepo.create({
        adminId,
        adminName,
        role: 'ADMIN',
        action: auditActionMap[decision] || decision,
        module: 'IDENTITY_VERIFICATION',
        targetEntityType: 'APPLICATION',
        targetEntityId: app.id,
        previousState: previousStatus,
        newState: app.status,
        reason: reviewNotes
      });
    }

    return {
      success: true,
      application: app,
      user
    };
  }

  findById(id) {
    if (!id) return null;
    if (this.db.identityApplications) {
      const found = this.db.identityApplications.find(a => a.id === id || a.uuid === id);
      if (found) return found;
    }
    return null;
  }

  findByUserId(userId) {
    if (!userId) return null;
    const userUuid = this.resolveUserUuid(userId);
    if (this.db.identityApplications) {
      const found = this.db.identityApplications.find(a => a.userId === userId || (userUuid && a.userUuid === userUuid));
      if (found) return found;
    }
    return null;
  }

  list(filters = {}) {
    let list = [...(this.db.identityApplications || [])];

    if (filters.status && filters.status !== 'ALL') {
      list = list.filter(a => a.status === filters.status || a.overallDocumentStatus === filters.status);
    }

    if (filters.search) {
      const q = filters.search.toLowerCase();
      list = list.filter(a =>
        a.id.toLowerCase().includes(q) ||
        (a.userName && a.userName.toLowerCase().includes(q)) ||
        (a.phone && a.phone.toLowerCase().includes(q)) ||
        (a.email && a.email.toLowerCase().includes(q))
      );
    }

    list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    const total = list.length;
    const page = parseInt(filters.page || 1, 10);
    const limit = parseInt(filters.limit || 20, 10);
    const paginated = list.slice((page - 1) * limit, page * limit);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      applications: paginated
    };
  }
}

module.exports = IdentityRepository;
