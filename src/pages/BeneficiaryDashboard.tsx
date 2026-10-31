import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { CreditCard, History, Package, ShieldCheck, HelpCircle, QrCode } from 'lucide-react';
import Barcode from 'react-barcode';

export default function BeneficiaryDashboard() {
  const { profile } = useAuth();
  const [lastTx, setLastTx] = useState<any>(null);
  const [beneficiaryInfo, setBeneficiaryInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) return;
    
    const fetchData = async () => {
      try {
        // Fetch beneficiary record
        if (profile.beneficiaryId) {
            const { data: bData } = await supabase
              .from('beneficiaries')
              .select('*')
              .eq('id', profile.beneficiaryId)
              .limit(1);
            
            if (bData && bData.length > 0) {
                setBeneficiaryInfo(bData[0]);
            }
        }

        // Fetch last transaction
        const { data: txData } = await supabase
          .from('transactions')
          .select('*')
          .eq('beneficiary_id', profile.beneficiaryId || profile.uid)
          .order('timestamp', { ascending: false })
          .limit(1);
        
        if (txData && txData.length > 0) {
            setLastTx(txData[0]);
        }

      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [profile]);

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 py-20">
      <div className="w-12 h-12 border-4 border-gov-blue border-t-gov-saffron rounded-full animate-spin"></div>
      <div className="font-bold text-gov-blue animate-pulse uppercase text-xs tracking-widest">Accessing Your Secure Record...</div>
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto space-y-10 animate-in fade-in duration-500">
      <header className="border-b border-gray-200 pb-6 flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-black text-gov-blue uppercase tracking-tight">Citizen Ration Portal</h1>
          <p className="text-gray-500 text-sm mt-1 uppercase tracking-wider font-medium font-mono italic">National PDS Digital Gateway</p>
        </div>
        <div className="text-right hidden md:block">
           <p className="text-[10px] font-bold text-gov-saffron uppercase">Encryption Status</p>
           <p className="text-sm font-black text-gov-green uppercase">E2EE_SECURE</p>
        </div>
      </header>

      {!beneficiaryInfo ? (
        <div className="bg-white border-2 border-dashed border-gray-200 p-16 text-center rounded-3xl">
           <div className="p-4 bg-gray-50 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-6">
              <HelpCircle className="w-10 h-10 text-gray-300" />
           </div>
           <p className="text-lg font-bold text-gov-blue uppercase mb-2">Record Not Located</p>
           <p className="text-sm text-gray-400 max-w-xs mx-auto mb-8">Your digital profile is not associated with a beneficiary ID. Please contact your local FPS Dealer.</p>
           <button className="bg-gov-blue text-white px-8 py-3 rounded-full text-xs font-bold uppercase tracking-widest shadow-lg hover:bg-opacity-90 transition-all">Request Verification</button>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Quick Scan Section */}
          <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6 overflow-hidden relative group">
             <div className="absolute top-0 left-0 w-1 h-full bg-gov-saffron"></div>
             <div className="flex items-center gap-4 relative z-10 text-center md:text-left">
                <div className="p-3 bg-gov-saffron/10 rounded-2xl">
                   <QrCode className="w-8 h-8 text-gov-saffron" />
                </div>
                <div>
                   <h3 className="text-sm font-black text-gov-blue uppercase tracking-widest">Digital Distribution Key</h3>
                   <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Present this code to the FPS Dealer for verification</p>
                </div>
             </div>
             
             <div className="bg-white px-6 py-2 rounded-2xl border border-gray-50 shadow-inner group-hover:scale-105 transition-transform min-h-[80px] flex items-center justify-center">
                <Barcode 
                  value={beneficiaryInfo.id} 
                  width={1.5} 
                  height={50} 
                  fontSize={10}
                  fontOptions="bold"
                  text={beneficiaryInfo.id}
                  lineColor="#000080"
                  background="#ffffff"
                  renderer="canvas"
                />
             </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
           {/* Card 1: Identity */}
           <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm relative overflow-hidden group hover:shadow-xl transition-all border-t-8 border-t-gov-saffron h-full flex flex-col justify-between">
              <CreditCard className="absolute -right-4 -bottom-4 w-32 h-32 text-gov-saffron/5 group-hover:scale-110 transition-transform" />
              <div className="relative z-10">
                 <div className="flex justify-between items-start mb-10">
                    <div>
                       <p className="text-[10px] font-black uppercase text-gov-saffron tracking-[0.2em] mb-1">Ration Card Identity</p>
                       <h3 className="text-2xl font-black text-gov-blue uppercase tracking-tight">{beneficiaryInfo.name}</h3>
                    </div>
                    <div className="w-10 h-10 bg-gov-blue flex items-center justify-center rounded-xl shadow-lg">
                       <ShieldCheck className="w-6 h-6 text-white" />
                    </div>
                 </div>
                 
                 <div className="space-y-4">
                    <div className="flex justify-between items-center border-b border-gray-50 pb-2">
                       <span className="text-[10px] uppercase font-bold text-gray-300 tracking-wider">Unique Digital ID</span>
                       <span className="text-sm font-mono font-bold text-gov-blue">{beneficiaryInfo.id}</span>
                    </div>
                    <div className="flex justify-between items-center border-b border-gray-50 pb-2">
                       <span className="text-[10px] uppercase font-bold text-gray-300 tracking-wider">Declared Family Size</span>
                       <span className="text-sm font-bold text-gov-blue">{beneficiaryInfo.family_size} Members</span>
                    </div>
                    <div className="flex justify-between items-center border-b border-gray-50 pb-2">
                       <span className="text-[10px] uppercase font-bold text-gray-300 tracking-wider">Category</span>
                       <span className="text-[10px] font-bold py-1 px-2 bg-gov-blue text-white rounded uppercase ring-2 ring-gov-blue/20 tracking-tighter shadow-sm">Priority Household</span>
                    </div>
                 </div>
              </div>
           </div>

           {/* Card 2: Quota */}
           <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm border-t-8 border-t-gov-green group hover:shadow-xl transition-all h-full">
              <div className="flex items-center gap-3 mb-8">
                 <div className="p-3 bg-gov-green/5 rounded-2xl">
                    <Package className="w-6 h-6 text-gov-green" />
                 </div>
                 <h3 className="text-sm font-black uppercase text-gov-blue tracking-widest leading-none">Monthly Entitlement</h3>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                 {Object.entries(beneficiaryInfo.entitlement).map(([item, qty]: [string, any]) => (
                    <div key={item} className="p-4 bg-gov-offwhite rounded-2xl border border-gray-50 text-center hover:border-gov-green/20 transition-colors">
                       <p className="text-[10px] font-bold text-gray-400 mb-1 uppercase tracking-tighter">{item}</p>
                       <p className="text-xl font-black text-gov-blue leading-none">{qty}<span className="text-[9px] ml-0.5 opacity-30">KG</span></p>
                    </div>
                 ))}
              </div>
              <p className="mt-8 text-[9px] text-center text-gray-400 font-bold uppercase tracking-widest leading-relaxed">Entitlement reflects the balance available for the current dispatch cycle.</p>
           </div>

           {/* Full Width: Last Activity */}
           <div className="lg:col-span-2 bg-gov-blue text-white p-8 rounded-3xl shadow-lg border-b-8 border-b-gov-saffron/20 overflow-hidden relative">
              <div className="absolute top-0 right-0 w-64 h-full bg-white/5 skew-x-[30deg] translate-x-32 hidden lg:block"></div>
              <div className="relative z-10">
                 <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-4">
                       <div className="p-2 bg-white/10 rounded-lg border border-white/10 shadow-inner">
                          <History className="w-5 h-5 text-gov-saffron" />
                       </div>
                       <h3 className="text-sm font-bold uppercase tracking-widest">Recent Distribution Snapshot</h3>
                    </div>
                    <span className="text-[10px] font-mono opacity-40 hidden md:block uppercase tracking-widest">Synchronized Legacy Index</span>
                 </div>

                 {lastTx ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
                       <div className="space-y-4">
                          <div className="flex items-baseline gap-2">
                             <p className="text-4xl font-black tracking-tighter">
                                {Object.entries(lastTx.items).map(([name, qty]: [string, any]) => `${qty}${name.substring(0,1).toUpperCase()}`).join(' ')}
                             </p>
                             <span className="text-[10px] font-bold uppercase opacity-40">Successfully Collected</span>
                          </div>
                          
                          <div className="space-y-3 pt-2">
                             <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-widest opacity-60 bg-white/5 p-2 rounded-lg border border-white/5 w-fit">
                                <History className="w-3 h-3 text-gov-saffron" />
                                <span>Discharged: {new Date(lastTx.timestamp).toLocaleString()}</span>
                             </div>
                             <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-widest opacity-60 bg-white/5 p-2 rounded-lg border border-white/5 w-fit">
                                <Package className="w-3 h-3 text-gov-saffron" />
                                <span>Outlet ID: {lastTx.dealer_id}</span>
                             </div>
                          </div>
                       </div>

                       <div className="bg-white/5 p-6 rounded-2xl border border-white/5 backdrop-blur-sm">
                          <p className="text-[10px] font-black uppercase text-gov-saffron/60 mb-3 border-b border-white/10 pb-2 tracking-widest">Digital Receipt Reference</p>
                          <p className="text-xs font-mono font-bold tracking-widest break-all leading-relaxed whitespace-pre-wrap">{lastTx.id}</p>
                          <div className="mt-4 pt-4 border-t border-white/10 text-center">
                             <button className="text-[9px] font-black uppercase text-gov-saffron hover:underline underline-offset-4 tracking-[0.2em] transition-colors">Generate Certificate</button>
                          </div>
                       </div>
                    </div>
                 ) : (
                    <div className="py-12 text-center bg-white/5 rounded-2xl border border-white/5 border-dashed border-white/20">
                       <p className="text-[10px] font-bold uppercase opacity-30 tracking-[0.3em] font-mono italic">Zero Distribution History Found In Portal</p>
                    </div>
                 )}
              </div>
           </div>
        </div>
     </div>
   )}

      {/* Footer Branding */}
      <footer className="pt-20 pb-10 flex flex-col items-center gap-6">
         <div className="flex justify-center gap-8 items-center opacity-30 grayscale hover:grayscale-0 transition-all duration-700">
            <span className="text-[10px] font-bold uppercase tracking-widest">Digital India</span>
            <span className="text-[10px] font-bold uppercase tracking-widest">Aadhaar Integrated</span>
            <span className="text-[10px] font-bold uppercase tracking-widest">Direct Benefit Transfer</span>
         </div>
         <p className="text-[9px] font-bold text-gray-300 uppercase tracking-[0.5em] text-center">Department of Food & Public Distribution</p>
      </footer>
    </div>
  );
}
