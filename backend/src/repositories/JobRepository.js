const { supabaseAdmin, isConfigured } = require('../supabase');

class JobRepository {
  constructor(db) {
    this.db = db;
  }

  findById(id) {
    return this.db.jobs.find(j => j.id === id) || null;
  }

  async create(jobData) {
    const job = {
      id: jobData.id || `JOB-${Date.now()}`,
      status: jobData.status || 'REQUESTED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...jobData
    };
    this.db.jobs.push(job);
    this.db.save();

    if (isConfigured && supabaseAdmin) {
      try {
        await supabaseAdmin.from('jobs').upsert([{
          job_number: job.id,
          service_type: job.type || 'RIDE',
          status: job.status,
          pickup_address: job.pickup?.address || 'Pickup',
          drop_address: job.drop?.address || 'Drop',
          final_total: job.fare || 0,
          driver_earnings: job.driverEarnings || 0,
          platform_commission: job.platformFee || 0,
          created_at: job.createdAt
        }], { onConflict: 'job_number' });
      } catch (err) {
        console.warn('⚠️ Supabase job create sync notice:', err.message);
      }
    }
    return job;
  }

  async updateStatus(jobId, newStatus, driverId = null) {
    const job = this.findById(jobId);
    if (!job) return null;

    job.status = newStatus;
    if (driverId) job.driverId = driverId;
    job.updatedAt = new Date().toISOString();

    this.db.save();

    if (isConfigured && supabaseAdmin) {
      try {
        await supabaseAdmin.from('jobs').update({
          status: newStatus,
          updated_at: job.updatedAt
        }).eq('job_number', jobId);
      } catch (err) {
        console.warn('⚠️ Supabase job status sync notice:', err.message);
      }
    }
    return job;
  }

  getActiveJobsByCustomerId(customerId) {
    return this.db.jobs.filter(j => j.customerId === customerId && j.status !== 'COMPLETED' && j.status !== 'CANCELLED');
  }

  getActiveJobsByDriverId(driverId) {
    return this.db.jobs.filter(j => j.driverId === driverId && j.status !== 'COMPLETED' && j.status !== 'CANCELLED');
  }
}

module.exports = JobRepository;
