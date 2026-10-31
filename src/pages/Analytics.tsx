import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { BarChart3, TrendingUp, AlertTriangle, ArrowUpRight, Map, Filter, RefreshCcw } from 'lucide-react';
import { motion } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LineChart, Line, Area, AreaChart } from 'recharts';

const Analytics: React.FC = () => {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalShops: 0,
    totalInventory: 0,
    totalSales: 0,
    alertCount: 0,
  });
  const [stockByItem, setStockByItem] = useState<any[]>([]);
  const [salesData, setSalesData] = useState<any[]>([]);
  const [shopList, setShopList] = useState<any[]>([]);

  const fetchAnalytics = useCallback(async () => {
    try {
      const [{ data: inventoryData }, { data: txnData }, { data: usersData }, { data: alertData }] = await Promise.all([
        supabase.from('inventory').select('*'),
        supabase.from('transactions').select('*').order('timestamp', { ascending: false }),
        supabase.from('users').select('id, name, business_id, role, shop_name, zone, city').eq('role', 'dealer'),
        supabase.from('alerts').select('id').eq('status', 'open'),
      ]);

      // Inventory totals
      let invTotal = 0;
      const itemMap: Record<string, number> = {};
      inventoryData?.forEach(item => {
        invTotal += item.quantity || 0;
        itemMap[item.name] = (itemMap[item.name] || 0) + (item.quantity || 0);
      });

      // Sales by date
      const salesMap: Record<string, number> = {};
      txnData?.forEach(txn => {
        const date = txn.timestamp ? new Date(txn.timestamp).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : 'Unknown';
        salesMap[date] = (salesMap[date] || 0) + 1;
      });

      // Build shop list with FPS IDs (e.g. N2001)
      const shops = (usersData || []).map(u => ({
        id: u.business_id || u.id.slice(0, 6).toUpperCase(),
        name: u.shop_name || u.name,
        zone: u.zone || u.city || '—',
      }));

      setStats({
        totalShops: shops.length,
        totalInventory: invTotal,
        totalSales: txnData?.length || 0,
        alertCount: alertData?.length || 0,
      });
      setStockByItem(Object.entries(itemMap).map(([name, qty]) => ({ name, qty })));
      setSalesData(
        Object.entries(salesMap)
          .slice(-14) // last 14 days
          .map(([date, count]) => ({ date, count }))
      );
      setShopList(shops.slice(0, 8));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAnalytics();

    // ── Real-time subscriptions ──────────────────────────────────────────────
    const invChannel = supabase
      .channel('analytics_inventory')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, fetchAnalytics)
      .subscribe();

    const txChannel = supabase
      .channel('analytics_transactions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, fetchAnalytics)
      .subscribe();

    const alertChannel = supabase
      .channel('analytics_alerts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, fetchAnalytics)
      .subscribe();

    return () => {
      supabase.removeChannel(invChannel);
      supabase.removeChannel(txChannel);
      supabase.removeChannel(alertChannel);
    };
  }, [fetchAnalytics]);

  if (profile?.role !== 'admin')
    return <div className="p-12 text-center text-xs font-black uppercase text-red-500">Access Restricted: Non-Administrative Entity Detected</div>;

  const STAT_CARDS = [
    { label: 'Active FPS Units', value: stats.totalShops.toLocaleString(), sub: 'Live count from DB', icon: Map, color: 'text-blue-500', border: 'border-t-gov-blue' },
    { label: 'Total Inventory Assets', value: `${(stats.totalInventory / 1000).toFixed(2)} MT`, sub: 'Across all shops', icon: BarChart3, color: 'text-gov-green', border: 'border-t-gov-green' },
    { label: 'Total Distributions', value: stats.totalSales.toLocaleString(), sub: 'All-time transactions', icon: TrendingUp, color: 'text-gov-saffron', border: 'border-t-gov-saffron' },
    { label: 'Open Integrity Alerts', value: stats.alertCount, sub: 'Requires review', icon: AlertTriangle, color: 'text-red-500', border: 'border-t-red-500' },
  ];

  return (
    <div className="min-h-screen bg-gov-offwhite p-4 md:p-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-gov-blue uppercase tracking-tight">National PDS Analytics</h1>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-gov-green animate-pulse inline-block"></span>
            Real-time Monitoring • System Integrity v2.4
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-100 rounded-xl text-[10px] font-black uppercase tracking-widest text-gov-blue shadow-sm hover:bg-gray-50">
            <Filter className="w-3.5 h-3.5" /> Filter Range
          </button>
          <button
            onClick={fetchAnalytics}
            className="flex items-center gap-2 px-4 py-2 bg-gov-blue text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-gov-blue/20 hover:brightness-110 transition-all"
          >
            <RefreshCcw className="w-3.5 h-3.5" /> Sync Data
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {STAT_CARDS.map((stat, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.08 }}
            className={`bg-white p-5 rounded-2xl border border-gray-100 shadow-sm border-t-4 ${stat.border}`}
          >
            <div className="flex items-center justify-between mb-4">
              <div className={`p-2 rounded-lg bg-gray-50 ${stat.color}`}>
                <stat.icon className="w-4 h-4" />
              </div>
              <div className="flex items-center text-[9px] font-bold text-gov-green">
                <ArrowUpRight className="w-3 h-3" />
                <span className="w-1.5 h-1.5 rounded-full bg-gov-green animate-pulse ml-1 inline-block"></span>
              </div>
            </div>
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">{stat.label}</p>
            <p className="text-2xl font-black text-gov-blue">{loading ? '—' : stat.value}</p>
            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mt-2">{stat.sub}</p>
          </motion.div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Stock by Item */}
        <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
          <h3 className="text-xs font-black uppercase tracking-widest mb-6 text-gov-blue">Stock Composition (Live)</h3>
          {stockByItem.length === 0 ? (
            <div className="h-[260px] flex items-center justify-center text-gray-200 text-[10px] font-black uppercase tracking-widest">No Data</div>
          ) : (
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stockByItem} barSize={24}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 700, fill: '#9ca3af' }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 700, fill: '#9ca3af' }} />
                  <Tooltip
                    cursor={{ fill: 'rgba(0,0,128,0.04)' }}
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)', fontSize: '10px', fontWeight: 700 }}
                  />
                  <Bar dataKey="qty" radius={[6, 6, 0, 0]}>
                    {stockByItem.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={['#000080', '#138808', '#FF9933', '#7c3aed', '#0891b2'][index % 5]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Distribution trend */}
        <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
          <h3 className="text-xs font-black uppercase tracking-widest mb-6 text-gov-blue">Distribution Activity (Live)</h3>
          {salesData.length === 0 ? (
            <div className="h-[260px] flex items-center justify-center text-gray-200 text-[10px] font-black uppercase tracking-widest">No Transactions Yet</div>
          ) : (
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={salesData}>
                  <defs>
                    <linearGradient id="txGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#000080" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#000080" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 700, fill: '#9ca3af' }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 700, fill: '#9ca3af' }} />
                  <Tooltip
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)', fontSize: '10px', fontWeight: 700 }}
                  />
                  <Area type="monotone" dataKey="count" stroke="#000080" strokeWidth={2.5} fill="url(#txGrad)" dot={{ fill: '#000080', r: 3 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* FPS Shop Table */}
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-gray-50 flex items-center justify-between">
          <h3 className="text-xs font-black uppercase tracking-widest text-gov-blue flex items-center gap-2">
            <Map className="w-4 h-4" />
            Registered FPS Units
          </h3>
          <span className="text-[9px] font-bold text-gray-300 uppercase">{stats.totalShops} shops total</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="p-4 text-left text-[9px] font-black uppercase tracking-wider text-gray-400">FPS ID</th>
                <th className="p-4 text-left text-[9px] font-black uppercase tracking-wider text-gray-400">Shop Name</th>
                <th className="p-4 text-left text-[9px] font-black uppercase tracking-wider text-gray-400">Zone / City</th>
                <th className="p-4 text-left text-[9px] font-black uppercase tracking-wider text-gray-400">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {shopList.map((shop, i) => (
                <tr key={i} className="hover:bg-gov-offwhite transition-colors">
                  <td className="p-4">
                    <span className="text-xs font-black text-gov-blue font-mono bg-gov-blue/5 px-2 py-1 rounded-lg">{shop.id}</span>
                  </td>
                  <td className="p-4 text-[11px] font-bold text-gray-700 uppercase">{shop.name}</td>
                  <td className="p-4 text-[10px] font-bold text-gray-400 uppercase">{shop.zone}</td>
                  <td className="p-4">
                    <span className="text-[8px] font-black uppercase px-2 py-1 rounded-full bg-gov-green/10 text-gov-green">Active</span>
                  </td>
                </tr>
              ))}
              {shopList.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-10 text-center text-[10px] font-bold text-gray-300 uppercase tracking-widest">No shops found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Analytics;
