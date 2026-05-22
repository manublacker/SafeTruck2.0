import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://bxhduayxffanioaclzrd.supabase.co";
const supabaseKey = "sb_publishable_Vav07LwckYgdS4xHnvEqMQ_IiFTpjXb";

export const supabase = createClient(supabaseUrl, supabaseKey);
