import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://hxyhcmlrwjxldtvkqiet.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh4eWhjbWxyd2p4bGR0dmtxaWV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk5MzQ5ODQsImV4cCI6MjA3NTUxMDk4NH0.NWbGgkXp6YD643z8BnbNn3Y9THBJXMSI_VyS8veAyno'

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";
