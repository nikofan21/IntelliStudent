const TOKEN_KEY = "access_token";
const ROLE_KEY = "role";

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ROLE_KEY);
}

export function setRole(role: string) {
  localStorage.setItem(ROLE_KEY, role);
}

export function getRole(): string | null {
  return localStorage.getItem(ROLE_KEY);
}

/* 🔥 НОВОЕ — проверка авторизации */
export function isAuthenticated(): boolean {
  const token = getToken();
  return !!token;
}