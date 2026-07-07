import { createClient } from "@supabase/supabase-js";
import { createInitialState, normalizeState, STORAGE_KEY } from "./model";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

export function isSupabaseEnabled() {
  return Boolean(supabase);
}

export async function signIn(email, password) {
  if (!supabase) return { role: "관리자", email: "local" };
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return getSessionProfile();
}

export async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function getSessionProfile() {
  if (!supabase) return { role: "관리자", email: "local" };
  const { data: sessionData } = await supabase.auth.getSession();
  const user = sessionData.session?.user;
  if (!user) return null;

  const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  return { role: data?.role || "선생님", email: user.email };
}

export async function loadAppState() {
  if (!supabase) {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return normalizeState(raw || createInitialState());
  }

  const { data, error } = await supabase.from("app_state").select("data").eq("id", "main").maybeSingle();
  if (error) throw error;
  return normalizeState(data?.data || createInitialState());
}

export async function saveAppState(state) {
  const normalized = normalizeState(state);
  if (!supabase) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  const { error } = await supabase.from("app_state").upsert({
    id: "main",
    data: normalized,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
  return normalized;
}
