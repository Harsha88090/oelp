import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://rrdomvdgkdbjlbsnndwy.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJyZG9tdmRna2Riamxic25uZHd5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MDUyMjQsImV4cCI6MjA5MTM4MTIyNH0.2mGEi6M-O_frVcfZ_KPZb1RcbovWBnFM5FTWuptHJys";

export const supabase = createClient(supabaseUrl, supabaseKey);