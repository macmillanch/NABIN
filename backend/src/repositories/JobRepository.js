class JobRepository {
  constructor(db) {
    this.db = db;
  }

  findById(id) {
    return this.db.jobs.find(j => j.id === id) || null;
  }

  create(jobData) {
    const job = {
      id: jobData.id || `JOB-${Date.now()}`,
      status: jobData.status || 'REQUESTED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...jobData
    };
    this.db.jobs.push(job);
    this.db.save();
    return job;
  }

  updateStatus(jobId, newStatus, driverId = null) {
    const job = this.findById(jobId);
    if (!job) return null;

    job.status = newStatus;
    if (driverId) job.driverId = driverId;
    job.updatedAt = new Date().toISOString();

    this.db.save();
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
