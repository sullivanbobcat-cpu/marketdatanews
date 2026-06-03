// supabase-client.js
// Shared Supabase client for all auth pages.
// Keys are publishable (client-safe). Edit SUPABASE_URL or SUPABASE_KEY here if you rotate.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = 'https://orfplzzrsxqvlyevgpwa.supabase.co'
const SUPABASE_KEY = 'sb_publishable_Lph6CZMsadJKtVgI0eSXCw_-0fmAgH3'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    detectSessionInUrl: true,
    persistSession: true,
  },
})
