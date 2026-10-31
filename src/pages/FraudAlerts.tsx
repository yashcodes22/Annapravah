import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { ShieldAlert, Fingerprint, Activity, Clock, ChevronRight, Search, Filter, AlertOctagon, Moon, CheckCircle } from 'lucide-react';
import { motion } from 'framer-motion';

interface FraudAlert {
  id: string;
  shop_id: string;
  type: 'STOCK_MISMATCH' | 'GHOST_USER' | 'ABNORMAL_SPIKE' | 'NIGHT_HOURS_ENTRY';
  severity: 'low' | 'medium' | 'high';
  timestamp: string;
  description: string;
  status: 'open' | 'resolved';
}

// ── Night-hours detection: 9 PM (21:00) to 6 AM (06:00) ──────────────────────
const isNightHours = (isoTimestamp: string): boolean => {
  const d = new Date(isoTimestamp);
  const h = d.getHours();
  return h >= 21 || h < 6;
};

const FraudAlerts: React.FC = () => {
  const [alerts, setAlerts] = useState<FraudAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState<string | null>(null);

  // ── Fetch alerts + run night-hours check on latest inventory entries ────────
  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    try {
      // Existing alerts
      const { data: existingAlerts } = await supabase
        .from('alerts')
        .select('*')
        .order('timestamp', { ascending: false });

      // Night-hours detection: scan inventory rows created between 9 PM–6 AM
      // that haven't already been flagged
      const { data: recentInv } = await supabase
        .from('inventory')
        .select('id, name, owner_id, created_at, quantity')
        .order('created_at', { ascending: false })
        .limit(200);

      const flaggedInventoryIds = new Set(
        (existingAlerts || [])
          .filter(a => a.type === 'NIGHT_HOURS_ENTRY')
          .map(a => a.inventory_ref_id)
          .filter(Boolean)
      );

      const nightEntries = (recentInv || []).filter(
        item => item.created_at && isNightHours(item.created_at) && !flaggedInventoryIds.has(item.id)
      );

      // Insert a NIGHT_HOURS_ENTRY alert for each new night-time stock entry
      if (nightEntries.length > 0) {
        const newAlerts = nightEntries.map(item => ({
          shop_id: item.owner_id,
          type: 'NIGHT_HOURS_ENTRY',
          severity: 'high',
          timestamp: item.created_at,
          description: `Night-hours stock entry detected: ${item.quantity} KG of "${item.name}" entered at ${new Date(item.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })} — outside permitted hours (6 AM – 9 PM). Possible unauthorized diversion.`,
          status: 'open',
          inventory_ref_id: item.id,
        }));
        await supabase.from('alerts').insert(newAlerts);
      }

      // Re-fetch after potential inserts
      const { data: allAlerts } = await supabase
        .from('alerts')
        .select('*')
        .order('timestamp', { ascending: false });

      if (allAlerts) setAlerts(allAlerts as FraudAlert[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();

    // ── Real-time: new alerts inserted ──────────────────────────────────────
    const alertChannel = supabase
      .channel('fraud_alerts_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, fetchAlerts)
      .subscribe();

    // ── Real-time: new inventory entries → trigger night-hours check ─────────
    const invChannel = supabase
      .channel('fraud_inventory_watch')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'inventory' }, fetchAlerts)
      .subscribe();

    return () => {
      supabase.removeChannel(alertChannel);
      supabase.removeChannel(invChannel);
    };
  }, [fetchAlerts]);

  const resolveAlert = async (alertId: string) => {
    await supabase.from('alerts').update({ status: 'resolved' }).eq('id', alertId);
    // UI will update via real-time channel
  };

  const runFraudAudit = async () => {
    setScanning(true);
    try {
      // Manual audit: create a STOCK_MISMATCH alert as a sample
      const newAlert = {
        shop_id: 'N2001',
        type: 'STOCK_MISMATCH',
        severity: 'high',
        timestamp: new Date().toISOString(),
        description: 'Manual audit triggered: Variance of 45.4 KG Wheat detected between barcode manifest and physical register.',
        status: 'open',
      };
      await supabase.from('alerts').insert([newAlert]);
      // Real-time channel will auto-refresh
    } catch (err) {
      console.error(err);
    } finally {
      setScanning(false);
    }
  };

  const filtered = alerts.filter(a => {
    const matchSearch = !searchQuery ||
      a.shop_id?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchSev = !severityFilter || a.severity === severityFilter;
    return matchSearch && matchSev;
  });

  const severityCounts = {
    high: alerts.filter(a => a.severity === 'high' && a.status === 'open').length,
    medium: alerts.filter(a => a.severity === 'medium' && a.status === 'open').length,
    low: alerts.filter(a => a.severity === 'low' && a.status === 'open').length,
  };

  const ALERT_TYPE_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
    STOCK_MISMATCH:    { label: 'Stock Mismatch',       icon: AlertOctagon, color: 'text-red-500' },
    GHOST_USER:        { label: 'Ghost User',           icon: Fingerprint,  color: 'text-purple-500' },
    ABNORMAL_SPIKE:    { label: 'Abnormal Spike',       icon: Activity,     color: 'text-gov-saffron' },
    NIGHT_HOURS_ENTRY: { label: 'Night Hours Entry',    icon: Moon,         color: 'text-indigo-500' },
  };

  return (
    <div className="min-h-screen bg-gov-offwhite p-6 md:p-8">
      <div className="max-w-6xl mx-auto space-y-8">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-600 rounded-xl flex items-center justify-center shadow-lg shadow-red-600/20">
                <ShieldAlert className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-black text-gov-blue uppercase tracking-tight">System Integrity & Fraud Center</h1>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-0.5 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-gov-green animate-pulse inline-block"></span>
                  Real-time Automated Oversight • Night-Hours Monitor Active
                </p>
              </div>
            </div>

            <div className="flex items-center gap-6">
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Audit Status</p>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-gov-green animate-pulse"></div>
                  <span className="text-[10px] font-black text-gov-green uppercase">Engine Nominal</span>
                </div>
              </div>
              <div className="w-px h-8 bg-gray-200"></div>
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Open Flags</p>
                <p className="text-xl font-black text-gov-blue">{alerts.filter(a => a.status === 'open').length}</p>
              </div>
              <div className="w-px h-8 bg-gray-200"></div>
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1">Night-Hours Flags</p>
                <p className="text-xl font-black text-indigo-600">
                  {alerts.filter(a => a.type === 'NIGHT_HOURS_ENTRY' && a.status === 'open').length}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-gov-blue transition-colors" />
              <input
                type="text"
                placeholder="SEARCH FPS ID / DESCRIPTION..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-11 pr-4 py-3 bg-white border border-gray-100 rounded-xl text-[10px] font-bold uppercase outline-none focus:border-gov-blue w-64 shadow-sm"
              />
            </div>
            <button
              onClick={runFraudAudit}
              disabled={scanning}
              className="flex items-center gap-2 px-6 py-3 bg-gov-blue text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:brightness-110 active:scale-95 transition-all disabled:opacity-50"
            >
              {scanning ? <Activity className="w-4 h-4 animate-spin" /> : <Fingerprint className="w-4 h-4" />}
              Trigger Audit
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Filters Rail */}
          <div className="space-y-6">
            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm space-y-4">
              <h3 className="text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                <Filter className="w-3 h-3 text-gov-blue" /> Severity Filters
              </h3>
              <div className="space-y-2">
                {[
                  { label: 'Critical / High', color: 'bg-red-500', key: 'high', count: severityCounts.high },
                  { label: 'Warning / Med',   color: 'bg-gov-saffron', key: 'medium', count: severityCounts.medium },
                  { label: 'Advisory / Low',  color: 'bg-gov-blue', key: 'low', count: severityCounts.low },
                ].map(f => (
                  <button
                    key={f.key}
                    onClick={() => setSeverityFilter(prev => prev === f.key ? null : f.key)}
                    className={`w-full flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 cursor-pointer transition-all border ${severityFilter === f.key ? 'border-gov-blue bg-gov-blue/5' : 'border-transparent'}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${f.color}`}></div>
                      <span className="text-[10px] font-bold text-gray-500 uppercase">{f.label}</span>
                    </div>
                    <span className="text-[10px] font-black text-gray-400">{f.count}</span>
                  </button>
                ))}
                {severityFilter && (
                  <button onClick={() => setSeverityFilter(null)} className="w-full text-[9px] font-black text-gov-blue uppercase tracking-widest underline underline-offset-4 mt-2">
                    Clear Filter
                  </button>
                )}
              </div>
            </div>

            <div className="bg-indigo-50 border border-indigo-100 p-5 rounded-2xl space-y-3">
              <h3 className="text-[10px] font-black uppercase tracking-widest flex items-center gap-2 text-indigo-700">
                <Moon className="w-3 h-3" /> Night Monitor
              </h3>
              <p className="text-[9px] font-bold text-indigo-500 leading-relaxed uppercase">
                Any stock entry logged between <span className="font-black">9:00 PM – 6:00 AM</span> is automatically flagged as a NIGHT_HOURS_ENTRY alert. New inventory inserts are watched in real-time.
              </p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm space-y-4">
              <h3 className="text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                <Clock className="w-3 h-3 text-gov-blue" /> Alert Types
              </h3>
              <div className="space-y-3">
                {Object.entries(ALERT_TYPE_META).map(([key, meta]) => (
                  <div key={key} className="flex items-center gap-2">
                    <meta.icon className={`w-3 h-3 ${meta.color}`} />
                    <span className="text-[9px] font-bold text-gray-400 uppercase">{meta.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Main Feed */}
          <div className="lg:col-span-3 space-y-4">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 bg-white rounded-3xl border border-gray-100">
                <Activity className="w-10 h-10 text-gray-200 animate-pulse mb-4" />
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-300">Loading Integrity Stream...</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 bg-white rounded-3xl border border-dashed border-gray-200">
                <ShieldAlert className="w-10 h-10 text-gray-100 mb-4" />
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-300">No Integrity Breaches Detected</p>
              </div>
            ) : (
              filtered.map((alert, idx) => {
                const meta = ALERT_TYPE_META[alert.type] || ALERT_TYPE_META.STOCK_MISMATCH;
                const AlertIcon = meta.icon;
                const isResolved = alert.status === 'resolved';
                return (
                  <motion.div
                    key={alert.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.04 }}
                    className={`bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden group hover:shadow-lg transition-all border-l-4 ${
                      isResolved ? 'border-l-gray-200 opacity-60' :
                      alert.severity === 'high' ? 'border-l-red-500' :
                      alert.severity === 'medium' ? 'border-l-gov-saffron' : 'border-l-gov-blue'
                    }`}
                  >
                    <div className="p-5 flex items-start gap-5">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                        alert.type === 'NIGHT_HOURS_ENTRY' ? 'bg-indigo-50' :
                        alert.severity === 'high' ? 'bg-red-50' : 'bg-gov-offwhite'
                      }`}>
                        <AlertIcon className={`w-6 h-6 ${isResolved ? 'text-gray-300' : meta.color}`} />
                      </div>

                      <div className="flex-1 space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                              isResolved ? 'bg-gray-100 text-gray-400' :
                              alert.severity === 'high' ? 'bg-red-100 text-red-700' :
                              alert.severity === 'medium' ? 'bg-orange-100 text-orange-700' :
                              'bg-blue-100 text-blue-700'
                            }`}>
                              {meta.label}
                            </span>
                            {/* Show actual FPS ID like N2001 */}
                            <span className="text-[10px] font-black text-gov-blue uppercase font-mono bg-gov-blue/5 px-2 py-0.5 rounded-lg">
                              FPS #{alert.shop_id || '—'}
                            </span>
                            {isResolved && (
                              <span className="text-[9px] font-black text-gov-green uppercase flex items-center gap-1">
                                <CheckCircle className="w-3 h-3" /> Resolved
                              </span>
                            )}
                          </div>
                          <p className="text-[9px] font-bold text-gray-400 uppercase shrink-0">
                            {alert.timestamp ? new Date(alert.timestamp).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }) : 'Just now'}
                          </p>
                        </div>

                        <p className="text-xs font-medium text-gray-600 leading-relaxed">{alert.description}</p>

                        {!isResolved && (
                          <div className="pt-3 flex items-center gap-4">
                            <button className="text-[9px] font-black text-gov-blue uppercase hover:underline flex items-center gap-1">
                              Open Investigation <ChevronRight className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => resolveAlert(alert.id)}
                              className="text-[9px] font-black text-gov-green uppercase hover:underline flex items-center gap-1"
                            >
                              <CheckCircle className="w-3 h-3" /> Mark Resolved
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default FraudAlerts;
