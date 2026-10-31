import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { type User } from '@supabase/supabase-js';

interface FamilyMember {
  name: string;
  relation: string;
  age: number;
  aadhaarMasked: string;
}

interface UserProfile {
  uid: string;                        // auth UUID
  email: string | null;
  role: 'admin' | 'dealer' | 'beneficiary';
  name: string;
  dealerId?: string;                  // dealer: FPS code e.g. N2001 (business_id col); also their UUID for DB queries
  dealerUUID?: string;                // dealer: their UUID (users.id) — used for owner_id queries
  beneficiaryId?: string;             // beneficiary: ration card ID e.g. R-P1001
  assignedShopId?: string;            // beneficiary: FPS code e.g. N2001 for display
  assignedShopUUID?: string;          // beneficiary: dealer UUID — used for owner_id/destination_shop_id queries
  shopName?: string;
  zone?: string;
  state?: string;
  city?: string;
  area?: string;
  mobile?: string;
  aadhaarMasked?: string;
  familyMembers?: FamilyMember[];
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  login: (email: string, pass: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  login: async () => ({ success: false }),
  logout: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const initializedRef = useRef(false);

  const buildProfile = (data: any, authUser: User, beneficiaryRecord?: any): UserProfile => ({
    uid: data.id,
    email: authUser.email ?? null,
    role: data.role as 'admin' | 'dealer' | 'beneficiary',
    name: data.name,

    // DEALER fields
    // business_id column stores FPS code (N2001 etc.) — used for display
    dealerId: data.role === 'dealer' ? (data.business_id || data.shop_name) : undefined,
    // data.id is the dealer's UUID — used for DB queries on owner_id, destination_shop_id
    dealerUUID: data.role === 'dealer' ? data.id : undefined,

    // BENEFICIARY fields
    // beneficiaries.id is the ration card ID (R-P1001)
    beneficiaryId: data.role === 'beneficiary' ? (beneficiaryRecord?.id || undefined) : undefined,
    // associated_dealer_id stores FPS code (N2001) — for display
    assignedShopId: data.role === 'beneficiary' ? data.associated_dealer_id : undefined,
    // beneficiaries.assigned_shop_id is the dealer UUID — for DB queries
    assignedShopUUID: data.role === 'beneficiary' ? (beneficiaryRecord?.assigned_shop_id || undefined) : undefined,

    shopName: data.shop_name,
    zone: data.zone,
    state: data.state,
    city: data.city,
    area: data.area,
    mobile: data.mobile || '9876543210',
    aadhaarMasked: data.aadhaar_masked || 'XXXX-XXXX-8888',
    familyMembers: data.role === 'beneficiary'
      ? [{ name: data.name, relation: 'Head', age: 42, aadhaarMasked: 'XXXX-XXXX-8888' }]
      : undefined,
  });

  const fetchProfile = async (authUser: User): Promise<void> => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        let beneficiaryRecord: any = null;
        if (data.role === 'beneficiary') {
          const { data: beneData } = await supabase
            .from('beneficiaries')
            .select('id, assigned_shop_id')
            .eq('name', data.name)
            .maybeSingle();
          beneficiaryRecord = beneData;
        }
        setProfile(buildProfile(data, authUser, beneficiaryRecord));
      } else {
        console.warn('Profile not found in "users" table for Auth UID:', authUser.id);
        setProfile(null);
      }
    } catch (err) {
      console.error('Error fetching profile:', err);
      setProfile(null);
    }
  };

  useEffect(() => {
    const initialize = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const currentUser = session?.user ?? null;
      setUser(currentUser);
      if (currentUser) await fetchProfile(currentUser);
      initializedRef.current = true;
      setLoading(false);
    };

    initialize();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (!initializedRef.current) return;
      if (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') return;

      const newUser = newSession?.user ?? null;
      setUser(newUser);

      if (event === 'SIGNED_IN' && newUser) {
        await fetchProfile(newUser);
      } else if (event === 'SIGNED_OUT') {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const login = async (email: string, pass: string) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass });
      if (error) return { success: false, error: error.message };
      if (data.user) {
        await fetchProfile(data.user);
        return { success: true };
      }
      return { success: false, error: 'Unknown authentication error' };
    } catch (err: any) {
      return { success: false, error: err.message || 'Verification Failed' };
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
