import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAuthToken, setAuthToken, clearAuthToken } from "@/lib/queryClient";

interface User {
  id: string;
  email: string;
  fullName: string | null;
  organizationId: string | null;
  roles: string[];
}

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function fetchUser(): Promise<User | null> {
  const response = await fetch("/api/auth/user", {
    headers: getAuthHeaders(),
    credentials: 'include',
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`${response.status}: ${response.statusText}`);
  }

  return response.json();
}

async function loginFn(email: string, password: string): Promise<User & { token?: string } | { requires2FA: true }> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Anmeldung fehlgeschlagen");
  }

  return response.json();
}

async function registerFn(data: {
  email: string;
  password: string;
  fullName?: string;
  token?: string;
}): Promise<User> {
  const response = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json();
    const err: any = new Error(error.error || "Registrierung fehlgeschlagen");
    err.code = error.code; // z.B. 2FA_SETUP_REQUIRED (Pflicht-Einrichtung)
    throw err;
  }

  return response.json();
}

async function logoutFn(): Promise<void> {
  const headers: Record<string, string> = {};
  const authToken = getAuthToken();
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

  await fetch("/api/auth/logout", {
    method: "POST",
    headers,
    credentials: 'include',
  });
  clearAuthToken();
}

export const useAuth = () => {
  const queryClient = useQueryClient();
  
  const { data: user, isLoading: loading, refetch } = useQuery<User | null>({
    queryKey: ["/api/auth/user"],
    queryFn: fetchUser,
    retry: false,
    staleTime: 1000 * 60 * 5,
  });

  const loginMutation = useMutation({
    mutationFn: (data: { email: string; password: string }) => 
      loginFn(data.email, data.password),
    onSuccess: (userData) => {
      if ('requires2FA' in userData) return;
      if ('token' in userData && userData.token) {
        setAuthToken(userData.token);
      }
      queryClient.setQueryData(["/api/auth/user"], userData);
      queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
    },
  });

  const registerMutation = useMutation({
    mutationFn: registerFn,
    onSuccess: (userData: any) => {
      if (userData.token) {
        setAuthToken(userData.token);
      }
      queryClient.setQueryData(["/api/auth/user"], userData);
      queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: logoutFn,
    onSuccess: () => {
      queryClient.setQueryData(["/api/auth/user"], null);
      queryClient.setQueryData(["/api/profile"], null);
      queryClient.clear();
    },
  });

  const login = async (email: string, password: string) => {
    return loginMutation.mutateAsync({ email, password });
  };

  const register = async (data: {
    email: string;
    password: string;
    fullName?: string;
    token?: string;
  }) => {
    return registerMutation.mutateAsync(data);
  };

  const signIn = async (email: string, password: string) => {
    try {
      const result = await loginMutation.mutateAsync({ email, password });
      return { error: null, data: result };
    } catch (err: any) {
      return { error: { message: err.message || "Anmeldung fehlgeschlagen" }, data: null };
    }
  };
  const signUp = async (
    email: string, 
    password: string, 
    fullName?: string, 
    _companyName?: string, 
    inviteToken?: string
  ) => {
    return register({ email, password, fullName, token: inviteToken });
  };

  const signOut = async () => {
    await logoutMutation.mutateAsync();
    return { error: null };
  };

  const logout = signOut;

  return {
    user: user ? {
      id: user.id,
      email: user.email,
      user_metadata: {
        full_name: user.fullName || user.email,
        avatar_url: null,
      }
    } : null,
    session: user ? { user } : null,
    loading,
    login,
    register,
    logout,
    signIn,
    signUp,
    signOut,
    refetch,
    isAuthenticated: !!user,
  };
};
