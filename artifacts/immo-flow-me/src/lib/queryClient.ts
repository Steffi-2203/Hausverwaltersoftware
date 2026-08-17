import { QueryClient } from '@tanstack/react-query';

export function getAuthToken(): string | null {
  return localStorage.getItem('auth_token');
}

export function setAuthToken(token: string) {
  localStorage.setItem('auth_token', token);
}

export function clearAuthToken() {
  localStorage.removeItem('auth_token');
}

function addAuthHeaders(headers: Record<string, string>) {
  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
}

const originalFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
  let isApiRequest = false;
  if (url.startsWith('/api/')) {
    isApiRequest = true;
  } else {
    try {
      const parsed = new URL(url, window.location.origin);
      if (parsed.origin === window.location.origin && parsed.pathname.startsWith('/api/')) {
        isApiRequest = true;
      }
    } catch {}
  }
  if (isApiRequest) {
    const token = getAuthToken();
    if (token) {
      const existingHeaders = new Headers(init?.headers);
      if (!existingHeaders.has('Authorization')) {
        existingHeaders.set('Authorization', `Bearer ${token}`);
      }
      init = { ...init, headers: existingHeaders };
    }
  }
  const response = await originalFetch(input, init);

  // 2FA-Erzwingung: privilegierte Nutzer ohne aktive 2FA bekommen vom Server
  // 403 + code "2FA_SETUP_REQUIRED". Zur Einrichtung weiterleiten statt die
  // Seite mit stummen Fehlern zu blockieren.
  if (isApiRequest && response.status === 403) {
    const path = window.location.pathname;
    if (path !== '/2fa-einrichten' && path !== '/login') {
      try {
        const data = await response.clone().json();
        if (data?.code === '2FA_SETUP_REQUIRED') {
          window.location.href = '/2fa-einrichten';
        }
      } catch {}
    }
  }

  return response;
};

export async function apiRequest(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  body?: unknown
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body) {
    headers['Content-Type'] = 'application/json';
  }
  addAuthHeaders(headers);

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include',
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Request failed with status ${response.status}`);
  }

  return response;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      refetchOnWindowFocus: false,
      queryFn: async ({ queryKey }) => {
        const url = queryKey[0] as string;
        if (!url.startsWith('/')) return undefined;
        const headers: Record<string, string> = {};
        addAuthHeaders(headers);
        const response = await fetch(url, { 
          headers,
          credentials: 'include',
        });
        if (response.status === 401) return null;
        if (!response.ok) {
          throw new Error(`${response.status}: ${response.statusText}`);
        }
        return response.json();
      },
    },
  },
});
