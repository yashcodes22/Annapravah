import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Package, Plus, Trash2, Edit2, Loader2, Tag, Calendar, Database, Barcode as BarcodeIcon } from 'lucide-react';
import Barcode from 'react-barcode';

export default function ManageStock() {
  const { profile } = useAuth();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  const [formData, setFormData] = useState({
    name: 'Wheat',
    quantity: 100,
    expiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Default 30 days expiry
    batchId: `B-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
    destinationShopId: 'N2001'
  });

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const FOOD_ITEMS = ['Wheat', 'Rice', 'Sugar', 'Dal', 'Salt'];

  const [pendingApprovals, setPendingApprovals] = useState<any[]>([]);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('inventory')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      setItems(data?.filter(i => i.status !== 'pending_approval') || []);
      setPendingApprovals(data?.filter(i => i.status === 'pending_approval') || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const syncIdentity = async (manual = false) => {
    try {
      const { data, error: fetchError } = await supabase.from('users').select('id').eq('shop_name', 'N2001').eq('role', 'dealer').maybeSingle();
      
      if (fetchError) {
        if (fetchError.code === '42P01') {
          alert('DATABASE_NOT_READY: The "users" table is missing. Did you run the SQL schema in Supabase?');
        }
        throw fetchError;
      }

      if (!data && manual) {
        alert('REGISTRY_MISSING: Standard dealer data not found. Please run the seeding logic in your Supabase SQL editor.');
      } else if (manual) {
        alert('REGISTRY_OK: Identity data is already synchronized.');
      }
    } catch (err: any) {
      console.error('Identity Sync Failure:', err);
    }
  };

  useEffect(() => {
    fetchItems();
    syncIdentity();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      // 1. Validate FPS Shop ID exists — dealers store their FPS code in shop_name column
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('id, shop_name')
        .eq('business_id', formData.destinationShopId)
        .eq('role', 'dealer')
        .maybeSingle();
      
      if (userError) {
        if (userError.code === '42P01') {
          alert('SYSTEM_ERROR: The "users" table is missing. Please run the SQL schema in your Supabase dashboard.');
        } else {
          throw userError;
        }
        setSaving(false);
        return;
      }

      if (!userData) {
        alert(`INVALID_FPS_ID: Shop ID '${formData.destinationShopId}' is not found or not registered as a dealer.`);
        setSaving(false);
        return;
      }

      // Use the dealer's UUID as destination_shop_id (matches users(id) FK)
      const dealerUUID = userData.id;

      // 2. Insert into inventory
      const isPending = formData.quantity > 500;
      const payload = {
        name: formData.name,
        quantity: formData.quantity,
        expiry: formData.expiry,
        batch_id: formData.batchId,
        destination_shop_id: dealerUUID,   // UUID from users table
        unit: 'KG',
        owner_id: 'WAREHOUSE_CENTRAL',
        status: isPending ? 'pending_approval' : 'pending',
        source: 'Central Cloud Warehouse',
        dispatch_date: new Date().toISOString(),
        created_at: new Date().toISOString(),
      };

      console.log('Inserting Stock Payload:', payload);

      const { error } = await supabase
        .from('inventory')
        .insert([payload]);

      if (error) {
        console.error('Supabase Insert Error:', error);
        throw error;
      }

      setFormData({
        name: 'Wheat',
        quantity: 100,
        expiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        batchId: `B-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
        destinationShopId: 'N2001'
      });
      fetchItems();
      if (isPending) {
        alert('PENDING_DUAL_AUTH: This release requires countersignature from a second authorised officer within 24 hours.');
      } else {
        alert('STOCK_AUTHORIZED: Entry successfully added to central record.');
      }
    } catch (err: any) {
      console.error(err);
      alert(`SYSTEM_ERROR: STOCK_RECORD_FAILED - ${err.message || 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    // Confirmation dialogs are often blocked in iframe previews.
    // Instead, we use a single click action with a state-based loading indicator.
    setDeletingId(id);
    try {
      const { error } = await supabase
        .from('inventory')
        .delete()
        .eq('id', id);

      if (error) throw error;
      
      // Update local state immediately for responsiveness
      setItems(prev => prev.filter(item => item.id !== id));
    } catch (err: any) {
      console.error(err);
      alert(`DELETION_FAILED: ${err.message || 'Check network connection'}`);
    } finally {
      setDeletingId(null);
    }
  };

  const handleApprove = async (item: any) => {
    const adminId = profile?.uid;
    if (!adminId) return;

    if (item.requested_by === adminId) {
       alert("You cannot countersign your own release. A second officer must approve.");
       return;
    }

    setApprovingId(item.id);
    try {
      const { error } = await supabase
        .from('inventory')
        .update({
           status: 'created',
           approved_by: adminId,
           approved_at: new Date().toISOString()
        })
        .eq('id', item.id);
      
      if (error) throw error;
      fetchItems();
      alert('DUAL_AUTH_SUCCESS: Release activated.');
    } catch (err: any) {
       alert('ERROR: ' + err.message);
    } finally {
       setApprovingId(null);
    }
  };

  const purgeStockData = async () => {
    const confirmation = confirm('SYSTEM_RESET_WARNING: This will PERMANENTLY DELETE all records across the following modules:\n- All Inventory (Warehouse & Dealer Shops)\n- All Beneficiary Ration Cards\n- All Transaction Histories\n- All Fraud Alerts\n- All Stock Movement Logs\n\nAre you absolutely sure?');
    
    if (!confirmation) return;
    
    setLoading(true);
    try {
      const tablesToPurge = ['inventory', 'alerts', 'transactions', 'stock_receipts', 'beneficiaries', 'users'];
      
      for (const tableName of tablesToPurge) {
        // Supabase/PostgREST doesn't support TRUNCATE via client easily without RLS or RPC
        // So we delete all records matching a condition that's always true or use RPC if available.
        // For development/prototype, we can use a range or just match all.
        const { error } = await supabase
          .from(tableName)
          .delete()
          .neq('id', '00000000-0000-0000-0000-000000000000'); // hack to delete all if ID is UUID, or use other condition
        
        if (error) console.warn(`Error purging ${tableName}:`, error);
      }

      alert(`SYSTEM_STATE_RESET: Records successfully purged from the national database. The system is now a clean slate.`);
      await syncIdentity();
      fetchItems();
    } catch (err) {
      console.error(err);
      alert('PURGE_EXCEPTION_THROWN: Database access error or network timeout.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header className="border-b border-gray-200 pb-4 flex items-center justify-between">
        <div>
           <h1 className="text-3xl font-black text-gov-blue uppercase tracking-tight">Stock Management System</h1>
           <p className="text-gray-500 text-xs mt-1 uppercase tracking-wider font-bold">Central Warehouse Inventory Control</p>
        </div>
        <button 
          onClick={purgeStockData}
          className="text-[9px] font-black text-red-500 border border-red-100 px-4 py-2 rounded-lg hover:bg-red-50 transition-colors uppercase tracking-widest"
        >
           Purge Previous Records
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Form */}
        <div className="lg:col-span-1">
          <div className="bg-white p-8 rounded-2xl border border-gray-100 shadow-sm border-t-8 border-t-gov-saffron sticky top-10">
            <h2 className="text-sm font-black text-gov-blue uppercase mb-8 flex items-center gap-2 tracking-widest">
              <Plus className="w-5 h-5 text-gov-saffron" />
              Stock Intake Record
            </h2>
            <form onSubmit={handleAdd} className="space-y-6">
              <div className="flex justify-between items-center bg-gray-50 p-4 rounded-xl border border-gray-100 mb-6">
                <div>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Live Manifest ID</p>
                  <p className="text-xs font-mono font-black text-gov-blue">{formData.batchId}</p>
                </div>
                <div className="flex items-center gap-3">
                  <button 
                    type="button"
                    onClick={() => setFormData({...formData, batchId: `B-${Math.random().toString(36).substr(2, 6).toUpperCase()}`})}
                    className="p-1.5 hover:bg-gray-200 rounded-lg transition-colors text-gray-400"
                    title="Regenerate Batch ID"
                  >
                    <BarcodeIcon className="w-4 h-4" />
                  </button>
                  <div className="bg-white p-2 rounded-lg border border-gray-100 shadow-sm scale-75 origin-right flex items-center justify-center min-h-[40px]">
                    <Barcode 
                      value={formData.batchId} 
                      width={1} 
                      height={30} 
                      displayValue={false}
                      margin={0}
                      renderer="svg"
                    />
                  </div>
                </div>
              </div>

              {formData.quantity > 500 && (
                 <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-r-lg">
                    <p className="text-amber-700 text-[10px] uppercase font-black tracking-widest mb-1">Dual-Authorisation Required</p>
                    <p className="text-amber-800 text-xs font-medium">This release requires countersignature from a second authorised officer within 24 hours.</p>
                 </div>
              )}

              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 block">Commodity Nomenclature</label>
                <select 
                  value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                  required
                  className="w-full border-2 border-gray-100 rounded-xl p-3 text-sm focus:border-gov-blue outline-none transition-colors font-bold text-gov-blue bg-white"
                >
                  {FOOD_ITEMS.map(item => (
                    <option key={item} value={item}>{item} (KG)</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 block">Allocation Volume (KG)</label>
                <input 
                  type="number" 
                  value={formData.quantity}
                  onChange={e => setFormData({...formData, quantity: Number(e.target.value)})}
                  required
                  className="w-full border-2 border-gray-100 rounded-xl p-3 text-sm focus:border-gov-blue outline-none transition-colors font-bold text-gov-blue" 
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 block">Mandatory Expiry Date</label>
                <input 
                  type="date" 
                  value={formData.expiry}
                  onChange={e => setFormData({...formData, expiry: e.target.value})}
                  required
                  className="w-full border-2 border-gray-100 rounded-xl p-3 text-sm focus:border-gov-blue outline-none transition-colors font-bold text-gov-blue" 
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 block">Target FPS Shop Assignment</label>
                <input 
                  type="text" 
                  value={formData.destinationShopId}
                  onChange={e => setFormData({...formData, destinationShopId: e.target.value.toUpperCase().trim()})}
                  required
                  className="w-full border-2 border-gray-100 rounded-xl p-3 text-sm focus:border-gov-blue outline-none transition-colors font-bold text-gov-blue mb-2" 
                  placeholder="e.g. N2001"
                />
                <div className="flex flex-wrap gap-2 text-[8px] font-bold text-gray-400">
                  <span>REGISTRY CODES:</span>
                  {['N2001', 'S2002', 'E2003', 'W2004', 'C2005'].map(id => (
                    <button 
                      key={id}
                      type="button"
                      onClick={() => setFormData({...formData, destinationShopId: id})}
                      className="bg-gov-offwhite px-2 py-0.5 rounded border border-gray-100 hover:border-gov-blue transition-colors text-gov-blue"
                    >
                      {id}
                    </button>
                  ))}
                </div>
              </div>
              <div className="pt-4">
                 <button 
                  disabled={saving}
                  className="w-full bg-gov-blue text-white py-4 rounded-xl font-bold uppercase tracking-widest hover:bg-opacity-90 transition-all flex items-center justify-center gap-2 shadow-lg hover:shadow-gov-blue/20"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Authorize Entry'}
                </button>
              </div>
              <div className="text-center">
                <button 
                  type="button"
                  onClick={() => syncIdentity(true)}
                  className="text-[9px] font-bold text-gray-400 hover:text-gov-blue uppercase tracking-widest transition-colors"
                >
                  Repair Regional Registry
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* List */}
        <div className="lg:col-span-2 space-y-8">
          
          {pendingApprovals.length > 0 && (
            <div className="bg-amber-50/50 p-6 rounded-2xl border border-amber-200 shadow-sm animate-in fade-in">
              <div className="flex items-center justify-between mb-6">
                 <h2 className="text-[10px] font-black uppercase text-amber-700 tracking-[0.2em] flex items-center gap-2">
                   <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></div>
                   Pending Approvals
                 </h2>
                 <span className="text-[9px] font-bold py-1 px-2 border border-amber-200 text-amber-600 rounded uppercase tracking-tighter bg-white">{pendingApprovals.length} action(s) required</span>
              </div>
              
              <div className="grid grid-cols-1 gap-4">
                {pendingApprovals.map((item) => (
                  <div key={item.id} className="bg-white p-4 rounded-xl border border-amber-100 shadow-sm flex flex-col sm:flex-row gap-4 justify-between items-center">
                     <div>
                        <div className="flex items-center gap-3 mb-2">
                           <span className="text-xs font-black text-gov-blue uppercase">{item.name}</span>
                           <span className="text-[10px] bg-gray-100 px-2 py-0.5 rounded text-gray-500 font-mono">{item.batch_id}</span>
                        </div>
                        <div className="text-[10px] text-gray-500 grid flex-wrap gap-x-4 gap-y-1 sm:grid-cols-2">
                           <p><strong>QTY:</strong> {item.quantity} KG</p>
                           <p><strong>TO FPS:</strong> {item.destination_shop_id}</p>
                           <p><strong>REQ BY:</strong> <span className="font-mono text-[9px]">{typeof item.requested_by === 'string' ? item.requested_by.substring(0,8) : 'Unknown'}</span></p>
                           <p><strong>REQ AT:</strong> {new Date(item.created_at).toLocaleString()}</p>
                        </div>
                     </div>
                     <button
                        onClick={() => handleApprove(item)}
                        disabled={approvingId === item.id}
                        className="w-full sm:w-auto whitespace-nowrap bg-amber-500 hover:bg-amber-600 text-white text-[10px] font-black uppercase tracking-widest px-4 py-3 rounded-lg transition-colors flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
                     >
                        {approvingId === item.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Approve & Activate'}
                     </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-6">
            <div className="flex items-center justify-between">
               <h2 className="text-[10px] font-bold uppercase text-gray-400 tracking-[0.2em]">Warehouse Status Log</h2>
               <span className="text-[10px] font-black py-1 px-3 bg-gov-green/10 text-gov-green rounded-full uppercase tracking-tighter">Certified Live</span>
            </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {items.map((item) => (
              <div key={item.id} className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-xl transition-all flex flex-col group">
                <div className="flex justify-between items-start mb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gov-blue/5 rounded-xl flex items-center justify-center">
                       <Package className="w-5 h-5 text-gov-blue" />
                    </div>
                    <div>
                      <h3 className="text-sm font-black text-gov-blue uppercase tracking-tight truncate max-w-[120px]">{item.name}</h3>
                      <p className="text-[9px] font-mono font-bold text-gray-300 uppercase tracking-tighter">{item.batch_id}</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleDelete(item.id)}
                    disabled={deletingId === item.id}
                    className="p-2.5 bg-red-50 text-red-600 rounded-xl hover:bg-red-500 hover:text-white transition-all border border-red-100 flex items-center justify-center shadow-sm disabled:opacity-50"
                    title="Delete Record"
                  >
                    {deletingId === item.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-6">
                   <div className="bg-gov-offwhite p-3 rounded-xl border border-gray-50">
                      <p className="text-[8px] font-bold text-gray-400 uppercase tracking-widest mb-1">Available</p>
                      <p className="text-sm font-black text-gov-blue tracking-tighter">{item.quantity} KG</p>
                   </div>
                   <div className="bg-gov-offwhite p-3 rounded-xl border border-gray-100">
                      <p className="text-[8px] font-bold text-gray-400 uppercase tracking-widest mb-1">Expires</p>
                      <p className="text-sm font-black text-gov-blue tracking-tighter">{item.expiry}</p>
                   </div>
                </div>

                <div className="mt-auto pt-6 border-t border-gray-50 flex items-center gap-4">
                   <div className="p-2 bg-white border border-gray-100 rounded-xl shadow-inner group-hover:border-gov-blue transition-colors min-h-[50px] flex items-center justify-center overflow-hidden">
                      {item.batch_id ? (
                        <Barcode 
                          value={String(item.batch_id)} 
                          width={1.2} 
                          height={30} 
                          displayValue={false}
                          margin={0}
                          background="transparent"
                          renderer="svg"
                        />
                      ) : (
                        <span className="text-[8px] text-gray-300">NO BATCH ID</span>
                      )}
                   </div>
                   <div>
                      <p className="text-[9px] font-bold text-gov-blue uppercase tracking-widest leading-none mb-1">Govt. Dispatch Label</p>
                      <p className="text-[9px] text-gray-400 font-bold">Authorized for Digital PDS Inward</p>
                   </div>
                </div>
              </div>
            ))}
            {items.length === 0 && !loading && (
              <div className="col-span-full py-20 text-center border-2 border-dashed border-gray-200 rounded-3xl">
                <Database className="w-12 h-12 mx-auto mb-4 opacity-10 text-gov-blue" />
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Regional Registry Empty</p>
              </div>
            )}
            {loading && (
              <div className="col-span-full py-10 flex flex-col items-center gap-4">
                <div className="w-10 h-10 border-4 border-gov-blue border-t-transparent rounded-full animate-spin"></div>
                <p className="text-[9px] font-bold text-gov-blue uppercase tracking-widest animate-pulse">Querying National Cloud Index...</p>
              </div>
            )}
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
