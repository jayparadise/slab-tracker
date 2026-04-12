import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://vfvmeshcqucxgxwkoqen.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZmdm1lc2hjcXVjeGd4d2tvcWVuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5Mzg2NTAsImV4cCI6MjA5MTUxNDY1MH0.LavRyQ31u3R338wJ39bSBC4ZgUh6FwGsvvt0jCpbRNQ';
export const POLL_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/poll-courtyard`;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
