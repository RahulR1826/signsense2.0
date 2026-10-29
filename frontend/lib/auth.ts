import { API_URL } from "@/lib/api";

export type CommunicationMode = "signer" | "non_signer" | "both";

export interface Preferences {
  mode: CommunicationMode;
  sign_language: "ISL";
  sign_to_text: boolean;
  text_to_sign: boolean;
}

export interface User {
  id: string;
  name: string;
  email: string;
  preferences: Preferences | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** JSON request to the backend with the session cookie. Throws ApiError with the server's message. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  if (!res.ok) {
    let message = `Something went wrong (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") message = body.detail;
      else if (Array.isArray(body.detail)) message = body.detail[0]?.msg ?? message;
    } catch {}
    throw new ApiError(res.status, message);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const signup = (name: string, email: string, password: string) =>
  api<User>("/api/auth/signup", { method: "POST", body: JSON.stringify({ name, email, password }) });

export const login = (email: string, password: string) =>
  api<User>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });

export const logout = () => api<void>("/api/auth/logout", { method: "POST" });

/** The signed-in user, or null when signed out. */
export async function fetchMe(): Promise<User | null> {
  try {
    return await api<User>("/api/auth/me");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export const savePreferences = (prefs: Omit<Preferences, "sign_language">) =>
  api<Preferences>("/api/users/me/preferences", {
    method: "PUT",
    body: JSON.stringify({ ...prefs, sign_language: "ISL" }),
  });

export const updateProfile = (name: string) =>
  api<User>("/api/users/me", { method: "PATCH", body: JSON.stringify({ name }) });

/** Permanently delete the signed-in account (the password is required again). */
export const deleteAccount = (password: string) =>
  api<void>("/api/users/me", { method: "DELETE", body: JSON.stringify({ password }) });
