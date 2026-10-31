import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Loader2, ShieldCheck, Info } from 'lucide-react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';

const Login: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [secret, setSecret] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    
    const result = await login(email, secret);
    
    if (!result.success) {
      setErrorMsg(result.error || 'Verification Failed: Please check your credentials.');
      setLoading(false);
    }
    else{
      navigate('/');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gov-offwhite p-6 relative overflow-hidden">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-[420px] z-10"
      >
        {/* Logo Section */}
        <div className="flex flex-col items-center mb-10">
          <img 
            src={`${import.meta.env.BASE_URL}Annahpravah 1.svg`}
            alt="AnnaPravah Logo" 
            className="w-16 h-16 object-contain mb-4"
          />
          <h1 className="text-xl font-black text-gov-blue uppercase tracking-widest text-center">
            AnnaPravah - Smart Public Distribution System
          </h1>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.3em] mt-1 italic">
            Verification Gateway
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-[32px] border border-gray-100 shadow-2xl shadow-gray-200/50 p-8">
          <div className="mb-8 text-center">
            <h2 className="text-xs font-black text-gov-blue uppercase tracking-widest mb-1">Unified Security Gateway</h2>
            <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider italic">Authorized Access Only</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-4">
              <div>
                <label className="label-caps mb-2 block">Service Email</label>
                <input 
                  required
                  type="email"
                  placeholder="e.g. n2001@pds.gov.in"
                  className="w-full h-14 px-5 bg-gray-50 border border-gray-100 rounded-2xl outline-none focus:border-gov-blue focus:bg-white transition-all text-sm font-medium"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div>
                <label className="label-caps mb-2 block">Secure Password</label>
                <input 
                  required
                  type="password"
                  placeholder="Enter access code"
                  className="w-full h-14 px-5 bg-gray-50 border border-gray-100 rounded-2xl outline-none focus:border-gov-blue focus:bg-white transition-all text-sm font-medium"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                />
              </div>
            </div>

            {errorMsg && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="p-4 bg-red-50 rounded-2xl flex items-start gap-3 border border-red-100"
              >
                <Info className="w-4 h-4 text-red-500 mt-0.5" />
                <p className="text-[10px] text-red-600 font-bold uppercase leading-relaxed">
                  {errorMsg}
                </p>
              </motion.div>
            )}

            <button 
              disabled={loading}
              className="w-full h-14 bg-gov-blue text-white rounded-2xl font-black uppercase text-[11px] tracking-widest shadow-xl shadow-gov-blue/20 hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                'Secure Gateway Access'
              )}
            </button>
          </form>

          <div className="mt-8 pt-8 border-t border-gray-100 text-center">
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest leading-loose">
              By accessing this system, you agree to the <br />
              <span className="text-gov-blue">Compliance Framework</span>
            </p>
          </div>
        </div>

        {/* Footer Info */}
        <div className="mt-10 flex items-center justify-between px-4">
          <div className="flex items-center gap-2 grayscale opacity-50">
             <div className="w-6 h-6 bg-gov-saffron rounded-full"></div>
             <div className="w-6 h-6 bg-white rounded-full border border-gray-200"></div>
             <div className="w-6 h-6 bg-gov-green rounded-full"></div>
          </div>
          <p className="text-[9px] font-black text-gray-300 uppercase tracking-widest">
            • 2026
          </p>
        </div>
      </motion.div>
    </div>
  );
};

export default Login;
