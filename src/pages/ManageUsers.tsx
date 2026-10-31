import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Users, Plus, Trash2, Loader2, UserPlus, CreditCard } from 'lucide-react';

export default function ManageUsers() {
  const [beneficiaries, setBeneficiaries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  const [formData, setFormData] = useState({
    name: '',
    id: `RATION-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
    familySize: 2,
    entitlement: {
      rice: 10,
      wheat: 5,
      sugar: 1,
      kerosene: 2
    }
  });

  const fetchBeneficiaries = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('beneficiaries')
        .select('*');
      
      if (error) throw error;
      setBeneficiaries(data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBeneficiaries();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      // 1. Add to beneficiaries table for entitlement tracking
      const { error: bError } = await supabase
        .from('beneficiaries')
        .insert([{
          id: formData.id,
          name: formData.name,
          family_size: formData.familySize,
          entitlement: formData.entitlement,
          created_at: new Date().toISOString()
        }]);

      if (bError) throw bError;

      // Note: We don't manually insert into 'users' table here anymore 
      // because 'users.id' requires a real Supabase Auth UUID.
      // In a real app, you'd use a cloud function to create the auth user first.

      setFormData({
        name: '',
        id: `RATION-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
        familySize: 2,
        entitlement: { rice: 10, wheat: 5, sugar: 1, kerosene: 2 }
      });
      fetchBeneficiaries();
    } catch (err) {
      console.error(err);
      alert('ENROLLMENT_FAILED: Registry synchronization error.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('CONFIRM_REMOVAL: Are you sure you want to revoke this Ration Card and remove the citizen from the national registry?')) return;
    try {
      // 1. Remove from entitlement registry
      const { error: bError } = await supabase
        .from('beneficiaries')
        .delete()
        .eq('id', id);

      if (bError) throw bError;

      // 2. Remove from identity registry (if it exists)
      await supabase.from('users').delete().eq('business_id', id);

      fetchBeneficiaries();
      alert('REGISTRY_UPDATED: Beneficiary successfully removed.');
    } catch (err) {
      console.error(err);
      alert('ACTION_FAILED: Could not remove beneficiary. Please check your permissions.');
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header className="border-b border-gray-200 pb-4">
        <h1 className="text-3xl font-black text-gov-blue uppercase tracking-tight">Beneficiary Registry</h1>
        <p className="text-gray-500 text-xs mt-1 uppercase tracking-wider font-bold">National Citizen Identity & Eligibility Database</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Registration Form */}
        <div className="lg:col-span-1">
          <div className="bg-white p-8 rounded-2xl border border-gray-100 shadow-sm border-t-8 border-t-gov-saffron sticky top-10 h-fit">
            <h2 className="text-sm font-black text-gov-blue uppercase mb-8 flex items-center gap-2 tracking-widest">
              <UserPlus className="w-5 h-5 text-gov-saffron" />
              Citizen Enrollment
            </h2>
            <form onSubmit={handleAdd} className="space-y-6">
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 block">Full Legal Name</label>
                <input 
                  type="text" 
                  value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                  required
                  className="w-full border-2 border-gray-100 rounded-xl p-3 text-sm focus:border-gov-blue outline-none transition-colors font-bold text-gov-blue" 
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                 <div>
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 block">Family Strength</label>
                    <input 
                      type="number" 
                      value={formData.familySize}
                      onChange={e => setFormData({...formData, familySize: Number(e.target.value)})}
                      required
                      className="w-full border-2 border-gray-100 rounded-xl p-3 text-sm focus:border-gov-blue outline-none transition-colors font-bold text-gov-blue" 
                    />
                 </div>
                 <div>
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 block">Generated RC ID</label>
                    <input 
                      type="text" 
                      readOnly
                      value={formData.id}
                      className="w-full border-2 border-gray-50 rounded-xl p-3 text-[10px] bg-gov-offwhite font-mono font-bold text-gray-400 outline-none" 
                    />
                 </div>
              </div>
              
              <div className="pt-4 border-t border-gray-50">
                 <p className="text-[10px] font-bold text-gov-blue/40 uppercase tracking-widest mb-4 italic underline decoration-gov-saffron decoration-2">Monthly Commodity Allocation (KG)</p>
                 <div className="grid grid-cols-2 gap-3">
                    {Object.entries(formData.entitlement).map(([item, qty]) => (
                      <div key={item} className="flex flex-col">
                         <label className="text-[8px] uppercase font-bold text-gray-300 tracking-tighter mb-1">{item}</label>
                         <input 
                           type="number"
                           value={qty}
                           onChange={e => setFormData({
                             ...formData, 
                             entitlement: {...formData.entitlement, [item]: Number(e.target.value)}
                           })}
                           className="border border-gray-100 rounded-lg p-2 text-xs font-bold text-gov-blue focus:border-gov-green/30 outline-none transition-all"
                         />
                      </div>
                    ))}
                 </div>
              </div>

              <button 
                disabled={saving}
                className="w-full bg-gov-blue text-white py-4 rounded-xl font-bold uppercase tracking-widest shadow-lg hover:shadow-gov-blue/20 transition-all flex items-center justify-center gap-2"
              >
                {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Authorize Enrollment'}
              </button>
            </form>
          </div>
        </div>

        {/* List */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between">
             <h2 className="text-[10px] font-bold uppercase text-gray-400 tracking-[0.2em]">Enrolled Citizen Base</h2>
             <span className="text-[10px] font-black py-1 px-3 bg-gov-blue/5 text-gov-blue rounded-full uppercase tracking-tighter">Verified Registry</span>
          </div>

          <div className="space-y-4">
            {beneficiaries.map((citizen) => (
              <div key={citizen.id} className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-xl hover:border-gov-blue/20 transition-all group relative overflow-hidden">
                <div className="absolute top-0 right-0 w-1.5 h-full bg-gov-green/10"></div>
                <div className="flex justify-between items-start relative z-10">
                  <div className="flex gap-5 items-center">
                    <div className="w-14 h-14 bg-gov-blue/5 text-gov-blue flex items-center justify-center rounded-2xl font-black text-xl border border-gov-blue/10">
                      {citizen.name[0]?.toUpperCase()}
                    </div>
                    <div>
                      <h3 className="text-lg font-black text-gov-blue uppercase tracking-tight leading-none mb-1">{citizen.name}</h3>
                      <p className="text-[10px] font-mono font-bold text-gray-400 bg-gov-offwhite px-2 py-0.5 rounded-full inline-block">{citizen.id}</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleDelete(citizen.id)}
                    className="p-2.5 text-red-600 bg-red-50 rounded-xl hover:bg-red-500 hover:text-white transition-all border border-red-100 flex items-center justify-center shadow-sm"
                    title="Revoke Ration Card"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
                  <div className="p-4 bg-gov-offwhite rounded-xl border border-gray-50 flex flex-col justify-center">
                     <p className="text-[8px] font-bold text-gray-300 uppercase tracking-widest mb-1">Unit Strength</p>
                     <p className="text-xs font-black text-gov-blue">{citizen.family_size} Members</p>
                  </div>
                  <div className="md:col-span-3 p-4 bg-gov-offwhite rounded-xl border border-gray-50">
                     <p className="text-[8px] font-bold text-gray-300 uppercase tracking-widest mb-2 italic">Approved Allocation Plan</p>
                     <div className="flex gap-x-6 gap-y-2 flex-wrap">
                        {Object.entries(citizen.entitlement).map(([item, qty]: [string, any]) => (
                          <div key={item} className="flex flex-col font-bold">
                            <span className="uppercase text-[8px] text-gray-400 leading-none mb-0.5 tracking-tighter">{item}</span>
                            <span className="text-xs text-gov-blue">{qty} KG</span>
                          </div>
                        ))}
                     </div>
                  </div>
                </div>
              </div>
            ))}
            {beneficiaries.length === 0 && !loading && (
              <div className="py-24 text-center border-2 border-dashed border-gray-200 rounded-3xl">
                <Users className="w-12 h-12 mx-auto mb-4 opacity-10 text-gov-blue" />
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Regional Registry Empty</p>
              </div>
            )}
            {loading && (
              <div className="py-20 flex flex-col items-center gap-4">
                 <div className="w-10 h-10 border-4 border-gov-blue border-t-transparent rounded-full animate-spin"></div>
                 <p className="text-[9px] font-bold text-gov-blue uppercase tracking-widest animate-pulse">Syncing National Database...</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
