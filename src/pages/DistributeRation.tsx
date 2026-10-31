import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { Search, UserCheck, PackageCheck, AlertCircle, Loader2, CheckCircle, QrCode as QrIcon, Barcode as BarcodeIcon, Info, Scan, X, ZoomIn } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
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
        <button onClick={onClose} className="absolute top-4 right-4 p-2 text-gray-300 hover:text-gray-600 transition-colors">
          <X className="w-5 h-5" />
        </button>
        <p className="text-[10px] font-black text-gov-blue uppercase tracking-[0.3em]">Barcode — Full View</p>
        <div className="bg-gray-50 p-6 rounded-2xl border border-gray-100">
          <Barcode value={value} width={2.5} height={100} fontSize={18} fontOptions="bold" lineColor="#000080" />
        </div>
        <p className="text-xs font-mono font-bold text-gray-400">{value}</p>
        <p className="text-[9px] text-gray-300 uppercase tracking-widest">Click outside to close</p>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function DistributeRation() {
  const { profile } = useAuth();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [dispatchToken, setDispatchToken] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [enlargedBarcode, setEnlargedBarcode] = useState<string | null>(null);
  
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [beneficiary, setBeneficiary] = useState<any>(null);
  const [inventory, setInventory] = useState<any[]>([]);

  // Selection state
  const [selectedItems, setSelectedItems] = useState<{[key: string]: number}>({});
  const [verifiedBatches, setVerifiedBatches] = useState<{[key: string]: string}>({});
  const [itemScanning, setItemScanning] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);

  useEffect(() => {
    if (showScanner && (step === 1 || step === 3)) {
       const start = async () => {
         if (scannerRef.current) return;
         try {
           const elementId = step === 1 ? "reader-beneficiary" : "reader-batch";
           const formatsToSupport = [
             Html5QrcodeSupportedFormats.CODE_128,
             Html5QrcodeSupportedFormats.CODE_39,
             Html5QrcodeSupportedFormats.CODE_93,
             Html5QrcodeSupportedFormats.EAN_13,
             Html5QrcodeSupportedFormats.EAN_8,
             Html5QrcodeSupportedFormats.UPC_A,
             Html5QrcodeSupportedFormats.UPC_E,
             Html5QrcodeSupportedFormats.QR_CODE
           ];

           scannerRef.current = new Html5Qrcode(elementId, { verbose: false, formatsToSupport });
           
           await scannerRef.current.start(
             { facingMode: "environment" },
             {
               fps: 20,
               qrbox: (viewfinderWidth, viewfinderHeight) => ({
                 width: viewfinderWidth * 0.85,
                 height: viewfinderHeight * 0.5
               }),
               aspectRatio: 1.0,
               disableFlip: false,
             },
             (decodedText) => {
               const scannedValue = decodedText.trim().toUpperCase();
               
               if (step === 1) {
                 setSearchQuery(scannedValue);
                 setShowScanner(false);
                 searchBeneficiary(scannedValue);
               } else if (step === 3 && itemScanning) {
                 const batchId = scannedValue.trim();
                 const stockItem = inventory.find(i => 
                   i.name.toLowerCase().trim() === itemScanning.toLowerCase().trim() && 
                   (i.batch_id?.toUpperCase().trim() === batchId || i.batch_id?.trim() === batchId)
                 );
                 
                 if (stockItem) {
                   setVerifiedBatches(prev => ({ ...prev, [itemScanning]: stockItem.batch_id }));
                   setItemScanning(null);
                   setShowScanner(false);
                 } else {
                   const availableMatchingItems = inventory.filter(i => i.name.toLowerCase().trim() === itemScanning.toLowerCase().trim());
                   const availableBatches = availableMatchingItems.map(i => i.batch_id).join(', ');
                   alert(`INVALID_BAG: Scanned [${batchId}] does not match any Registered Batches for ${itemScanning}.\n\nExpected one of: ${availableBatches || 'None Found'}`);
                 }
               }
               
               scannerRef.current?.stop().then(() => {
                 scannerRef.current = null;
               }).catch(console.error);
             },
             (err) => {}
           );
         } catch (err) {
           console.error(err);
         }
       };
       start();
    }

    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(console.error).finally(() => {
          scannerRef.current = null;
        });
      }
    };
  }, [showScanner, step, itemScanning, inventory]);

  useEffect(() => {
    if (profile) {
      const fetchInv = async () => {
        const { data } = await supabase
          .from('inventory')
          .select('*')
          .eq('owner_id', profile.dealerUUID || profile.uid);
        if (data) setInventory(data);
      };
      fetchInv();
    }
  }, [profile, step]);

  const searchBeneficiary = async (idOverride?: string) => {
    const id = (idOverride || searchQuery).trim().toUpperCase();
    if (!id) return;
    setLoading(true);
    try {
      const { data } = await supabase
        .from('beneficiaries')
        .select('*')
        .eq('id', id)
        .limit(1);
      if (data && data.length > 0) {
        setBeneficiary(data[0]);
        if (idOverride) setStep(2);
      } else {
        alert(`ENROLLEE_NOT_FOUND: Identity ${id} not registered in database.`);
      }
    } catch (err) {
      console.error('Beneficiary Search Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const executeDistribution = async () => {
    setLoading(true);
    try {
      const dealerId = profile?.dealerUUID || profile?.uid;
      
      const now = new Date().toISOString();
      const { data: txData, error: txError } = await supabase
        .from('transactions')
        .insert([{
          beneficiary_id: beneficiary.id,
          dealer_id: dealerId,
          items: selectedItems,
          batch_mappings: verifiedBatches,
          timestamp: now,
          created_at: now,
        }]).select();
      if (txError) throw txError;
      
      const transactionId = txData && txData.length > 0 ? txData[0].id : `TXN-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

      const updatePromises = (Object.entries(selectedItems) as [string, number][])
        .filter(([_, qty]) => qty > 0)
        .map(async ([itemName, qty]) => {
          const itemInInv = inventory.find(i => 
            i.name.toLowerCase() === itemName.toLowerCase() && 
            i.batch_id?.toUpperCase() === verifiedBatches[itemName]?.toUpperCase()
          );
          if (itemInInv) {
            const newQty = (itemInInv.quantity || 0) - qty;
            return supabase.from('inventory').update({ quantity: newQty }).eq('id', itemInInv.id);
          }
          return null;
        });
      await Promise.all(updatePromises);

      setDispatchToken(JSON.stringify({
        txnId: transactionId,
        beneficiary: beneficiary.name,
        beneficiaryId: beneficiary.id,
        items: selectedItems,
        dealer: dealerId,
        date: new Date().toLocaleDateString()
      }));
      setStep(4);
    } catch (err: any) {
      alert(`TRANS_ERROR: DISTRIBUTION_REJECTED. Details: ${err.message || JSON.stringify(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const selectedItemsList = Object.entries(selectedItems).filter(([_, q]) => (q as number) > 0);
  const allBatchesScanned = selectedItemsList.every(([item]) => verifiedBatches[item]);

  // ── Step 4: Dispatch Label ──────────────────────────────────────────────────
  if (step === 4) {
     const tokenData = JSON.parse(dispatchToken || '{}');
     return (
        <div className="max-w-2xl mx-auto space-y-8 animate-in zoom-in-95 duration-500">
           {enlargedBarcode && (
             <BarcodeModal value={enlargedBarcode} onClose={() => setEnlargedBarcode(null)} />
           )}
           <div className="bg-white rounded-[40px] border-4 border-gov-blue p-1 relative overflow-hidden shadow-2xl">
              <div className="bg-white rounded-[36px] py-12 px-10 border border-gray-100 flex flex-col items-center">
                 <div className="w-full flex items-center justify-between mb-10 pb-6 border-b-2 border-gray-100">
                    <div className="flex items-center gap-3">
                       <div className="w-12 h-12 bg-gov-blue text-white rounded-xl flex items-center justify-center font-black text-xl">S</div>
                       <div className="text-left font-black text-gov-blue leading-none tracking-tight">
                          <p className="text-[10px] opacity-40 uppercase tracking-widest mb-1">Government of India</p>
                          <p className="text-sm uppercase">Smart PDS Network</p>
                       </div>
                    </div>
                    <div className="text-right">
                       <p className="text-[10px] font-black text-gov-green uppercase tracking-[0.2em] mb-1">Verified Dispatch</p>
                       <p className="text-[8px] font-bold text-gray-300 uppercase">April 2026 Cycle</p>
                    </div>
                 </div>

                 <h1 className="text-3xl font-black text-gov-blue uppercase tracking-tight mb-8">Official Dispatch Label</h1>

                 <div className="w-full bg-gov-offwhite p-8 rounded-[32px] border border-gray-50 flex flex-col items-center mb-8 relative">
                    <div className="absolute top-4 left-4 opacity-5">
                       <PackageCheck className="w-16 h-16 text-gov-blue" />
                    </div>
                    
                    {/* Enlargeable dispatch barcode */}
                    <button
                      className="bg-white p-6 rounded-3xl shadow-lg border border-gray-100 mb-6 group hover:scale-[1.02] transition-transform relative"
                      onClick={() => tokenData.txnId && setEnlargedBarcode(tokenData.txnId)}
                      title="Click to enlarge"
                    >
                       <Barcode 
                         value={tokenData.txnId || 'N/A'} 
                         width={2} 
                         height={70}
                         fontSize={16}
                         fontOptions="bold"
                         lineColor="#000080"
                       />
                       <span className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                         <ZoomIn className="w-4 h-4 text-gov-blue" />
                       </span>
                    </button>
                    <p className="text-[10px] font-black text-gov-blue uppercase tracking-[0.4em] mb-1">Authorized Stock Release</p>
                    <p className="text-[9px] text-gray-400 font-bold uppercase">Traceability Hash: {tokenData.txnId}</p>
                 </div>

                 <div className="w-full grid grid-cols-2 gap-4 text-left mb-8">
                    <div className="p-5 bg-gray-50 rounded-2xl border border-gray-100">
                       <p className="text-[8px] font-black text-gray-300 uppercase tracking-widest mb-2">Recipient Identity</p>
                       <p className="text-sm font-black text-gov-blue truncate uppercase">{tokenData.beneficiary}</p>
                       <p className="text-[9px] font-mono font-bold text-gray-400 mt-1">{tokenData.beneficiaryId}</p>
                    </div>
                    <div className="p-5 bg-gray-50 rounded-2xl border border-gray-100">
                       <p className="text-[8px] font-black text-gray-300 uppercase tracking-widest mb-2">Issuing Authority</p>
                       <p className="text-sm font-black text-gov-blue truncate uppercase">Dealer #{tokenData.dealer}</p>
                       <p className="text-[9px] font-bold text-gray-400 mt-1 tracking-widest">{tokenData.date}</p>
                    </div>
                 </div>

                 <div className="w-full mb-10 overflow-hidden">
                    <p className="text-[10px] font-black text-gov-blue uppercase tracking-widest mb-4 flex items-center gap-2">
                       <div className="w-4 h-[1px] bg-gov-blue/20"></div>
                       Allocated Commodities
                       <div className="flex-1 h-[1px] bg-gov-blue/20"></div>
                    </p>
                    <div className="space-y-2">
                       {tokenData.items && Object.entries(tokenData.items).map(([item, qty]) => (
                          <div key={item} className="flex justify-between items-center py-2 px-4 bg-gov-green/5 rounded-xl text-xs font-black text-gov-blue uppercase">
                             <span>{item}</span>
                             <span className="text-gov-green">{qty as any} KG</span>
                          </div>
                       ))}
                    </div>
                 </div>

                 <div className="w-full flex gap-4 no-print">
                   <button 
                     onClick={() => { setStep(1); setBeneficiary(null); setSelectedItems({}); setDispatchToken(null); setVerifiedBatches({}); }}
                     className="flex-1 border-2 border-gray-100 py-5 rounded-2xl font-black uppercase tracking-widest text-gov-blue hover:bg-gray-50 transition-all"
                   >
                      New Dispatch
                   </button>
                   <button 
                     onClick={() => window.print()}
                     className="flex-1 bg-gov-blue text-white py-5 rounded-2xl font-black uppercase tracking-widest shadow-lg hover:shadow-gov-blue/20 transition-all flex items-center justify-center gap-2"
                   >
                      <QrIcon className="w-5 h-5" />
                      Print Label
                   </button>
                 </div>
              </div>
           </div>
           
           <div className="text-center no-print">
              <p className="text-[10px] font-bold text-gray-300 uppercase tracking-[0.2em] leading-loose">
                 Digital compliance established under Section 7 of Aadhaar Act<br/>
                 Manifest synchronized with Central PDS Node
              </p>
           </div>

           <style>{`
             @media print {
               .no-print { display: none !important; }
               body { background: white !important; margin: 0; padding: 0; }
               .max-w-2xl { max-width: 100% !important; margin: 0 !important; width: 100% !important; }
               @page { size: auto; margin: 0; }
             }
           `}</style>
        </div>
     );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-10 animate-in fade-in duration-700">
      {enlargedBarcode && (
        <BarcodeModal value={enlargedBarcode} onClose={() => setEnlargedBarcode(null)} />
      )}

      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-gray-200 pb-8">
        <div>
           <h1 className="text-4xl font-black text-gov-blue uppercase tracking-tight">Ration Distribution Point</h1>
           <p className="text-gray-500 text-xs font-bold uppercase mt-2 tracking-widest flex items-center gap-2">
             <div className="w-2 h-2 rounded-full bg-gov-green animate-pulse"></div>
             Active Session: Step {step} of 4 - {
               step === 1 ? 'Identity' : 
               step === 2 ? 'Allocation' : 
               step === 3 ? 'Bag Tracing' : 'Dispatch'
             }
           </p>
        </div>
        <div className="h-4 w-48 bg-gray-100 overflow-hidden rounded-full border border-gray-100 shadow-inner">
           <div 
             className="h-full bg-gov-blue transition-all duration-700 ease-out" 
             style={{ width: `${(step/4)*100}%` }}
           ></div>
        </div>
      </header>

      {/* ── Step 1: Identity ── */}
      {step === 1 && (
        <div className="space-y-10">
           <div className="bg-white rounded-3xl border border-gray-100 p-10 shadow-sm border-l-8 border-l-gov-blue hover:shadow-xl transition-all">
              <h2 className="text-sm font-black text-gov-blue uppercase mb-8 tracking-[0.2em] flex items-center gap-2">
                <Search className="w-5 h-5 text-gov-blue" />
                Resident Identity Resolution
              </h2>
              <div className="flex flex-col md:flex-row gap-4">
                 <div className="relative flex-1 group">
                    <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-6 h-6 text-gray-300 group-focus-within:text-gov-blue transition-colors" />
                    <input 
                      type="text" 
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="ENTER CITIZEN RATION CARD ID"
                      className="w-full border-2 border-gray-100 rounded-2xl p-5 pl-14 font-black text-gov-blue text-xl outline-none uppercase placeholder:text-gray-200 focus:border-gov-blue transition-all shadow-inner"
                    />
                    <button 
                      onClick={() => setShowScanner(!showScanner)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-gov-blue/5 text-gov-blue rounded-xl hover:bg-gov-blue hover:text-white transition-all"
                      title="Scan Card Barcode"
                    >
                       <BarcodeIcon className="w-5 h-5" />
                    </button>
                 </div>
                 <button 
                   onClick={() => searchBeneficiary()}
                   disabled={loading}
                   className="px-12 py-5 bg-gov-blue text-white rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:bg-opacity-90 shadow-lg hover:shadow-gov-blue/20 transition-all min-w-[200px]"
                 >
                   {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Search className="w-6 h-6" />}
                   Validate
                 </button>
              </div>

              {showScanner && (
                <div className="mt-8 bg-gov-offwhite p-6 rounded-2xl border border-gray-100 animate-in fade-in slide-in-from-top-4">
                   <div id="reader-beneficiary" className="w-full rounded-xl overflow-hidden shadow-inner border border-gray-100 min-h-[200px] bg-white text-xs"></div>
                   <p className="text-center text-[10px] font-bold text-gray-400 mt-4 uppercase tracking-widest">Position Ration Card Barcode within Frame</p>
                </div>
              )}
           </div>

           <div className="bg-gov-saffron/5 p-6 rounded-3xl border border-gov-saffron/10 flex items-start gap-4">
              <Info className="w-6 h-6 text-gov-saffron shrink-0" />
              <div>
                 <h4 className="text-[10px] font-black text-gov-saffron uppercase tracking-widest mb-1">PDS Digital Aid: Where is the Barcode ID?</h4>
                 <p className="text-[9px] text-gov-saffron/80 font-bold leading-relaxed uppercase">
                    1. Government Bags: Look for the <span className="underline italic">Govt. Batch ID</span> sticker under the bars.<br/>
                    2. Ration Cards: The Barcode ID is the alphanumeric string (e.g., RATION-ABC123) printed below the black bars.<br/>
                    3. Digital Receipts: The ID is the Transaction Reference (e.g., TXN-XXXXXX) issued after every successful dispatch.
                 </p>
              </div>
           </div>

           {beneficiary && (
             <div className="bg-white rounded-3xl border border-gray-100 p-10 animate-in slide-in-from-bottom-8 shadow-2xl relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-32 h-32 bg-gov-green/5 -mr-16 -mt-16 rounded-full group-hover:scale-110 transition-transform"></div>
                <div className="flex flex-col md:flex-row items-center gap-8 mb-10 pb-10 border-b border-gray-50">
                   <div className="w-24 h-24 bg-gov-blue/5 text-gov-blue flex items-center justify-center rounded-3xl font-black text-4xl border border-gov-blue/10 shadow-inner">
                      {beneficiary.name[0]}
                   </div>
                   <div className="text-center md:text-left">
                      <h3 className="text-3xl font-black text-gov-blue uppercase tracking-tight mb-2">{beneficiary.name}</h3>
                      <div className="flex flex-wrap items-center justify-center md:justify-start gap-3">
                        <p className="font-mono font-bold text-gray-400 bg-gov-offwhite px-3 py-1 rounded-full text-xs">{beneficiary.id}</p>
                        <div className="flex items-center gap-2 bg-gov-green/10 text-gov-green px-4 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter">
                           <UserCheck className="w-4 h-4" />
                           Identity Confirmed
                        </div>
                      </div>
                   </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-10 mb-10">
                   <div className="bg-gov-offwhite p-6 rounded-2xl border border-gray-50">
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4 italic underline decoration-gov-saffron decoration-2">Household Profile</p>
                      <div className="space-y-4">
                        <div className="flex justify-between items-center text-sm">
                           <span className="font-bold text-gray-400 uppercase tracking-tighter">Family Unit Size:</span>
                           <span className="font-black text-gov-blue px-3 py-1 bg-white rounded-lg shadow-sm">{beneficiary.family_size} Registered</span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                           <span className="font-bold text-gray-400 uppercase tracking-tighter">Household Code:</span>
                           <span className="font-black text-gov-blue px-3 py-1 bg-white rounded-lg shadow-sm">#{beneficiary.id.slice(-4)}</span>
                        </div>
                      </div>
                   </div>
                   <div className="bg-gov-offwhite p-6 rounded-2xl border border-gray-50">
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4 italic underline decoration-gov-green decoration-2">Entitlement Matrix</p>
                      <div className="flex flex-wrap gap-3">
                         {Object.entries(beneficiary.entitlement).map(([item, qty]: [string, any]) => (
                            <span key={item} className="px-3 py-2 bg-white rounded-xl border border-gray-100 shadow-sm text-[10px] font-black text-gov-blue uppercase tracking-tighter">
                              {item}: {qty} KG
                            </span>
                         ))}
                      </div>
                   </div>
                </div>

                <button 
                  onClick={() => setStep(2)}
                  className="w-full bg-gov-green text-white py-6 rounded-2xl font-black uppercase tracking-[0.3em] hover:bg-opacity-90 shadow-lg hover:shadow-gov-green/20 transition-all"
                >
                   Authorize Distribution
                </button>
             </div>
           )}
        </div>
      )}

      {/* ── Step 3: Bag Tracing ── */}
      {step === 3 && beneficiary && (
        <div className="max-w-4xl mx-auto space-y-8 animate-in slide-in-from-right-10 duration-500">
           <div className="bg-white rounded-3xl border border-gray-100 p-10 shadow-sm border-t-8 border-t-gov-green">
              <h2 className="text-xl font-black text-gov-blue uppercase tracking-tight mb-8 flex items-center gap-3">
                 <BarcodeIcon className="w-8 h-8 text-gov-blue" />
                 Traceability Lock: Bag Scanning
              </h2>
              <p className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-6 leading-relaxed">
                 Scan the <span className="text-gov-saffron underline italic">Government Batch Label</span> on the bags you are opening. The actual barcodes from your stock are shown below — scan them or click to verify manually.
              </p>

              {/* Stock barcodes reference panel */}
              {selectedItemsList.length > 0 && (
                <div className="mb-8 p-5 bg-gov-blue/5 rounded-2xl border border-gov-blue/10">
                  <p className="text-[10px] font-black text-gov-blue uppercase tracking-widest mb-4 flex items-center gap-2">
                    <BarcodeIcon className="w-4 h-4" />
                    Your Stock Barcodes — Click to Verify or Enlarge
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {selectedItemsList.map(([itemName]) => {
                      const matchingStockItems = inventory.filter(
                        i => i.name.toLowerCase().trim() === itemName.toLowerCase().trim() && i.batch_id
                      );
                      return matchingStockItems.map(stockItem => (
                        <div
                          key={stockItem.id}
                          className={`p-3 bg-white rounded-xl border-2 transition-all ${
                            verifiedBatches[itemName] === stockItem.batch_id
                              ? 'border-gov-green shadow-sm'
                              : 'border-gray-100 hover:border-gov-blue/30'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-[9px] font-black text-gov-blue uppercase">{itemName}</p>
                            <p className="text-[8px] font-bold text-gray-400 uppercase">{stockItem.quantity} KG</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setEnlargedBarcode(stockItem.batch_id)}
                              className="group flex items-center gap-1 hover:opacity-75 transition-opacity"
                              title="Enlarge barcode"
                            >
                              <div className="pointer-events-none">
                                <Barcode
                                  value={stockItem.batch_id}
                                  width={1}
                                  height={24}
                                  fontSize={7}
                                  fontOptions="bold"
                                  lineColor="#000080"
                                  margin={1}
                                />
                              </div>
                              <ZoomIn className="w-3 h-3 text-gov-blue opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                            </button>
                            {!verifiedBatches[itemName] && (
                              <button
                                onClick={() => setVerifiedBatches(prev => ({ ...prev, [itemName]: stockItem.batch_id }))}
                                className="ml-auto text-[8px] font-black uppercase text-gov-blue bg-gov-blue/10 px-2 py-1 rounded-lg hover:bg-gov-blue hover:text-white transition-all whitespace-nowrap"
                              >
                                Verify
                              </button>
                            )}
                            {verifiedBatches[itemName] === stockItem.batch_id && (
                              <span className="ml-auto flex items-center gap-1 text-[8px] font-black text-gov-green uppercase whitespace-nowrap">
                                <CheckCircle className="w-3 h-3" /> Done
                              </span>
                            )}
                          </div>
                        </div>
                      ));
                    })}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                 <div className="space-y-4">
                    {selectedItemsList.map(([item, qty]) => (
                       <div 
                         key={item} 
                         className={`p-6 rounded-2xl border-2 transition-all flex justify-between items-center ${
                           verifiedBatches[item] 
                             ? 'bg-gov-green/5 border-gov-green/20' 
                             : 'bg-gov-offwhite border-gray-50'
                         }`}
                       >
                          <div>
                             <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{item}</p>
                             <p className="text-sm font-black text-gov-blue font-mono">Qty: {qty} KG</p>
                             {verifiedBatches[item] && (
                                <p className="text-[9px] text-gov-green font-black uppercase mt-1 flex items-center gap-1">
                                   <CheckCircle className="w-3 h-3" /> Batch: {verifiedBatches[item]}
                                </p>
                             )}
                          </div>
                          {!verifiedBatches[item] && (
                             <button 
                               onClick={() => {
                                 setItemScanning(item);
                                 setShowScanner(true);
                               }}
                               className="p-3 bg-gov-blue text-white rounded-xl hover:bg-opacity-90 transition-all flex items-center gap-2 text-[10px] font-black uppercase tracking-widest"
                             >
                                <Scan className="w-4 h-4" />
                                Scan Bag
                             </button>
                          )}
                          {verifiedBatches[item] && (
                             <button 
                               onClick={() => {
                                 setVerifiedBatches(prev => {
                                   const next = { ...prev };
                                   delete next[item];
                                   return next;
                                 });
                               }}
                               className="text-red-500 font-black text-[9px] uppercase tracking-widest underline underline-offset-4"
                             >
                                Reset
                             </button>
                          )}
                       </div>
                    ))}
                 </div>

                 <div className="bg-gray-50 rounded-3xl border-2 border-dashed border-gray-100 flex flex-col items-center justify-center p-8 overflow-hidden">
                    {itemScanning ? (
                       <div className="w-full space-y-4">
                          <p className="text-center text-[10px] font-black text-gov-blue uppercase tracking-[0.2em] mb-2 animate-pulse">Scanning Bag for {itemScanning}</p>
                          <div id="reader-batch" className="w-full rounded-2xl overflow-hidden border border-gray-100 bg-black min-h-[250px]"></div>
                          <button 
                            onClick={() => { setItemScanning(null); setShowScanner(false); }}
                            className="w-full py-4 text-xs font-black text-gray-400 uppercase tracking-widest underline underline-offset-8"
                          >
                            Cancel Scan
                          </button>
                       </div>
                    ) : (
                       <div className="text-center opacity-30">
                          <BarcodeIcon className="w-16 h-16 mx-auto mb-4" />
                          <p className="text-[10px] font-black uppercase tracking-widest">Select an item to scan its batch</p>
                       </div>
                    )}
                 </div>
              </div>

              <div className="mt-12 pt-8 border-t border-gray-100 flex gap-4">
                 <button 
                   onClick={() => setStep(2)}
                   className="px-8 py-5 border-2 border-gray-100 text-gov-blue rounded-2xl font-black uppercase tracking-widest hover:bg-gray-50 transition-all"
                 >
                    Back to Items
                 </button>
                 <button 
                   onClick={() => {
                     if (!allBatchesScanned) {
                        alert(`You must verify batch barcodes for all selected items.\nPending: ${selectedItemsList.filter(([item]) => !verifiedBatches[item]).map(([item]) => item).join(', ')}`);
                        return;
                     }
                     executeDistribution();
                   }}
                   disabled={loading || selectedItemsList.length === 0}
                   className="flex-1 bg-gov-blue text-white py-5 rounded-2xl font-black uppercase tracking-[0.3em] hover:shadow-xl hover:shadow-gov-blue/20 transition-all disabled:opacity-30 disabled:shadow-none flex items-center justify-center gap-3"
                 >
                    {loading ? (
                       <><Loader2 className="w-6 h-6 animate-spin" />Finalizing Traceability...</>
                    ) : (
                       <><CheckCircle className="w-6 h-6" />Commit & Authorize</>
                    )}
                 </button>
              </div>
           </div>
        </div>
      )}

      {/* ── Step 2: Allocation ── */}
      {step === 2 && beneficiary && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
           <div className="bg-white rounded-3xl border border-gray-100 p-8 shadow-sm border-t-8 border-t-gov-blue h-fit">
              <h2 className="text-sm font-black text-gov-blue uppercase mb-10 tracking-[0.2em] flex items-center gap-3">
                 <PackageCheck className="w-6 h-6 text-gov-blue" />
                 Allocation Selection
              </h2>
              <div className="space-y-8">
                 {Object.entries(beneficiary.entitlement).map(([item, quota]: [string, any]) => {
                    const stockItem = inventory.find(i => i.name.toLowerCase() === item.toLowerCase());
                    const stock = stockItem?.quantity || 0;
                    return (
                       <div key={item} className="group">
                          <div className="flex justify-between items-end mb-4">
                             <div>
                                <h4 className="font-black text-gov-blue uppercase text-lg leading-none mb-1.5">{item}</h4>
                                <div className="flex gap-4 items-center">
                                   <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Quota: {quota} KG</span>
                                   <div className={cn("text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-tighter", stock < 5 ? "bg-red-50 text-red-600" : "bg-gov-green/10 text-gov-green")}>
                                      Stock: {stock} KG
                                   </div>
                                </div>
                             </div>
                             <div className="text-2xl font-black text-gov-blue tracking-tighter">
                                {selectedItems[item] || 0} <span className="text-[10px] text-gray-300">KG</span>
                             </div>
                          </div>
                          <div className="flex items-center gap-4">
                             <input 
                               type="range"
                               min="0"
                               max={Math.min(quota, stock)}
                               step="0.5"
                               value={selectedItems[item] || 0}
                               onChange={(e) => setSelectedItems({...selectedItems, [item]: Number(e.target.value)})}
                               className="flex-1 h-3 bg-gray-100 rounded-full appearance-none cursor-pointer accent-gov-blue group-hover:bg-gray-200 transition-all outline-none"
                             />
                          </div>
                       </div>
                    );
                 })}
              </div>
           </div>

           <div className="bg-white rounded-3xl border border-gray-100 p-10 shadow-xl border-t-8 border-t-gov-saffron flex flex-col h-fit sticky top-10">
              <div className="flex-1">
                <h2 className="text-sm font-black text-gov-blue uppercase mb-8 tracking-[0.2em] flex items-center gap-2">
                   Distribution Manifest
                </h2>
                <div className="space-y-3 mb-10">
                   {selectedItemsList.map(([item, qty]) => (
                      <div key={item} className="p-4 bg-gov-offwhite rounded-xl flex justify-between items-center group hover:bg-white hover:border-gov-blue/20 border border-transparent transition-all shadow-sm">
                         <span className="uppercase font-black text-gov-blue text-sm tracking-tight">{item}</span>
                         <span className="font-black text-gov-green text-xl tracking-tighter">{qty} KG</span>
                      </div>
                   ))}
                   {selectedItemsList.length === 0 ? (
                      <div className="py-16 text-center border-2 border-dashed border-gray-100 rounded-2xl">
                         <AlertCircle className="w-8 h-8 mx-auto mb-3 opacity-10 text-gov-blue" />
                         <p className="text-[10px] font-bold text-gray-300 uppercase tracking-widest italic">Inventory Selection Pending</p>
                      </div>
                   ) : null}
                </div>
              </div>

              <div className="space-y-6 pt-6 border-t border-gray-50 mt-auto">
                 <div className="p-4 bg-gov-saffron/5 rounded-2xl border border-gov-saffron/10 flex items-start gap-4">
                    <AlertCircle className="w-6 h-6 text-gov-saffron shrink-0" />
                    <div>
                       <p className="text-[10px] font-black text-gov-saffron uppercase tracking-widest mb-1">Stock Authorization Bond</p>
                       <p className="text-[9px] text-gov-saffron/60 font-bold leading-relaxed uppercase">By committing this dispatch, you confirm the physical handover of resources to the beneficiary. This action is immutable.</p>
                    </div>
                 </div>
                 <div className="flex flex-col md:flex-row gap-4">
                    <button 
                       onClick={() => setStep(1)}
                       className="flex-1 bg-gov-offwhite text-gov-blue rounded-2xl py-5 font-black uppercase tracking-widest hover:bg-gray-100 transition-all border border-gray-100"
                    >
                       Go Back
                    </button>
                    <button 
                       onClick={() => setStep(3)}
                       disabled={selectedItemsList.length === 0}
                       className="flex-1 bg-gov-blue text-white rounded-2xl py-5 font-black uppercase tracking-widest hover:bg-opacity-90 shadow-xl hover:shadow-gov-blue/20 transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:shadow-none"
                    >
                       Next: Trace Bag
                       <Scan className="w-5 h-5" />
                    </button>
                 </div>
              </div>
           </div>
        </div>
      )}
    </div>
  );
}

function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(' ');
}
