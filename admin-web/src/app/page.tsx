'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { adminApi } from '@/lib/api';
import { Activity, Users, Car, Store, Package, Settings, Power, LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [metrics, setMetrics] = useState<any>(null);
  const [services, setServices] = useState<any[]>([]);
  const router = useRouter();

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user]);

  const fetchData = async () => {
    try {
      const [metricsRes, servicesRes] = await Promise.all([
        adminApi.getMetrics(),
        adminApi.getServiceStatus()
      ]);
      if (metricsRes.data.success) setMetrics(metricsRes.data.metrics);
      if (servicesRes.data.success) setServices(servicesRes.data.services);
    } catch (err) {
      console.error('Failed to fetch data', err);
    }
  };

  const toggleService = async (serviceName: string, isPaused: boolean) => {
    try {
      if (isPaused) {
        await adminApi.resumeService(serviceName);
      } else {
        await adminApi.pauseService(serviceName, 'Admin manually paused');
      }
      fetchData();
    } catch (err) {
      alert('Failed to toggle service');
    }
  };

  if (!user) return null;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Navbar */}
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="bg-slate-900 text-white p-2 rounded-lg">
            <Settings size={20} />
          </div>
          <h1 className="text-xl font-bold text-slate-900">NABIN Admin</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-slate-600 bg-slate-100 px-3 py-1 rounded-full">
            {user.role}
          </span>
          <button 
            onClick={logout}
            className="flex items-center gap-2 text-sm text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors"
          >
            <LogOut size={16} /> Logout
          </button>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-7xl mx-auto w-full space-y-8">
        
        {/* Metrics Grid */}
        <section>
          <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
            <Activity size={20} className="text-primary" /> Key Metrics
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard 
              title="Active Customers" 
              value={metrics?.activeCustomers || '0'} 
              icon={<Users size={24} className="text-primary" />}
              bgColor="bg-primary-50" 
            />
            <MetricCard 
              title="Active Drivers" 
              value={metrics?.activeDrivers || '0'} 
              icon={<Car size={24} className="text-green-600" />}
              bgColor="bg-green-50" 
            />
            <MetricCard 
              title="Active Merchants" 
              value={metrics?.activeMerchants || '0'} 
              icon={<Store size={24} className="text-orange-600" />}
              bgColor="bg-orange-50" 
            />
            <MetricCard 
              title="Active Jobs" 
              value={metrics?.activeJobs || '0'} 
              icon={<Package size={24} className="text-purple-600" />}
              bgColor="bg-purple-50" 
            />
          </div>
        </section>

        {/* Service Controls */}
        <section>
          <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
            <Power size={20} className="text-red-600" /> Platform Services
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {services.map((svc) => (
              <div key={svc.name} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-slate-900 capitalize">{svc.name}</h3>
                  <p className="text-sm text-slate-500 mt-1">{svc.isPaused ? svc.pausedReason : 'Operating normally'}</p>
                </div>
                <button
                  onClick={() => toggleService(svc.name, svc.isPaused)}
                  className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                    svc.isPaused 
                      ? 'bg-red-100 text-red-700 hover:bg-red-200' 
                      : 'bg-green-100 text-green-700 hover:bg-green-200'
                  }`}
                >
                  {svc.isPaused ? 'RESUME' : 'PAUSE'}
                </button>
              </div>
            ))}
            {services.length === 0 && (
              <p className="text-slate-500 text-sm">Loading services...</p>
            )}
          </div>
        </section>

      </main>
    </div>
  );
}

function MetricCard({ title, value, icon, bgColor }: { title: string, value: string | number, icon: React.ReactNode, bgColor: string }) {
  return (
    <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
      <div className={`p-3 rounded-xl ${bgColor}`}>
        {icon}
      </div>
      <div>
        <p className="text-sm font-medium text-slate-500">{title}</p>
        <p className="text-2xl font-bold text-slate-900">{value}</p>
      </div>
    </div>
  );
}
