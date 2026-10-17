const { supabaseAdmin, isLivePostgres } = require('../supabase');

function mapRowToDTO(row) {
  if (!row) return null;
  return {
    id: row.id,
    timestamp: row.created_at,
    adminId: row.admin_id,
    adminName: row.admin_name,
    role: row.role,
    action: row.action,
    module: row.module,
    targetEntityType: row.target_entity_type,
    targetEntityId: row.target_entity_id,
    previousState: row.previous_state,
    previousStatus: row.previous_state, // Backward compatibility alias for UI & tests
    newState: row.new_state,
    newStatus: row.new_state,           // Backward compatibility alias for UI & tests
    reason: row.reason,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    details: row.details,
    metadata: row.metadata || {},
    requestId: row.request_id,
    correlationId: row.correlation_id,
    success: row.success,
    failureReason: row.failure_reason
  };
}

class AuditLogRepository {
  constructor(db) {
    this.db = db;
  }

  /**
   * The live/offline split used to be read straight off the module bindings at call time,
   * which left the offline branch of `list()` unreachable from a live process — and that
   * branch is the one Decision 6 in docs/OWNER_SECURITY_DECISIONS.md rules on. Same answer
   * in production, substitutable in a test, on the pattern `adRepo.live` already uses.
   */
  get live() {
    return isLivePostgres && Boolean(supabaseAdmin);
  }

  get client() {
    return supabaseAdmin;
  }

  /** Exposed so `initPostgres` can map boot rows through the same shape a read returns. */
  mapRowToDTO(row) {
    return mapRowToDTO(row);
  }

  /**
   * Create an immutable audit log entry.
   * In live PostgreSQL mode, this writes directly and synchronously to public.audit_logs.
   * If PostgreSQL fails, it fails closed by throwing an Error.
   * In offline/non-live mode, it records to the database in-memory collection.
   */
  async create(entry) {
    if (!entry) {
      throw new Error('Audit entry payload is required');
    }

    const row = {
      admin_id: String(entry.adminId || entry.admin_id || 'SYSTEM'),
      admin_name: String(entry.adminName || entry.admin_name || 'System'),
      role: String(entry.role || 'SYSTEM'),
      action: String(entry.action || 'UNKNOWN_ACTION'),
      module: String(entry.module || 'SYSTEM'),
      target_entity_type: String(entry.targetEntityType || entry.target_entity_type || 'SYSTEM'),
      target_entity_id: String(entry.targetEntityId || entry.target_entity_id || 'SYSTEM'),
      previous_state: entry.previousState !== undefined ? String(entry.previousState) : (entry.previous_state || null),
      new_state: entry.newState !== undefined ? String(entry.newState) : (entry.new_state || null),
      reason: entry.reason || entry.details || null,
      ip_address: entry.ipAddress || entry.ip || entry.ip_address || null,
      user_agent: entry.userAgent || entry.user_agent || null,
      details: entry.details || null,
      metadata: entry.metadata || {},
      request_id: entry.requestId || entry.request_id || null,
      correlation_id: entry.correlationId || entry.correlation_id || null,
      success: entry.success !== false,
      failure_reason: entry.failureReason || entry.failure_reason || null
    };

    if (this.live) {
      const { data, error } = await this.client
        .from('audit_logs')
        .insert([row])
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to persist audit log in PostgreSQL: ${error.message}`);
      }

      const dto = mapRowToDTO(data);
      // Synchronize in-memory cache for legacy sync queries if initialized
      if (Array.isArray(this.db?.auditLogs)) {
        this.db.auditLogs.unshift(dto);
      }
      return dto;
    }

    // Offline / non-live fallback:
    const inMemDto = {
      id: `AUD-${Date.now().toString().slice(-4)}${Math.floor(Math.random() * 90)}`,
      timestamp: new Date().toISOString(),
      ...entry,
      previousStatus: entry.previousState || entry.previousStatus || null,
      newStatus: entry.newState || entry.newStatus || null
    };
    if (Array.isArray(this.db?.auditLogs)) {
      this.db.auditLogs.unshift(inMemDto);
    }
    return inMemDto;
  }

  /**
   * List audit logs with multi-field filtering, search, and pagination.
   * In live mode, queries PostgreSQL directly with deterministic created_at DESC ordering.
   * Fails closed if PostgreSQL returns an error.
   */
  async list(filters = {}) {
    const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 500);
    const offset = Math.max(Number(filters.offset) || 0, 0);

    if (this.live) {
      let query = this.client
        .from('audit_logs')
        .select('*', { count: 'exact' });

      if (filters.module && filters.module !== 'ALL') {
        query = query.eq('module', filters.module);
      }
      if (filters.action && filters.action !== 'ALL') {
        query = query.eq('action', filters.action);
      }
      if (filters.adminId && filters.adminId !== 'ALL') {
        query = query.eq('admin_id', filters.adminId);
      }
      if (filters.targetEntityType) {
        query = query.eq('target_entity_type', filters.targetEntityType);
      }
      if (filters.targetEntityId) {
        query = query.eq('target_entity_id', filters.targetEntityId);
      }
      if (filters.applicationId) {
        // Can match target_entity_id directly or id
        query = query.eq('target_entity_id', filters.applicationId);
      }
      if (filters.search) {
        const q = String(filters.search).trim();
        if (q) {
          query = query.or(
            `action.ilike.%${q}%,admin_name.ilike.%${q}%,reason.ilike.%${q}%,target_entity_id.ilike.%${q}%`
          );
        }
      }

      query = query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      const { data, count, error } = await query;

      if (error) {
        throw new Error(`Failed to query audit logs from PostgreSQL: ${error.message}`);
      }

      const logs = (data || []).map(mapRowToDTO);
      // A page length is not the size of the trail. `count: 'exact'` is asked for on every
      // live read, so if the server withholds it the answer is "unknown", never the count of
      // rows this one call happened to carry.
      return {
        logs,
        total: count !== null ? count : null,
        totalIsExact: count !== null,
        dataSource: 'postgresql',
        degraded: false,
        stale: false,
        storeRows: count,
        mirroredRows: null,
        hydrationLimit: null,
        readAt: new Date().toISOString(),
        notice: null
      };
    }

    // Offline / non-live fallback:
    let list = Array.isArray(this.db?.auditLogs) ? [...this.db.auditLogs] : [];
    if (filters.module && filters.module !== 'ALL') {
      list = list.filter(l => l.module === filters.module);
    }
    if (filters.action && filters.action !== 'ALL') {
      list = list.filter(l => l.action === filters.action);
    }
    if (filters.adminId && filters.adminId !== 'ALL') {
      list = list.filter(l => (l.adminId || l.admin_id) === filters.adminId);
    }
    if (filters.targetEntityType) {
      list = list.filter(l => (l.targetEntityType || l.target_entity_type) === filters.targetEntityType);
    }
    if (filters.targetEntityId) {
      list = list.filter(l => (l.targetEntityId || l.target_entity_id) === filters.targetEntityId);
    }
    if (filters.applicationId) {
      list = list.filter(l => (l.targetEntityId || l.id) === filters.applicationId);
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      list = list.filter(l =>
        (l.id && l.id.toLowerCase().includes(q)) ||
        (l.adminName && l.adminName.toLowerCase().includes(q)) ||
        (l.reason && l.reason.toLowerCase().includes(q)) ||
        (l.action && l.action.toLowerCase().includes(q)) ||
        (l.targetEntityId && l.targetEntityId.toLowerCase().includes(q))
      );
    }
    list.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const paginated = list.slice(offset, offset + limit);
    // Decision 6 (docs/OWNER_SECURITY_DECISIONS.md:228) allows this copy to answer, and
    // forbids it answering as if it were the trail. Two different copies reach this branch,
    // and the honest marker differs between them, so the label is derived from what boot
    // recorded rather than asserted from here:
    //   - a live store was read at boot: this is a newest-page window plus what the process
    //     wrote. A record the store holds and this copy does not is invisible here, so
    //     `total` stays unknown instead of becoming the length of a page.
    //   - no store is attached at all: the array is everything there is, and `total` may be
    //     its length, but it is still not durable and says so.
    const mirror = this.db?.auditMirror || {};
    const fromStore = mirror.source === 'postgres';
    return {
      logs: paginated,
      total: fromStore ? null : list.length,
      totalIsExact: !fromStore,
      dataSource: 'memory',
      degraded: fromStore,
      stale: fromStore,
      storeRows: fromStore && mirror.storeRows != null ? mirror.storeRows : null,
      mirroredRows: list.length,
      hydrationLimit: fromStore && mirror.limit != null ? mirror.limit : null,
      hydratedAt: fromStore ? (mirror.readAt || null) : null,
      hydrationError: fromStore ? (mirror.error || null) : null,
      notice: fromStore
        ? 'Served from this process\'s in-memory audit mirror, not from the audit trail. '
          + 'It holds the newest page the store handed boot plus the records this process '
          + 'wrote itself; a record missing here may exist in the store. Absence is not evidence.'
        : 'Served from this process\'s in-memory records: no PostgreSQL audit store is '
          + 'attached, so nothing here survives a restart and none of it is the durable '
          + 'audit trail.'
    };
  }

  /**
   * Get audit log by ID.
   */
  async getById(id) {
    if (!id) return null;

    if (this.live) {
      const { data, error } = await this.client
        .from('audit_logs')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        throw new Error(`Failed to fetch audit log ${id} from PostgreSQL: ${error.message}`);
      }
      return mapRowToDTO(data);
    }

    const found = (this.db?.auditLogs || []).find(l => l.id === id);
    return found || null;
  }
}

module.exports = AuditLogRepository;
