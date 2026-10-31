import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { 
  LayoutDashboard, 
  Package, 
  Users, 
  QrCode, 
  LogOut, 
  Menu as MenuIcon,
  X,
  User as UserIcon,
  ShieldCheck,
  PackageCheck
} from 'lucide-react';
import { useState } from 'react';

export function Layout() {
  const { profile, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navItems = [
    { label: 'Analytics', icon: LayoutDashboard, path: '/admin/analytics', roles: ['admin'] },
    { label: 'Fraud Alerts', icon: ShieldCheck, path: '/admin/fraud', roles: ['admin'] },
    { label: 'Manage Stock', icon: Package, path: '/admin/stock', roles: ['admin'] },
    { label: 'Manage Users', icon: Users, path: '/admin/users', roles: ['admin'] },
    
    { label: 'Dealer Portal', icon: LayoutDashboard, path: '/dealer', roles: ['dealer'] },
    { label: 'Receive Stock', icon: QrCode, path: '/dealer/receive', roles: ['dealer'] },
    { label: 'Distribute Ration', icon: PackageCheck, path: '/dealer/distribute', roles: ['dealer'] },
    
    { label: 'My Ration', icon: LayoutDashboard, path: '/consumer', roles: ['beneficiary'] },
  ];

  const filteredNav = navItems.filter(item => item.roles.includes(profile?.role || ''));

  return (
    <div className="min-h-screen bg-gov-offwhite flex">
      {/* Horizontal Top Bar for Mobile Branding */}
      <div className="lg:hidden fixed top-0 w-full h-14 bg-white border-b border-gray-200 z-50 flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gov-blue flex items-center justify-center rounded">
                <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-xs uppercase tracking-tight text-gov-blue">e-Ration India</span>
        </div>
        <button 
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="p-2 text-gov-blue"
        >
          {isMobileMenuOpen ? <X /> : <MenuIcon />}
        </button>
      </div>

      {/* Sidebar - Desktop */}
      <aside className={`
        fixed inset-y-0 left-0 z-40 w-64 bg-gov-blue text-white transform transition-transform duration-300 lg:translate-x-0 lg:sticky lg:top-0 lg:h-screen lg:self-start lg:shrink-0
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="h-full flex flex-col">
          {/* Logo Section */}
          <div className="p-6 border-b border-white/10">
            <div className="flex items-center gap-3 mb-4">
              <img 
                src={`${import.meta.env.BASE_URL}Annahpravah 1.svg`} 
                alt="AnnaPravah Logo" 
                className="w-10 h-10 object-contain"
              />
              <div>
                <h1 className="text-sm font-black tracking-tight uppercase leading-none">AnnaPravah</h1>
                <p className="text-[10px] opacity-60 font-mono mt-1">v1.0.1 - SECURE</p>
              </div>
            </div>
            
            {/* User Profile Summary */}
            <div className="bg-white/5 rounded-lg p-3 border border-white/10">
              <p className="text-[10px] uppercase font-bold text-white/40 mb-1">Authenticated As</p>
              <p className="text-xs font-bold truncate">{profile?.name}</p>
              <div className="flex items-center gap-1.5 mt-2">
                <span className="w-1.5 h-1.5 rounded-full bg-gov-green animate-pulse"></span>
                <p className="text-[9px] uppercase font-mono tracking-wider opacity-60 italic">{profile?.role}</p>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 py-6 px-4 space-y-1 overflow-y-auto">
            {filteredNav.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={`
                    flex items-center gap-3 px-4 py-3 rounded-md transition-all group
                    ${isActive 
                      ? 'bg-gov-saffron text-white shadow-lg' 
                      : 'text-white/70 hover:bg-white/5 hover:text-white'}
                  `}
                >
                  <item.icon className={`w-5 h-5 ${isActive ? 'text-white' : 'text-white/40 group-hover:text-white'}`} />
                  <span className="text-xs font-bold uppercase tracking-wide">{item.label}</span>
                </Link>
              );
            })}

            {/* EXIT_PORTAL — sits right below the last nav item */}
            <div className="pt-3 mt-3 border-t border-white/10">
              <button
                onClick={handleLogout}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-md bg-white/5 text-white/50 hover:bg-red-500 hover:text-white transition-all text-xs font-bold uppercase"
              >
                <LogOut className="w-4 h-4" />
                Logout
              </button>
            </div>
          </nav>

          {/* Footer tricolor */}
          <div className="p-4 border-t border-white/10">
            <div className="flex justify-center gap-3 text-white/20">
               <div className="h-1 w-8 bg-gov-saffron rounded-full"></div>
               <div className="h-1 w-8 bg-white rounded-full"></div>
               <div className="h-1 w-8 bg-gov-green rounded-full"></div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Header */}
        <header className="hidden lg:flex items-center justify-between px-8 py-4 bg-white border-b border-gray-200 shadow-sm relative overflow-hidden">
           <div className="absolute top-0 right-0 w-32 h-full flex items-stretch">
              <div className="w-1/3 bg-gov-saffron/5"></div>
              <div className="w-1/3 bg-white"></div>
              <div className="w-1/3 bg-gov-green/5"></div>
           </div>
          <div>
            <h2 className="text-xs font-black uppercase text-gov-blue/40 tracking-[0.2em] mb-0.5 font-mono underline decoration-gov-saffron decoration-2 underline-offset-4">NODE_{location.pathname.substring(1).toUpperCase() || 'CORE'}</h2>
            <p className="text-lg font-bold text-gov-blue tracking-tight">Public Distribution System Command</p>
          </div>
          <div className="flex items-center gap-6 relative z-10">
            <div className="text-right">
              <p className="text-[10px] font-bold text-gov-blue/40 uppercase">System Status</p>
              <p className="text-xs font-black text-gov-green">ONLINE_SYNCED</p>
            </div>
            <div className="h-10 w-[1px] bg-gray-200"></div>
            <button className="flex items-center gap-3 bg-white px-4 py-2 border border-gray-200 rounded-md hover:border-gov-blue transition-all group">
               <div className="w-2 h-2 rounded-full bg-gov-green group-hover:animate-ping"></div>
               <span className="text-[10px] font-bold uppercase text-gov-blue">Central_Hub_Active</span>
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto pt-20 lg:pt-0">
          <div className="max-w-7xl mx-auto p-4 lg:p-10">
             <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
