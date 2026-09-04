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

    if (isLivePostgres && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
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

    if (isLivePostgres && supabaseAdmin) {
      let query = supabaseAdmin
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
      return {
        logs,
        total: count !== null ? count : logs.length
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
    const total = list.length;
    const paginated = list.slice(offset, offset + limit);
    return {
      logs: paginated,
      total
    };
  }

  /**
   * Get audit log by ID.
   */
  async getById(id) {
    if (!id) return null;

    if (isLivePostgres && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
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
