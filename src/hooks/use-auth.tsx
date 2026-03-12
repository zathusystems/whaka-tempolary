
'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { syncService } from '@/lib/services/sync-service';
import { normalizeRole } from '@/lib/rbac/role-utils';

// Define the shape of the user object and the auth context
export interface User {
  uid: string;
  email?: string;
  phone?: string;
  displayName: string;
  role: 'Admin' | 'Manager' | 'Cashier' | 'Waiter' | 'User';
  photoURL?: string;
  branchId?: string;
  businessId?: string;
}

export interface Business {
  id: string;
  name: string;
  type: string;
  currency?: string;
  selectedAt: string;
}

interface AuthContextType {
  user: User | null;
  business: Business | null;
  loading: boolean;
  login: (user: User) => void;
  logout: () => void;
  selectBusiness: (business: Business) => void;
}

// Create the context with a default undefined value
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Define the props for the AuthProvider
interface AuthProviderProps {
  children: ReactNode;
}

const AUTH_STORAGE_KEYS = {
  USER: 'handy-pos-user',
  BUSINESS: 'handy-pos-business',
  TOKENS: 'handypos-auth-tokens',
  LEGACY_TOKENS: 'handy-pos-auth-tokens',
  ACTIVE_BRANCH: 'handypos-active-branch',
  BUSINESS_CACHE: 'handypos-business',
  BUSINESS_SETTINGS: 'handypos-business-settings',
} as const;

const readValidAuthTokens = (): { access: string; refresh: string } | null => {
  const primary = localStorage.getItem(AUTH_STORAGE_KEYS.TOKENS);
  const legacy = localStorage.getItem(AUTH_STORAGE_KEYS.LEGACY_TOKENS);
  const rawTokens = primary ?? legacy;

  if (!rawTokens) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawTokens);
    const access = typeof parsed?.access === 'string' ? parsed.access : '';
    const refresh = typeof parsed?.refresh === 'string' ? parsed.refresh : '';

    if (!access || !refresh) {
      throw new Error('Invalid token payload');
    }

    // Migrate legacy token key to the canonical key.
    if (!primary && legacy) {
      localStorage.setItem(
        AUTH_STORAGE_KEYS.TOKENS,
        JSON.stringify({ access, refresh })
      );
    }
    localStorage.removeItem(AUTH_STORAGE_KEYS.LEGACY_TOKENS);

    return { access, refresh };
  } catch (error) {
    console.error('Failed to parse auth tokens from localStorage', error);
    localStorage.removeItem(AUTH_STORAGE_KEYS.TOKENS);
    localStorage.removeItem(AUTH_STORAGE_KEYS.LEGACY_TOKENS);
    return null;
  }
};

const pickFirstString = (...values: Array<unknown>): string => {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
};

const buildUserFromProfiles = (profile: any, staffProfile: any | null): User | null => {
  const email = pickFirstString(
    profile?.email,
    profile?.user?.email,
    staffProfile?.email,
    staffProfile?.user?.email
  );
  const phone = pickFirstString(
    profile?.phone,
    profile?.user?.phone,
    staffProfile?.phone,
    staffProfile?.user?.phone
  );
  const displayName =
    pickFirstString(
      profile?.display_name,
      profile?.displayName,
      profile?.name,
      profile?.full_name,
      profile?.fullName,
      staffProfile?.name,
      staffProfile?.full_name
    ) ||
    (email ? email.split('@')[0] : '') ||
    phone ||
    'User';
  const rawRole = staffProfile?.role ?? profile?.role;
  const businessId = pickFirstString(
    staffProfile?.business_id,
    staffProfile?.business,
    profile?.business_id,
    profile?.business,
    profile?.businessId
  );
  const branchId = pickFirstString(
    staffProfile?.branch_id,
    staffProfile?.branch,
    staffProfile?.branchId
  );
  const uid = pickFirstString(
    profile?.uid,
    profile?.id,
    profile?.user_id,
    staffProfile?.user_id,
    email,
    phone,
    staffProfile?.id
  );

  if (!uid) {
    return null;
  }

  const normalizedRole = normalizeRole(rawRole, {
    fallback: 'User',
    preferAdminForGenericUser: Boolean(businessId),
  }) as User['role'];

  return {
    uid,
    email: email || undefined,
    phone: phone || undefined,
    displayName,
    role: normalizedRole,
    branchId: branchId || undefined,
    businessId: businessId || undefined,
  };
};

// Create a provider component
export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);

  const clearAuthStorage = () => {
    localStorage.removeItem(AUTH_STORAGE_KEYS.USER);
    localStorage.removeItem(AUTH_STORAGE_KEYS.BUSINESS);
    localStorage.removeItem(AUTH_STORAGE_KEYS.TOKENS);
    localStorage.removeItem(AUTH_STORAGE_KEYS.LEGACY_TOKENS);
    localStorage.removeItem(AUTH_STORAGE_KEYS.BUSINESS_CACHE);
    localStorage.removeItem(AUTH_STORAGE_KEYS.BUSINESS_SETTINGS);

    const authFetch = require('@/lib/auth-fetch').authFetch;
    if (authFetch && authFetch.logout) {
      authFetch.logout();
    }
  };

  useEffect(() => {
    let cancelled = false;

    const bootstrapAuth = async () => {
      // Check for a user and business in localStorage on initial load
      try {
        const tokens = readValidAuthTokens();
        const hasValidTokens = Boolean(tokens);
        const storedUser = localStorage.getItem(AUTH_STORAGE_KEYS.USER);
        const storedBusiness = localStorage.getItem(AUTH_STORAGE_KEYS.BUSINESS);

        if (storedUser && hasValidTokens) {
          const parsedUser = JSON.parse(storedUser);
          const normalizedUser: User = {
            ...parsedUser,
            role: normalizeRole(parsedUser?.role, {
              fallback: 'User',
              preferAdminForGenericUser: Boolean(parsedUser?.businessId),
            }) as User['role'],
          };
          if (!cancelled) {
            setUser(normalizedUser);
          }
          localStorage.setItem(AUTH_STORAGE_KEYS.USER, JSON.stringify(normalizedUser));
        } else if (storedUser) {
          localStorage.removeItem(AUTH_STORAGE_KEYS.USER);
        }

        if (storedBusiness && hasValidTokens) {
          if (!cancelled) {
            setBusiness(JSON.parse(storedBusiness));
          }
        } else if (storedBusiness) {
          localStorage.removeItem(AUTH_STORAGE_KEYS.BUSINESS);
        }

        if (hasValidTokens && !storedUser) {
          try {
            const authFetch = require('@/lib/auth-fetch').authFetch;
            let staffProfile: any = null;
            let profile: any = null;

            try {
              staffProfile = await authFetch.fetch<any>('/staff/me/');
            } catch (error) {
              console.warn('[Auth] Staff profile not available, falling back to account profile', error);
            }

            try {
              profile = await authFetch.fetch<any>('/accounts/me/');
            } catch (error) {
              console.warn('[Auth] Account profile fetch failed', error);
            }

            const rebuiltUser = buildUserFromProfiles(profile, staffProfile);
            if (rebuiltUser) {
              localStorage.setItem(AUTH_STORAGE_KEYS.USER, JSON.stringify(rebuiltUser));
              if (!cancelled) {
                setUser(rebuiltUser);
              }
            }
          } catch (error) {
            console.warn('[Auth] Failed to rebuild user from profile:', error);
          }
        }

        if (!hasValidTokens && (storedUser || storedBusiness)) {
          clearAuthStorage();
        }
      } catch (error) {
        console.error('Failed to parse from localStorage', error);
        clearAuthStorage();
      }

      if (!cancelled) {
        setLoading(false);
      }

      // Initialize sync service connectivity listener for offline-first sync
      syncService.setupConnectivityListener();
      console.log('[Auth] Sync service connectivity listener initialized');
    };

    void bootstrapAuth();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = (userData: User) => {
    const normalizedUserData: User = {
      ...userData,
      role: normalizeRole(userData.role, {
        fallback: 'User',
        preferAdminForGenericUser: Boolean(userData.businessId),
      }) as User['role'],
    };

    // Only clear tokens if we're switching users (different uid)
    const storedUser = localStorage.getItem(AUTH_STORAGE_KEYS.USER);
    let currentUser: User | null = null;
    if (storedUser) {
      try {
        currentUser = JSON.parse(storedUser);
      } catch {
        localStorage.removeItem(AUTH_STORAGE_KEYS.USER);
      }
    }
    
    // If switching to a different user, clear user-scoped caches.
    // Do not eagerly clear auth tokens here because authFetch.login/register
    // already replaces tokens, and clearing here can wipe the new session.
    if (currentUser && currentUser.uid !== normalizedUserData.uid) {
      localStorage.removeItem(AUTH_STORAGE_KEYS.BUSINESS_CACHE);
      localStorage.removeItem(AUTH_STORAGE_KEYS.BUSINESS_SETTINGS);
      localStorage.removeItem(AUTH_STORAGE_KEYS.BUSINESS);
      setBusiness(null);

      // Only clear tokens if none are stored (e.g., offline/manual user switch).
      const rawTokens =
        localStorage.getItem(AUTH_STORAGE_KEYS.TOKENS) ??
        localStorage.getItem(AUTH_STORAGE_KEYS.LEGACY_TOKENS);
      let hasStoredTokens = false;
      if (rawTokens) {
        try {
          const parsedTokens = JSON.parse(rawTokens);
          hasStoredTokens = Boolean(parsedTokens?.access && parsedTokens?.refresh);
        } catch {
          hasStoredTokens = false;
        }
      }

      if (!hasStoredTokens) {
        localStorage.removeItem(AUTH_STORAGE_KEYS.TOKENS);
        localStorage.removeItem(AUTH_STORAGE_KEYS.LEGACY_TOKENS);
        const authFetch = require('@/lib/auth-fetch').authFetch;
        if (authFetch && authFetch.logout) {
          authFetch.logout();
        }
      }
    }
    
    // Now set the new user
    localStorage.setItem(AUTH_STORAGE_KEYS.USER, JSON.stringify(normalizedUserData));
    setUser(normalizedUserData);
  };

  const logout = () => {
    clearAuthStorage();
    setUser(null);
    setBusiness(null);
  };

  const selectBusiness = (businessData: Business) => {
    localStorage.setItem(AUTH_STORAGE_KEYS.BUSINESS, JSON.stringify(businessData));
    setBusiness(businessData);
  };

  const value = { user, business, loading, login, logout, selectBusiness };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Create a custom hook to use the auth context
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
