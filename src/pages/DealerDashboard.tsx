import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Package, Truck, AlertCircle, ShoppingCart, X, ZoomIn } from 'lucide-react';
import Barcode from 'react-barcode';

// ─── Barcode Enlarge Modal ────────────────────────────────────────────────────
function BarcodeModal({ value, onClose }: { value: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl p-10 shadow-2xl flex flex-col items-center gap-6 max-w-lg w-full mx-4 relative"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-gray-300 hover:text-gray-600 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
        <p className="text-[10px] font-black text-gov-blue uppercase tracking-[0.3em]">Batch Barcode — Full View</p>
        <div className="bg-gray-50 p-6 rounded-2xl border border-gray-100">
          <Barcode
            value={value}
            width={2.5}
            height={100}
            fontSize={18}
            fontOptions="bold"
            lineColor="#000080"
          />
        </div>
        <p className="text-xs font-mono font-bold text-gray-400">{value}</p>
        <p className="text-[9px] text-gray-300 uppercase tracking-widest">Click outside to close</p>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function DealerDashboard() {
  const { profile } = useAuth();
  const [stock, setStock] = useState<any[]>([]);
  const [recentTrans, setRecentTrans] = useState<any[]>([]);
  const [pendingConsignments, setPendingConsignments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [enlargedBarcode, setEnlargedBarcode] = useState<string | null>(null);

  const dealerId = profile?.dealerUUID || profile?.uid;
  const displayShopId = profile?.dealerId || 'N/A';

  const fetchData = useCallback(async () => {
    if (!dealerId) return;
    try {
      const { data: invData } = await supabase
        .from('inventory')
        .select('*')
        .eq('owner_id', dealerId);
      if (invData) setStock(invData);

      const { data: txData } = await supabase
        .from('transactions')
        .select('*')
        .eq('dealer_id', dealerId)
        .order('created_at', { ascending: false })
        .limit(10);
      if (txData) setRecentTrans(txData);

      // Pending consignments allotted by admin — pull from inventory where status='created' and destination_shop_id=dealerId
      const { data: consData } = await supabase
        .from('inventory')
        .select('*')
        .eq('destination_shop_id', dealerId)
        .eq('status', 'created')
        .order('created_at', { ascending: false });
      if (consData) setPendingConsignments(consData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [dealerId]);

  useEffect(() => {
    fetchData();
    if (!dealerId) return;

    const inventoryChannel = supabase
      .channel(`dealer_inventory_${dealerId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory', filter: `owner_id=eq.${dealerId}` }, fetchData)
      .subscribe();

    const transactionsChannel = supabase
      .channel(`dealer_transactions_${dealerId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter: `dealer_id=eq.${dealerId}` }, fetchData)
      .subscribe();

    const consignmentsChannel = supabase
      .channel(`dealer_consignments_${dealerId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory', filter: `destination_shop_id=eq.${dealerId}` }, fetchData)
      .subscribe();

    return () => {
      supabase.removeChannel(inventoryChannel);
      supabase.removeChannel(transactionsChannel);
      supabase.removeChannel(consignmentsChannel);
    };
  }, [dealerId, fetchData]);

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 py-20">
      <div className="w-12 h-12 border-4 border-gov-blue border-t-gov-saffron rounded-full animate-spin"></div>
      <div className="font-bold text-gov-blue animate-pulse uppercase text-xs tracking-widest">Synchronizing Shop Data...</div>
    </div>
  );

  

  return (
    <div className="space-y-10 animate-in fade-in duration-500">
      {enlargedBarcode && (
        <BarcodeModal value={enlargedBarcode} onClose={() => setEnlargedBarcode(null)} />
      )}

      <header className="border-b border-gray-200 pb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-gov-blue uppercase tracking-tight">Fair Price Shop Monitor</h1>
          <div className="flex items-center gap-4 mt-2">
             <p className="text-[10px] font-bold uppercase text-gov-saffron bg-gov-saffron/10 px-2 py-1 rounded">
               Shop ID: {displayShopId}
             </p>
             <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Authorized Outlet • Operational</p>
          </div>
        </div>
        <div className="text-right">
           <p className="text-[10px] font-bold text-gray-300 uppercase">License Status</p>
           <p className="text-sm font-black text-gov-green uppercase">ACTIVE_VALID</p>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
         <div className="bg-white p-8 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between border-t-4 border-t-gov-saffron">
            <div>
               <p className="text-xs font-bold uppercase text-gray-400 mb-2 tracking-widest">Total Stock Available</p>
               <h2 className="text-5xl font-black text-gov-blue tracking-tighter">
                 {stock.reduce((acc, curr) => acc + (curr.quantity || 0), 0)}
                 <span className="text-lg ml-1 opacity-30 font-sans font-bold uppercase">Kg</span>
               </h2>
            </div>
            <div className="p-4 bg-gov-saffron/5 rounded-full">
              <Package className="w-10 h-10 text-gov-saffron" />
            </div>
         </div>
         <div className="bg-white p-8 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between border-t-4 border-t-gov-green">
            <div>
               <p className="text-xs font-bold uppercase text-gray-400 mb-2 tracking-widest">Recent Distributions</p>
               <h2 className="text-5xl font-black text-gov-blue tracking-tighter">{recentTrans.length}</h2>
            </div>
            <div className="p-4 bg-gov-green/5 rounded-full">
              <Truck className="w-10 h-10 text-gov-green" />
            </div>
         </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Inventory Table */}
        <div className="lg:col-span-2 bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm flex flex-col">
           <div className="p-6 bg-gov-blue text-white flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
                 <ShoppingCart className="w-4 h-4" />
                 Live Inventory Statement
              </h3>
              <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded uppercase font-bold tracking-widest flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-gov-green animate-pulse inline-block"></span>
                Live
              </span>
           </div>
           <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="p-5 text-[10px] font-bold uppercase text-gray-400 tracking-wider">Commodity</th>
                    <th className="p-5 text-[10px] font-bold uppercase text-gray-400 tracking-wider">Batch Barcode</th>
                    <th className="p-5 text-[10px] font-bold uppercase text-gray-400 tracking-wider text-right">Qty</th>
                    <th className="p-5 text-[10px] font-bold uppercase text-gray-400 tracking-wider text-right">Expiry</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {stock.map(item => (
                    <tr key={item.id} className="hover:bg-gov-offwhite transition-colors">
                      <td className="p-5">
                         <p className="text-sm font-bold text-gov-blue uppercase">{item.name}</p>
                         <p className="text-[10px] text-gray-400 font-mono tracking-tighter">SKU_{item.id.slice(0,8)}</p>
                      </td>
                      <td className="p-5">
                        {item.batch_id ? (
                          <button
                            onClick={() => setEnlargedBarcode(item.batch_id)}
                            className="group flex items-center gap-2 hover:opacity-75 transition-opacity"
                            title="Click to enlarge"
                          >
                            <div className="pointer-events-none">
                              <Barcode
                                value={item.batch_id}
                                width={1}
                                height={28}
                                fontSize={8}
                                fontOptions="bold"
                                lineColor="#000080"
                                margin={2}
                              />
                            </div>
                            <ZoomIn className="w-3 h-3 text-gov-blue opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                          </button>
                        ) : (
                          <span className="text-[9px] text-gray-300 font-bold uppercase tracking-widest">No Batch</span>
                        )}
                      </td>
                      <td className="p-5 text-right">
                         <span className={cn(
                           "inline-block px-3 py-1 rounded-full text-xs font-black",
                           item.quantity < 20 ? "bg-red-50 text-red-600 animate-pulse" : "bg-gov-green/5 text-gov-green"
                         )}>
                           {item.quantity} KG
                         </span>
                      </td>
                      <td className="p-5 text-right font-mono text-[10px] text-gray-400 font-bold">
                        {item.expiry || 'NO_EXP_SET'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {stock.length === 0 && (
                <div className="p-20 text-center text-gray-300 uppercase text-xs font-bold tracking-[0.2em]">Zero Inventory Recorded</div>
              )}
           </div>
        </div>

        {/* Right Column */}
        <div className="lg:col-span-1 space-y-6 flex flex-col">
           {/* Pending Consignments */}
           <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm border-t-4 border-t-gov-saffron">
              <h3 className="text-xs font-bold uppercase text-gov-blue mb-4 flex items-center gap-2 tracking-widest">
                 <Truck className="w-4 h-4" />
                 Pending Consignments
                 <span className="ml-auto flex items-center gap-1 text-[8px] text-gov-green font-black uppercase">
                   <span className="w-1.5 h-1.5 rounded-full bg-gov-green animate-pulse inline-block"></span>
                   Live
                 </span>
              </h3>
              {pendingConsignments.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-6 text-gray-300">
                   <AlertCircle className="w-8 h-8 mb-2 opacity-20" />
                   <p className="text-[10px] font-bold uppercase tracking-widest">All Deliveries Current</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {pendingConsignments.map(c => (
                    <div key={c.id} className="p-3 bg-gov-saffron/5 rounded-xl border border-gov-saffron/10">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-[10px] font-black text-gov-blue uppercase leading-none mb-1">
                            {c.name || 'Allotment'}
                          </p>
                          <p className="text-[9px] text-gray-400 font-bold uppercase">
                            Qty: {c.quantity || '—'} KG
                          </p>
                          {c.batch_id && (
                            <p className="text-[8px] text-gray-300 font-mono mt-1">Batch: {c.batch_id}</p>
                          )}
                        </div>
                        <span className="text-[8px] bg-gov-saffron/20 text-gov-saffron font-black uppercase px-2 py-0.5 rounded-full">
                          PENDING
                        </span>
                      </div>
                      {c.created_at && (
                        <p className="text-[8px] text-gray-300 font-mono mt-2">
                          {new Date(c.created_at).toLocaleString()}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
           </div>

           {/* Recent TX Nodes */}
           <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex-1 flex flex-col">
              <h3 className="text-xs font-bold uppercase text-gov-blue mb-6 tracking-widest flex items-center gap-2">
                Recent TX Nodes
                <span className="ml-auto flex items-center gap-1 text-[8px] text-gov-green font-black uppercase">
                  <span className="w-1.5 h-1.5 rounded-full bg-gov-green animate-pulse inline-block"></span>
                  Live
                </span>
              </h3>
              <div className="space-y-4 flex-1">
                 {recentTrans.map(tx => (
                    <div key={tx.id} className="p-3 bg-gov-offwhite rounded-lg border-l-4 border-gov-blue transition-all">
                       <p className="text-[10px] font-bold text-gov-blue uppercase leading-none mb-1">REF_{tx.id.slice(0,6)}</p>
                       <div className="flex justify-between items-center">
                          <p className="text-[9px] text-gray-400 font-bold uppercase">
                            Citizen: ...{(tx.beneficiary_id || tx.beneficiaryId || '????').toString().slice(-4)}
                          </p>
                          <p className="text-[8px] text-gray-400 font-medium italic">
                            {(tx.timestamp || tx.created_at)
                              ? (typeof (tx.timestamp || tx.created_at) === 'string'
                                  ? new Date(tx.timestamp || tx.created_at).toLocaleTimeString()
                                  : new Date((tx.timestamp || tx.created_at)?.seconds * 1000).toLocaleTimeString())
                              : '—'}
                          </p>
                       </div>
                    </div>
                 ))}
                 {recentTrans.length === 0 && (
                   <p className="text-[10px] text-gray-300 font-bold uppercase tracking-widest text-center mt-10 italic">No Activity Logged</p>
                 )}
              </div>
              <div className="mt-8 pt-4 border-t border-gray-50">
                 <button className="w-full text-[9px] font-bold uppercase text-gov-blue hover:text-gov-saffron transition-colors tracking-widest underline underline-offset-4">Full Distribution Audit</button>
              </div>
           </div>
        </div>
      </div>
    </div>
  );
}

function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(' ');
}
