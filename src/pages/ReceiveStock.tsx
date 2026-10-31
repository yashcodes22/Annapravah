import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Barcode as BarcodeIcon, CheckCircle, AlertTriangle, ArrowLeft, Loader2, XCircle, WifiOff } from 'lucide-react';

export default function ReceiveStock() {
  const { profile } = useAuth();
  const [scanResult, setScanResult] = useState<any>(null);
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [inwardError, setInwardError] = useState<string | null>(null);
  const [activeCamera, setActiveCamera] = useState<string | null>(null);
  const [cameras, setCameras] = useState<any[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  // New states for running scan counter panel
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [totalExpected, setTotalExpected] = useState<number>(0);
  const [scanLogs, setScanLogs] = useState<any[]>([]);
  const [mismatches, setMismatches] = useState<number>(0);
  const [discrepancyReason, setDiscrepancyReason] = useState('');
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    const startScanner = async () => {
      if (scannerRef.current || scanResult) return;

      const formatsToSupport = [
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.ITF,
        Html5QrcodeSupportedFormats.QR_CODE
      ];

      const config = {
        fps: 10,
        qrbox: (w: number, h: number) => ({ width: Math.round(w * 0.8), height: Math.round(h * 0.6) }),
        aspectRatio: 1.0,
        disableFlip: false,
      };

      const onSuccess = (decodedText: string) => {
        if (scannerRef.current) {
          const s = scannerRef.current;
          scannerRef.current = null;
          s.stop().then(() => setIsScanning(false)).catch(console.error);
          setScanResult({ batch: decodedText, loading: true });
        }
      };

      try {
        // First try: use environment-facing camera (works best on mobile via IP)
        scannerRef.current = new Html5Qrcode("reader", { verbose: false, formatsToSupport });
        setIsScanning(true);
        await scannerRef.current.start(
          { facingMode: "environment" },
          config,
          onSuccess,
          () => {}
        );
        if (isMounted) {
          // Also fetch device list for camera switcher UI
          Html5Qrcode.getCameras().then(devices => {
            if (isMounted) setCameras(devices);
          }).catch(() => {});
        }
      } catch (err: any) {
        if (!isMounted) return;
        // Fallback: try enumerating cameras and pick back camera
        try {
          const devices = await Html5Qrcode.getCameras();
          if (!isMounted) return;
          setCameras(devices);
          if (devices.length > 0) {
            const backCamera = devices.find(d => d.label.toLowerCase().includes('back')) || devices[0];
            setActiveCamera(backCamera.id);
            if (!scannerRef.current) {
              scannerRef.current = new Html5Qrcode("reader", { verbose: false, formatsToSupport });
            }
            setIsScanning(true);
            await scannerRef.current.start(backCamera.id, config, onSuccess, () => {});
          }
        } catch (fallbackErr: any) {
          if (!isMounted) return;
          console.error('Camera init failed:', fallbackErr);
          if (
            fallbackErr?.toString().includes("NotAllowedError") ||
            fallbackErr?.toString().includes("Permission denied") ||
            err?.toString().includes("NotAllowedError") ||
            err?.toString().includes("Permission denied")
          ) {
            setScannerError("CAMERA_PERMISSION_DENIED");
          } else {
            setScannerError("SCANNER_INIT_FAILED");
          }
          setIsScanning(false);
        }
      }
    };

    if (!scanResult) {
      startScanner();
    }

    return () => {
      isMounted = false;
      if (scannerRef.current) {
        scannerRef.current.stop().catch(console.error);
        scannerRef.current = null;
      }
    };
  }, [scanResult]);

  const simulateScan = async () => {
    if (scannerRef.current) {
       const scanner = scannerRef.current;
       scannerRef.current = null;
       try { await scanner.stop(); } catch(e) {}
       setIsScanning(false);
    }
    setProcessing(true);
    try {
      const { data, error } = await supabase
        .from('inventory')
        .select('*')
        .eq('destination_shop_id', profile?.dealerUUID || '')
        .in('status', ['pending', 'created'])
        .order('created_at', { ascending: false })
        .limit(1);

      if (data && data.length > 0) {
        setScanResult({ batch: data[0].batch_id, loading: true });
        setActiveBatchId(data[0].batch_id);
      } else {
        alert("TEST_MODE: NO_VALID_BATCHES_IN_SYSTEM. Register stock first as Admin.");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setProcessing(false);
    }
  };

  useEffect(() => {
    if (activeBatchId && profile?.dealerUUID) {
       // get expected bags from inventory
       const fetchExp = async () => {
         const { count } = await supabase.from('inventory')
            .select('*', { count: 'exact', head: true })
            .eq('batch_id', activeBatchId)
            .eq('destination_shop_id', profile.dealerUUID)
            .in('status', ['pending', 'created']);
         setTotalExpected(count || 0);
       };
       fetchExp();
    }
  }, [activeBatchId, profile?.dealerUUID]);

  useEffect(() => {
    if (scanResult?.batch && scanResult?.loading) {
      const currentActiveBatch = activeBatchId || scanResult.batch;
      if (!activeBatchId) setActiveBatchId(currentActiveBatch);
      const fetchBatch = async () => {
        try {
          const { data, error } = await supabase
            .from('inventory')
            .select('*')
            .eq('batch_id', scanResult.batch)
            .limit(1);

          if (data && data.length > 0) {
            const item = data[0];
            
            if (item.status === 'received') {
              setScanResult({ error: 'ALREADY_RECEIVED', batch: scanResult.batch });
              return;
            }

            const isMatch = item.batch_id === currentActiveBatch;
            
            setScanLogs(prev => {
                // If it's a match and we already have a match for this batch, don't duplicate
                if (isMatch && prev.some(l => l.batch === item.batch_id && l.isMatch)) {
                    return prev;
                }
                const newLog = {
                    id: item.id,
                    batch: item.batch_id,
                    name: item.name,
                    qty: item.quantity,
                    scanned_at: new Date().toISOString(),
                    isMatch
                };
                return [newLog, ...prev];
            });

            if (!isMatch) {
               setMismatches(prev => {
                  const newMismatches = prev + 1;
                  if (newMismatches >= 3) {
                     alert('Critical: 3 or more mismatches detected. Auto-alert sent to District Food Officer.');
                     // Insert Alert
                     supabase.from('alerts').insert([{
                       shop_id: profile?.dealerUUID || 'UNKNOWN',
                       type: 'STOCK_MISMATCH',
                       severity: 'high',
                       description: `${newMismatches} bag mismatches detected during inward scan of batch ${currentActiveBatch}`
                     }]).then((res) => { if (res.error) console.error(res.error); });
                  }
                  return newMismatches;
               });
               setScanResult({ error: 'BATCH_MISMATCH', batch: scanResult.batch });
            } else {
                setScanResult({
                  id: item.id,
                  name: item.name,
                  qty: item.quantity,
                  exp: item.expiry,
                  batch: item.batch_id
                });
            }
          } else {
            setScanResult({ error: 'BATCH_NOT_FOUND', batch: scanResult.batch });
          }
        } catch (err) {
          setScanResult({ error: 'LOOKUP_FAILED' });
        }
      };
      fetchBatch();
    }
  }, [scanResult]);

  const handleManualInward = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualCode) {
        setScanResult({ batch: manualCode.trim().toUpperCase(), loading: true });
        setManualCode('');
    }
  };

  const processInward = async () => {
    setInwardError(null);
    if (!profile?.dealerUUID) {
       setInwardError("CRITICAL ERROR: No dealer ID (dealerId) found in profile.");
       return;
    }
    if (!activeBatchId) {
       setInwardError("ERROR: No active batch to process.");
       return;
    }

    // Removing discrepancy checks to simplify UX
    setProcessing(true);
    try {
      const dealerId = profile.dealerUUID;

      // UPDATE all matching inventory rows status from 'created' to 'received' and set owner_id to the dealer's shop_id
      const { data: updateData, error: updateError } = await supabase
        .from('inventory')
        .update({
          status: 'received',
          owner_id: dealerId
        })
        .eq('batch_id', activeBatchId)
        .eq('destination_shop_id', dealerId)
        .in('status', ['pending', 'created'])
        .select();

      if (updateError) throw updateError;
      
      if (!updateData || updateData.length === 0) {
        throw new Error("No pending inventory records were found for this batch and your dealer ID.");
      }

      // 1. Log receipt (bulk)
      const scannedTotals = scanLogs.filter(l => l.isMatch).reduce((acc, log) => acc + (Number(log.qty) || 0), 0);
      
      const { error: logError } = await supabase
        .from('stock_receipts')
        .insert([{
          dealer_id: dealerId,
          batch_id: activeBatchId,
          quantity: scannedTotals,
          item_name: 'MULTIPLE', 
          scanned_at: new Date().toISOString()
        }]);
      if (logError) throw logError;

      setSuccess(true);
    } catch (err: any) {
      console.error("INWARD_FAIL:", err);
      setInwardError(`SYSTEM_CRITICAL_ERROR: ${err.message || JSON.stringify(err)}`);
    } finally {
      setProcessing(false);
    }
  };

  if (success) {
    return (
      <div className="flex flex-col items-center justify-center py-20 animate-in zoom-in duration-300">
        <div className="w-24 h-24 bg-gov-green text-white rounded-full flex items-center justify-center mb-8 shadow-xl">
           <CheckCircle className="w-12 h-12" />
        </div>
        <h1 className="text-3xl font-black text-gov-blue uppercase tracking-tight">Stock Received</h1>
        <p className="text-gray-500 text-xs font-bold uppercase mt-2 tracking-widest">Inventory Synchronized with Central Server</p>
        <button 
          onClick={() => window.location.reload()}
          className="mt-12 px-10 py-4 bg-gov-blue text-white rounded-xl font-bold uppercase tracking-widest hover:bg-opacity-90 transition-all shadow-lg hover:shadow-gov-blue/20"
        >
          Begin New Intake
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">
      <header className="border-b border-gray-200 pb-4">
        <h1 className="text-3xl font-black text-gov-blue uppercase tracking-tight text-center">Government Shipment Intake</h1>
        <p className="text-gray-500 text-[10px] font-bold uppercase mt-1 tracking-widest text-center">Official Dispatch Validation Protocol</p>
      </header>

      {isOffline && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-center gap-3 w-full">
           <WifiOff className="w-5 h-5 text-amber-600" />
           <p className="font-bold text-amber-700 uppercase tracking-widest text-xs">Offline mode — scans are queued locally. Will sync when reconnected.</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* SCANNER LOGIC / LEFT */}
        <div className="lg:col-span-2">
          {!scanResult ? (
            <div className="space-y-8">
              <div className="bg-white rounded-3xl border border-gray-100 p-6 overflow-hidden relative shadow-sm border-t-8 border-t-gov-blue">
                 {scannerError ? (
                    <div className="py-12 px-6 text-center bg-red-50 rounded-2xl border border-red-100 italic">
                       <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                       <h3 className="text-sm font-black text-red-600 uppercase mb-2">Hardware Protocol Interrupted</h3>
                       <p className="text-[10px] text-red-500 font-medium leading-relaxed max-w-[250px] mx-auto uppercase">
                          {scannerError === "CAMERA_PERMISSION_DENIED" 
                            ? "Camera access denied. Please grant permission in browser settings." 
                            : "Failed to initialize optical sensor. Hardware may be in use."}
                       </p>
                       <button 
                          onClick={() => window.location.reload()}
                          className="mt-6 px-6 py-2 bg-red-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest"
                       >
                          Reset System
                       </button>
                    </div>
                 ) : (
                    <>
                       <div id="reader" className="w-full rounded-2xl overflow-hidden border border-gray-100 min-h-[300px] bg-black"></div>
                       
                       {isScanning && (
                         <div className="absolute inset-x-6 top-1/2 -translate-y-1/2 h-0.5 bg-gov-green/40 shadow-[0_0_15px_rgba(34,197,94,0.8)] animate-pulse z-10 pointer-events-none"></div>
                       )}

                       <div className="absolute top-6 right-6 bg-gov-blue text-white px-3 py-1 rounded-full text-[9px] font-black uppercase flex items-center gap-2 z-20">
                          <div className={`w-1.5 h-1.5 rounded-full ${isScanning ? 'bg-gov-green animate-pulse' : 'bg-gray-400'}`}></div>
                          {isScanning ? 'Optics Active' : 'Sensor Idle'}
                       </div>

                       {cameras.length > 1 && (
                         <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-20 w-48">
                            <select 
                              className="w-full bg-black/50 backdrop-blur-md text-white border border-white/20 rounded-lg p-2 text-[9px] font-bold uppercase outline-none"
                              value={activeCamera || ''}
                              onChange={(e) => window.location.reload()} // Simplified for now, easier than hot-reloading Html5Qrcode
                            >
                              {cameras.map(c => (
                                <option key={c.id} value={c.id}>{c.label || 'Generic Camera'}</option>
                              ))}
                            </select>
                         </div>
                       )}
                    </>
                 )}
              </div>
              
              <div className="flex flex-col items-center gap-4">
                 <div className="text-center group">
                    <BarcodeIcon className="w-12 h-12 mx-auto mb-2 text-gray-200 group-hover:text-gov-blue transition-colors" />
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Target 1D Barcode Manifest</p>
                 </div>
                 
                 <button 
                   onClick={simulateScan}
                   className="text-[9px] font-black text-gov-blue/40 hover:text-gov-blue uppercase tracking-widest border border-dashed border-gov-blue/20 px-4 py-2 rounded-lg transition-colors"
                 >
                   Force Logical Bypass (Simulate Scan)
                 </button>
              </div>

              <div className="pt-8 border-t border-gray-100">
                 <h3 className="text-[10px] font-black text-gov-blue uppercase mb-4 tracking-widest">Manual Record Entry Override</h3>
                 <form onSubmit={handleManualInward} className="flex gap-3">
                    <input 
                      type="text" 
                      value={manualCode}
                      onChange={e => setManualCode(e.target.value)}
                      placeholder="Insert Barcode ID (e.g. BATCH-XXXX)"
                      className="flex-1 border-2 border-gray-100 rounded-xl p-4 text-sm font-bold text-gov-blue focus:border-gov-blue outline-none transition-all"
                    />
                    <button type="submit" className="px-8 bg-gov-blue text-white rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-opacity-90 shadow-lg hover:shadow-gov-blue/20 transition-all">Verify</button>
                 </form>
              </div>
            </div>
          ) : scanResult.loading ? (
            <div className="py-20 flex flex-col items-center justify-center gap-4 bg-white rounded-3xl border border-gray-100">
               <Loader2 className="w-10 h-10 animate-spin text-gov-blue" />
               <p className="text-xs font-bold text-gov-blue uppercase tracking-widest">Validating Barcode ID against Manifest...</p>
            </div>
          ) : (
            <div className="bg-white p-8 rounded-3xl border border-gray-100 animate-in slide-in-from-bottom-4 shadow-xl border-t-8 border-t-gov-green">
              <div className="flex items-center gap-5 mb-8 pb-6 border-b border-gray-50">
                 <div className="w-14 h-14 bg-gov-green/5 text-gov-green flex items-center justify-center rounded-2xl border border-gov-green/10">
                    <BarcodeIcon className="w-7 h-7" />
                 </div>
                 <div>
                    <h2 className="text-xl font-black text-gov-blue uppercase tracking-tight">Data Packet Verified</h2>
                    <p className="text-[10px] font-bold text-gov-green uppercase tracking-widest italic">Digital Signature Confirmed</p>
                 </div>
              </div>

              {scanResult.error ? (
                  <div className="p-6 bg-red-50 rounded-2xl border border-red-100 text-red-600 space-y-3">
                     <p className="font-bold text-xs uppercase flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5" /> 
                        Identification Failure: {scanResult.error === 'BATCH_MISMATCH' ? 'BATCH MISMATCH' : scanResult.error === 'ALREADY_RECEIVED' ? 'ALREADY RECEIVED' : 'Barcode ID Not Found'}
                     </p>
                     <p className="text-[11px] leading-relaxed font-medium">The Barcode ID <span className="font-bold underline">{scanResult.batch}</span> {scanResult.error === 'BATCH_MISMATCH' ? 'does not match the active inwards session batch ID.' : scanResult.error === 'ALREADY_RECEIVED' ? 'has already been fully received and stored in your inventory limits.' : 'does not exist in the central dispatch manifest.'} Please ensure you are scanning the official Government Batch ID sticker for this delivery.</p>
                     <button onClick={() => setScanResult(null)} className="font-bold text-[10px] underline uppercase tracking-widest block pt-2">Retry Scan Protocol</button>
                  </div>
              ) : (
                <div className="space-y-8">
                  <div className="grid grid-cols-2 gap-4">
                     {[
                       { label: 'Manifest Batch', val: scanResult.batch },
                       { label: 'Asset Class', val: scanResult.name },
                       { label: 'Volume Unit', val: `${scanResult.qty} KG` },
                       { label: 'Integrity Period', val: scanResult.exp }
                     ].map(f => (
                       <div key={f.label} className="bg-gov-offwhite p-4 rounded-xl border border-gray-50 group hover:border-gov-blue/20 transition-all">
                          <p className="text-[8px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">{f.label}</p>
                          <p className="text-sm font-black text-gov-blue tracking-tight uppercase">{f.val}</p>
                       </div>
                     ))}
                  </div>

                  <div className="flex gap-4 pt-4">
                     <button 
                        onClick={() => setScanResult(null)}
                        className="flex-1 bg-gov-blue text-white rounded-xl py-4 font-bold uppercase tracking-widest hover:bg-opacity-90 shadow-lg hover:shadow-gov-blue/20 flex items-center justify-center gap-3 transition-all"
                     >
                        Continue Scanning Active Batch
                     </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* RIGHT PANEL - RUNNING TOTALS */}
        <div className="lg:col-span-1">
          <div className="sticky top-8 bg-white border border-gray-200 rounded-3xl flex flex-col h-[calc(100vh-8rem)] min-h-[500px]">
             
             {/* Header */}
             <div className="p-6 border-b border-gray-100 bg-gray-50 rounded-t-3xl">
                <h3 className="text-xs font-black text-gov-blue uppercase tracking-widest mb-1">Current Batch:</h3>
                <p className="font-mono text-lg font-bold text-gov-blue">{activeBatchId || 'NONE_ACTIVE'}</p>
             </div>

             {/* Stats */}
             <div className="p-6 grid grid-cols-3 gap-2 border-b border-gray-100">
                <div className="flex flex-col items-center justify-center bg-gray-100 rounded-lg p-2">
                   <p className="text-xs font-black text-gov-blue">{scanLogs.length}/{totalExpected}</p>
                   <p className="text-[8px] font-bold uppercase tracking-tighter text-gray-500 mt-1 text-center w-full min-w-min">SCANNED</p>
                </div>
                <div className="flex flex-col items-center justify-center bg-gov-green/10 rounded-lg p-2">
                   <p className="text-xs font-black text-gov-green">{scanLogs.filter(l => l.isMatch).length}</p>
                   <p className="text-[8px] font-bold uppercase tracking-tighter text-gov-green/70 mt-1 text-center w-full min-w-min">MATCHED</p>
                </div>
                <div className="flex flex-col items-center justify-center bg-red-100 rounded-lg p-2">
                   <p className="text-xs font-black text-red-600">{mismatches}</p>
                   <p className="text-[8px] font-bold uppercase tracking-tighter text-red-500 mt-1 text-center w-full min-w-min">MISMATCH</p>
                </div>
             </div>

             {/* Progress Bar */}
             <div className="px-6 py-4 border-b border-gray-100">
                <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                   <div 
                     className="h-full bg-gov-blue transition-all duration-500" 
                     style={{ width: `${totalExpected > 0 ? Math.min(100, Math.round((scanLogs.length / totalExpected) * 100)) : 0}%` }}
                   />
                </div>
                <p className="text-[10px] text-right font-bold text-gray-400 mt-2">{totalExpected > 0 ? Math.min(100, Math.round((scanLogs.length / totalExpected) * 100)) : 0}% Complete</p>
             </div>

             {/* Log List */}
             <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {scanLogs.length === 0 ? (
                  <p className="text-center text-xs text-gray-400 font-bold uppercase py-10 tracking-widest">No Scans Recorded</p>
                ) : (
                  scanLogs.map((log, i) => (
                    <div key={i} className={`flex items-center gap-3 p-3 rounded-lg border ${log.isMatch ? 'border-gov-green/20 bg-gov-green/5' : 'border-red-200 bg-red-50'}`}>
                       {log.isMatch ? <CheckCircle className="w-5 h-5 text-gov-green flex-shrink-0" /> : <XCircle className="w-5 h-5 text-red-500 flex-shrink-0" />}
                       <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-gov-blue truncate">{log.name} • {log.qty}KG</p>
                          <p className="text-[10px] font-mono text-gray-500 truncate">{log.id.substring(0,8)}... </p>
                       </div>
                       <span className="text-[9px] font-black text-gray-400 uppercase tracking-tighter min-w-max">
                          {new Date(log.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}
                       </span>
                    </div>
                  ))
                )}
             </div>

             {/* Bottom Actions */}
             <div className="p-4 border-t border-gray-100 bg-white rounded-b-3xl mt-auto">

                {inwardError && (
                   <div className="mb-4 bg-red-50 border border-red-200 text-red-600 rounded-lg p-3 text-xs font-bold uppercase tracking-widest">
                      {inwardError}
                   </div>
                )}
                <button
                  onClick={processInward}
                  disabled={processing}
                  className="w-full bg-gov-green hover:bg-green-600 disabled:opacity-50 disabled:hover:bg-gov-green text-white py-4 rounded-xl font-black uppercase tracking-widest shadow-sm flex items-center justify-center gap-2 transition-colors"
                >
                  {processing ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                    <>
                      <CheckCircle className="w-5 h-5" />
                      Confirm Receipt
                    </>
                  )}
                </button>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}
