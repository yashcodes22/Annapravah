import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Package, MapPin, Bell, ShoppingBag, Info, AlertCircle, Loader2, Users, QrCode, X, Maximize2, CheckCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Barcode from 'react-barcode';

const ConsumerPortal: React.FC = () => {
  const { profile } = useAuth();
  const [history, setHistory] = useState<any[]>([]);
  const [shopStock, setShopStock] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isBarcodeEnlarged, setIsBarcodeEnlarged] = useState(false);
  const [entitlements, setEntitlements] = useState<any[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<string[]>([]);
  const [reportModal, setReportModal] = useState<'theft' | 'delay' | null>(null);
  const [reportText, setReportText] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportSuccess, setReportSuccess] = useState(false);

  const assignedShopId = profile?.assignedShopId;           // FPS code e.g. N2001 — display only
  const assignedShopUUID = profile?.assignedShopUUID;       // dealer UUID — for DB queries
  const beneficiaryId = profile?.beneficiaryId;

  const fetchConsumerData = useCallback(async () => {
    if (!beneficiaryId) return;
    try {
      // 1. Beneficiary profile for entitlements
      const { data: beneData } = await supabase
        .from('beneficiaries')
        .select('*')
        .eq('id', beneficiaryId)
        .maybeSingle();

      // 2. Transaction history
      const { data: txData } = await supabase
        .from('transactions')
        .select('*')
        .eq('beneficiary_id', beneficiaryId)
        .order('created_at', { ascending: false });

      setHistory((txData || []).slice(0, 5));

      if (beneData) {
        const consumedMap: Record<string, number> = {};
        (txData || []).forEach(tx => {
          if (tx.items) {
            Object.entries(tx.items).forEach(([item, qty]) => {
              const key = item.toLowerCase();
              consumedMap[key] = (consumedMap[key] || 0) + (Number(qty) || 0);
            });
          }
        });
        const entList = Object.entries(beneData.entitlement || {}).map(([item, total]) => ({
          item: item.charAt(0).toUpperCase() + item.slice(1),
          total: Number(total),
          consumed: consumedMap[item.toLowerCase()] || 0,
          unit: 'KG',
        }));
        setEntitlements(entList);

        // Build notifications
        const notifs: string[] = [];
        entList.forEach(e => {
          if (e.consumed >= e.total) {
            notifs.push(`${e.item}: Monthly quota fully collected.`);
          } else {
            notifs.push(`${e.item}: ${e.total - e.consumed} KG remaining this month.`);
          }
        });
        setNotifications(notifs);
      }

      // 3. Shop stock
      if (assignedShopUUID) {
        const { data: invData } = await supabase
          .from('inventory')
          .select('*')
          .eq('owner_id', assignedShopUUID)
          .eq('status', 'received');

        const itemsMap: Record<string, number> = {};
        (invData || []).forEach(item => {
          itemsMap[item.name] = (itemsMap[item.name] || 0) + (item.quantity || 0);
        });
        setShopStock(Object.entries(itemsMap).map(([name, qty]) => ({ name, qty })));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [beneficiaryId, assignedShopUUID]);

  useEffect(() => {
    fetchConsumerData();
    if (!beneficiaryId || !assignedShopUUID) return;

    const txChannel = supabase
      .channel(`consumer_tx_${beneficiaryId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'transactions',
        filter: `beneficiary_id=eq.${beneficiaryId}`,
      }, fetchConsumerData)
      .subscribe();

    const invChannel = supabase
      .channel(`consumer_inv_${assignedShopUUID}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'inventory',
        filter: `owner_id=eq.${assignedShopUUID}`,
      }, fetchConsumerData)
      .subscribe();

    return () => {
      supabase.removeChannel(txChannel);
      supabase.removeChannel(invChannel);
    };
  }, [fetchConsumerData, beneficiaryId, assignedShopUUID]);

  const handleReport = async () => {
    if (!reportText.trim()) return;
    setReportSubmitting(true);
    try {
      await supabase.from('alerts').insert([{
        type: reportModal === 'theft' ? 'theft_report' : 'stock_delay_report',
        beneficiary_id: beneficiaryId,
        shop_id: assignedShopUUID || assignedShopId,
        message: reportText,
        status: 'open',
        created_at: new Date().toISOString(),
      }]);
      setReportSuccess(true);
      setReportText('');
      setTimeout(() => {
        setReportSuccess(false);
        setReportModal(null);
      }, 2000);
    } catch (err) {
      console.error(err);
    } finally {
      setReportSubmitting(false);
    }
  };

  if (profile?.role !== 'beneficiary')
    return <div className="p-12 text-center text-red-500 font-bold uppercase">Consumer Access Profile Required</div>;

  return (
    <div className="min-h-screen bg-[#F8FAFC] pb-24">
      {/* Header */}
      <div className="bg-gov-blue text-white pt-16 pb-28 px-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-white/5 rounded-full -mr-40 -mt-20 blur-3xl"></div>
        <div className="absolute bottom-0 left-0 w-60 h-60 bg-gov-saffron/10 rounded-full -ml-30 -mb-20 blur-3xl"></div>

        <div className="max-w-xl mx-auto flex items-center justify-between relative z-10">
          <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
            <p className="text-[10px] font-black uppercase tracking-[0.3em] opacity-50 mb-1 leading-none">Smart PDS Beneficiary</p>
            <h1 className="text-3xl font-black tracking-tight leading-tight">{profile.name.split(' ')[0]}</h1>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <div className="flex items-center gap-2 bg-white/10 px-3 py-1.5 rounded-full border border-white/10 backdrop-blur-sm">
                <Package className="w-3 h-3 text-gov-saffron" />
                <span className="text-[9px] font-black uppercase tracking-widest text-white/90">
                  Card ID: {beneficiaryId || 'N/A'}
                </span>
              </div>
              <div className="flex items-center gap-2 bg-white/10 px-3 py-1.5 rounded-full border border-white/10 backdrop-blur-sm">
                <MapPin className="w-3 h-3 text-gov-green" />
                <span className="text-[9px] font-black uppercase tracking-widest text-white/90">
                  FPS: {assignedShopId || 'N/A'}
                </span>
              </div>
            </div>
          </motion.div>

          {/* Notification Bell */}
          <div className="relative">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setNotifOpen(v => !v)}
              className="w-14 h-14 bg-white/10 rounded-[22px] flex items-center justify-center backdrop-blur-md border border-white/10 relative"
            >
              <Bell className="w-6 h-6 text-white" />
              {notifications.length > 0 && (
                <span className="absolute top-2 right-2 w-2.5 h-2.5 bg-gov-saffron rounded-full border-2 border-gov-blue"></span>
              )}
            </motion.button>
            <AnimatePresence>
              {notifOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className="absolute right-0 top-16 w-72 bg-white rounded-2xl shadow-2xl border border-gray-100 z-50 overflow-hidden"
                >
                  <div className="p-4 bg-gov-blue text-white flex items-center justify-between">
                    <p className="text-[10px] font-black uppercase tracking-widest">Notifications</p>
                    <button onClick={() => setNotifOpen(false)}><X className="w-4 h-4" /></button>
                  </div>
                  <div className="divide-y divide-gray-50 max-h-64 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <p className="p-4 text-[10px] text-gray-400 font-bold uppercase text-center">No notifications</p>
                    ) : notifications.map((n, i) => (
                      <div key={i} className="p-4 flex items-start gap-3">
                        <CheckCircle className="w-4 h-4 text-gov-green flex-shrink-0 mt-0.5" />
                        <p className="text-[10px] font-bold text-gray-600">{n}</p>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <div className="max-w-xl mx-auto px-6 -mt-16 space-y-6 relative z-20">

        {/* Barcode Card — shows Card ID */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-[32px] shadow-2xl shadow-gray-200/50 p-6 border border-white flex flex-col md:flex-row items-center justify-between gap-6 overflow-hidden relative group"
        >
          <div className="absolute top-0 left-0 w-1.5 h-full bg-gov-saffron"></div>
          <div className="flex items-center gap-4 relative z-10">
            <div className="p-3 bg-gov-saffron/10 rounded-2xl">
              <QrCode className="w-6 h-6 text-gov-saffron" />
            </div>
            <div>
              <h3 className="text-[11px] font-black text-gov-blue uppercase tracking-widest">Digital Distribution Key</h3>
              <p className="text-[9px] font-bold text-gray-400 uppercase tracking-tight mt-0.5">
                Card ID: <span className="text-gov-blue">{beneficiaryId || 'N/A'}</span>
              </p>
            </div>
          </div>

          <div
            onClick={() => setIsBarcodeEnlarged(true)}
            className="bg-white px-6 py-2 rounded-2xl border border-gray-50 shadow-inner group-hover:scale-105 transition-transform min-h-[80px] flex items-center justify-center cursor-zoom-in relative"
          >
            <div className="absolute -top-1 -right-1 p-1 bg-gov-blue text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity z-20">
              <Maximize2 className="w-2.5 h-2.5" />
            </div>
            {beneficiaryId ? (
              <Barcode
                value={beneficiaryId}
                width={1.2} height={40} fontSize={10}
                fontOptions="bold" text={beneficiaryId}
                lineColor="#000080" background="#ffffff" renderer="svg"
              />
            ) : (
              <span className="text-[9px] text-gray-300 font-bold uppercase">No Card ID</span>
            )}
          </div>
        </motion.div>

        {/* Enlarged Barcode Modal */}
        <AnimatePresence>
          {isBarcodeEnlarged && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-gov-blue/90 backdrop-blur-xl"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white p-10 rounded-[40px] shadow-2xl relative max-w-sm w-full flex flex-col items-center"
              >
                <button
                  onClick={() => setIsBarcodeEnlarged(false)}
                  className="absolute top-6 right-6 w-10 h-10 bg-gray-50 rounded-2xl flex items-center justify-center text-gray-400 hover:text-red-500 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
                <div className="text-center mb-8">
                  <p className="text-[10px] font-black text-gov-blue/30 uppercase tracking-[0.3em] mb-2">Ration Card</p>
                  <h4 className="text-sm font-black text-gov-blue uppercase tracking-widest">{profile.name}</h4>
                  <p className="text-[9px] text-gray-400 font-bold mt-1">Card ID: {beneficiaryId}</p>
                </div>
                <div className="bg-white p-6 rounded-3xl border-4 border-gov-blue/5 shadow-inner">
                  {beneficiaryId ? (
                    <Barcode
                      value={beneficiaryId}
                      width={2.5} height={120} fontSize={16}
                      fontOptions="bold" text={beneficiaryId}
                      lineColor="#000080" background="#ffffff" renderer="svg"
                    />
                  ) : (
                    <p className="text-[10px] text-gray-300 font-bold uppercase">No Card ID</p>
                  )}
                </div>
                <p className="mt-8 text-[10px] text-gray-400 font-bold uppercase text-center max-w-[200px] leading-relaxed">
                  Dealer: Scan this identity manifest for instant ledger authentication.
                </p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Entitlements */}
        <div className="bg-white rounded-[32px] shadow-2xl shadow-gray-200/50 p-7 border border-white overflow-hidden relative">
          <div className="absolute top-0 right-0 p-4 opacity-5">
            <ShoppingBag className="w-20 h-20" />
          </div>
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-xs font-black uppercase tracking-widest text-gov-blue">Entitlement Wallet</h3>
            <div className="px-2 py-1 bg-gov-offwhite rounded-lg">
              <p className="text-[9px] font-black text-gray-400 uppercase">
                {new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}
              </p>
            </div>
          </div>
          <div className="space-y-7">
            {entitlements.length > 0 ? entitlements.map((e, i) => (
              <div key={i} className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-black uppercase tracking-wide text-gray-600">{e.item}</span>
                  <span className="text-xs font-black text-gov-blue">{e.consumed} / {e.total} {e.unit}</span>
                </div>
                <div className="h-2.5 bg-gray-50 rounded-full overflow-hidden border border-gray-100">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min((e.consumed / e.total) * 100, 100)}%` }}
                    transition={{ duration: 1.5, ease: 'easeOut' }}
                    className={`h-full rounded-full shadow-inner ${e.consumed >= e.total ? 'bg-red-400' : 'bg-gov-blue'}`}
                  />
                </div>
              </div>
            )) : (
              <p className="text-[10px] text-gray-300 font-bold uppercase tracking-widest text-center py-4">
                {loading ? 'Loading entitlements...' : 'No entitlement data found. Contact your FPS dealer.'}
              </p>
            )}
          </div>
        </div>

        {/* Family Details */}
        {profile.familyMembers && profile.familyMembers.length > 0 && (
          <div className="bg-white rounded-[32px] shadow-sm border border-gray-100 p-7">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-gov-blue/5 rounded-2xl flex items-center justify-center">
                <Users className="w-5 h-5 text-gov-blue" />
              </div>
              <h3 className="text-xs font-black uppercase tracking-widest text-gov-blue">Family Unit Details</h3>
            </div>
            <div className="space-y-4">
              {profile.familyMembers.map((member, idx) => (
                <div key={idx} className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100/50">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-[10px] font-black text-gov-blue border border-gray-200">
                      {member.name[0]}
                    </div>
                    <div>
                      <p className="text-[11px] font-black text-gov-blue uppercase leading-none">{member.name}</p>
                      <p className="text-[9px] font-bold text-gray-400 uppercase mt-1">{member.relation} • {member.age} yrs</p>
                    </div>
                  </div>
                  <p className="text-[9px] font-mono text-gray-400 font-bold">{member.aadhaarMasked}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Live Shop Stock */}
        <div className="bg-gov-blue rounded-[32px] p-7 text-white shadow-xl shadow-gov-blue/20">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/10 rounded-2xl flex items-center justify-center">
                <MapPin className="w-5 h-5 text-gov-saffron" />
              </div>
              <div>
                <p className="text-[9px] font-black text-white/50 uppercase tracking-widest">LIVE FPS STATUS</p>
                <h4 className="text-[11px] font-black text-white uppercase tracking-tight">
                  FPS #{assignedShopId || 'N/A'} — {profile.shopName || 'Assigned Shop'}
                </h4>
              </div>
            </div>
            <div className="flex items-center gap-2 px-3 py-1 bg-gov-green/20 rounded-full border border-gov-green/30">
              <div className="w-1.5 h-1.5 rounded-full bg-gov-green animate-pulse"></div>
              <span className="text-[8px] font-black text-gov-green uppercase">Live</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {shopStock.length > 0 ? (
              shopStock.map((item, idx) => (
                <div key={idx} className="p-4 bg-white/5 rounded-2xl border border-white/5 backdrop-blur-sm">
                  <p className="text-[9px] font-black text-white/40 uppercase mb-1">{item.name}</p>
                  <p className="text-sm font-black text-white">{item.qty} KG</p>
                </div>
              ))
            ) : (
              <div className="col-span-2 py-4 text-center border border-dashed border-white/10 rounded-2xl">
                <p className="text-[9px] font-bold text-white/30 uppercase">
                  {loading ? 'Fetching inventory data...' : 'No stock currently available at your shop.'}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Transaction History */}
        <div className="space-y-5">
          <div className="flex items-center justify-between px-3">
            <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-400">Ledger History</h3>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-gov-green animate-pulse"></div>
              <span className="text-[9px] font-bold text-gray-300 uppercase">Live</span>
            </div>
          </div>

          <div className="bg-white rounded-[40px] shadow-sm border border-gray-100 overflow-hidden">
            <AnimatePresence mode="popLayout">
              {loading ? (
                <motion.div
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="py-16 flex flex-col items-center gap-4"
                >
                  <Loader2 className="w-8 h-8 animate-spin text-gov-blue opacity-20" />
                  <p className="text-[10px] font-black uppercase text-gray-300 tracking-widest">Syncing Records...</p>
                </motion.div>
              ) : history.length === 0 ? (
                <motion.div
                  className="py-24 text-center"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                >
                  <ShoppingBag className="w-12 h-12 text-gray-100 mx-auto mb-4" />
                  <p className="text-[10px] font-black uppercase text-gray-300 tracking-widest leading-loose">
                    No Past Transactions
                  </p>
                </motion.div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {history.map(tx => (
                    <motion.div
                      layout
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      key={tx.id}
                      className="p-7 flex items-center justify-between group cursor-pointer hover:bg-gray-50/50 transition-colors"
                    >
                      <div className="flex items-center gap-5">
                        <div className="w-11 h-11 rounded-2xl bg-gray-50 flex items-center justify-center group-hover:bg-white transition-all transform group-hover:rotate-6">
                          <ShoppingBag className="w-5 h-5 text-gov-blue" />
                        </div>
                        <div>
                          <p className="text-[11px] font-black text-gov-blue uppercase">Ration Collection</p>
                          <p className="text-[9px] text-gray-400 font-bold uppercase mt-1">Ref: {tx.id.substring(0, 8).toUpperCase()}</p>
                          {tx.items && (
                            <p className="text-[8px] text-gray-300 font-bold uppercase mt-0.5">
                              {Object.entries(tx.items).map(([k, v]) => `${k}: ${v}kg`).join(' • ')}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-black text-gov-green uppercase tracking-widest flex items-center gap-2 justify-end">
                          <span className="w-1.5 h-1.5 bg-gov-green rounded-full"></span>
                          SUCC
                        </p>
                        <p className="text-[9px] text-gray-300 font-bold uppercase mt-1">
                          {(tx.timestamp || tx.created_at) ? new Date(tx.timestamp || tx.created_at).toLocaleDateString() : 'Pending'}
                        </p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-4 pb-10">
          <motion.button
            whileHover={{ y: -4 }}
            onClick={() => setReportModal('theft')}
            className="bg-white p-5 rounded-[28px] border border-gray-100 flex flex-col items-center gap-3 shadow-sm hover:shadow-xl hover:shadow-gov-blue/5 transition-all"
          >
            <div className="w-10 h-10 bg-gov-blue/5 rounded-xl flex items-center justify-center">
              <AlertCircle className="w-5 h-5 text-gov-blue" />
            </div>
            <span className="text-[9px] font-black uppercase tracking-widest text-gov-blue">Report Theft</span>
          </motion.button>
          <motion.button
            whileHover={{ y: -4 }}
            onClick={() => setReportModal('delay')}
            className="bg-white p-5 rounded-[28px] border border-gray-100 flex flex-col items-center gap-3 shadow-sm hover:shadow-xl hover:shadow-gov-blue/5 transition-all"
          >
            <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center">
              <Info className="w-5 h-5 text-red-500" />
            </div>
            <span className="text-[9px] font-black uppercase tracking-widest text-red-500">Stock Delay</span>
          </motion.button>
        </div>
      </div>

      {/* Report Modal */}
      <AnimatePresence>
        {reportModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          >
            <motion.div
              initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
              className="bg-white rounded-[32px] p-8 w-full max-w-md shadow-2xl"
            >
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-sm font-black text-gov-blue uppercase tracking-widest">
                    {reportModal === 'theft' ? 'Report Theft' : 'Report Stock Delay'}
                  </h3>
                  <p className="text-[9px] text-gray-400 font-bold uppercase mt-1">
                    {reportModal === 'theft' ? 'Describe the theft incident' : 'Describe the stock delay'}
                  </p>
                </div>
                <button onClick={() => setReportModal(null)} className="w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center text-gray-400 hover:text-red-500 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {reportSuccess ? (
                <div className="py-8 flex flex-col items-center gap-4">
                  <div className="w-16 h-16 bg-gov-green/10 rounded-full flex items-center justify-center">
                    <CheckCircle className="w-8 h-8 text-gov-green" />
                  </div>
                  <p className="text-xs font-black text-gov-green uppercase tracking-widest">Report Submitted Successfully</p>
                </div>
              ) : (
                <>
                  <textarea
                    className="w-full border-2 border-gray-100 rounded-2xl p-4 text-sm font-medium text-gov-blue focus:border-gov-blue outline-none resize-none transition-all"
                    rows={4}
                    placeholder={reportModal === 'theft' ? 'Describe what happened...' : 'Describe the delay and affected items...'}
                    value={reportText}
                    onChange={e => setReportText(e.target.value)}
                  />
                  <button
                    onClick={handleReport}
                    disabled={reportSubmitting || !reportText.trim()}
                    className="mt-4 w-full bg-gov-blue text-white py-4 rounded-2xl font-black uppercase tracking-widest hover:bg-opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {reportSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Submit Report'}
                  </button>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ConsumerPortal;
