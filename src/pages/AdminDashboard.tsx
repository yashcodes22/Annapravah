import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { Package, Users, Activity, Loader2, Database, AlertCircle } from 'lucide-react';

export default function AdminDashboard() {
  const [stats, setStats] = useState({
    totalStock: 0,
    totalUsers: 0,
    totalTransactions: 0,
  });
  const [loading, setLoading] = useState(true);
  const [isResetting, setIsResetting] = useState(false);
  const [recentTechLogs, setRecentTechLogs] = useState<any[]>([]);

  const fetchStats = async () => {
    try {
      // Stock
      const { data: stockData } = await supabase.from('inventory').select('quantity');
      const totalStock = stockData?.reduce((sum, item) => sum + (item.quantity || 0), 0) || 0;

      // Families (from beneficiaries table)
      const { count: familyCount } = await supabase.from('beneficiaries').select('*', { count: 'exact', head: true });

      // Transactions
      const { data: txData, count: txCount } = await supabase
        .from('transactions')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .limit(15);

      setStats({
        totalStock,
        totalUsers: familyCount || 0,
        totalTransactions: txCount || 0,
      });
      setRecentTechLogs(txData || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();

    // Setup real-time subscriptions
    const inventoryChannel = supabase.channel('inventory_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, () => {
        fetchStats();
      })
      .subscribe();

    const transactionsChannel = supabase.channel('transactions_changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transactions' }, () => {
        fetchStats();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(inventoryChannel);
      supabase.removeChannel(transactionsChannel);
    };
  }, []);

  const chartData = [
    { name: 'Wk 1', val: 400 },
    { name: 'Wk 2', val: 300 },
    { name: 'Wk 3', val: 500 },
    { name: 'Wk 4', val: 450 },
  ];

  if (loading) return <div className="font-mono uppercase text-xs">SCANNING_DATABASE...</div>;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header className="border-b border-gray-200 pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-gov-blue uppercase tracking-tight">Administrative Control Center</h1>
          <p className="text-gray-500 text-xs mt-1 uppercase tracking-wider font-bold">National Public Distribution Monitoring</p>
        </div>
        <div className="flex items-center gap-3">
        </div>
      </header>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { label: 'Central Stock Reserve', val: `${stats.totalStock.toLocaleString()} KG`, icon: Package, trend: '+12.5%', color: 'border-l-gov-saffron' },
          { label: 'Registered Families', val: stats.totalUsers, icon: Users, trend: 'Verified', color: 'border-l-gov-blue' },
          { label: 'Ration Transactions', val: stats.totalTransactions, icon: Activity, trend: 'Secure', color: 'border-l-gov-green' }
        ].map((stat) => (
          <div key={stat.label} className={`border border-gray-100 border-l-8 ${stat.color} p-6 bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow`}>
            <div className="flex justify-between items-center mb-4">
              <div className="p-2 bg-gray-50 rounded-lg">
                <stat.icon className="w-5 h-5 text-gov-blue" />
              </div>
              <span className="text-[10px] font-bold py-1 px-2 bg-gov-green/10 text-gov-green rounded-full uppercase tracking-tighter">{stat.trend}</span>
            </div>
            <p className="text-3xl font-black text-gov-blue tracking-tight">{stat.val}</p>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-2">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-8">
        {/* Recent Activity */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden flex flex-col">
          <div className="p-6 border-b border-gray-50 flex items-center justify-between bg-gov-offwhite">
            <h2 className="text-sm font-bold text-gov-blue uppercase tracking-widest">Live Transaction Log</h2>
            <div className="bg-gov-green/10 p-2 rounded-full animate-blink">
               <Activity className="w-4 h-4 text-gov-green" />
            </div>
          </div>
          <div className="divide-y divide-gray-50 overflow-y-auto max-h-[300px]">
            {recentTechLogs.length > 0 ? recentTechLogs.map((log) => (
              <div key={log.id} className="p-4 hover:bg-gray-50 transition-colors cursor-pointer group flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-gov-blue/5 flex items-center justify-center font-bold text-gov-blue text-[10px] border border-gov-blue/10">
                    {(log.dealer_id || log.dealerId)?.toString().substring(0, 2) || 'TX'}
                  </div>
                  <div>
                    <p className="text-xs font-bold text-gov-blue uppercase">REF_{log.id.slice(0,6)}</p>
                    <p className="text-[10px] text-gray-400 font-medium">Verified at {new Date(log.timestamp || log.created_at).toLocaleTimeString()}</p>
                  </div>
                </div>
                <span className="text-[10px] bg-gov-green/10 text-gov-green px-2 py-1 rounded font-bold uppercase tracking-tighter">SUCCESS</span>
              </div>
            )) : (
              <div className="p-12 text-center text-gray-300 uppercase text-[10px] font-bold tracking-widest">No Activity Detected</div>
            )}
          </div>
          <div className="mt-auto p-4 bg-gray-50 border-t border-gray-100 flex justify-center">
             <button className="text-[9px] font-bold uppercase text-gov-blue hover:text-gov-saffron transition-colors tracking-widest underline underline-offset-4">Download Comprehensive Audit Data</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(' ');
}
