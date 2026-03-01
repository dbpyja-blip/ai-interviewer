import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Type for candidate details
export interface CandidateDetails {
  id?: string
  full_name: string
  email: string
  phone?: string
  position: string
  experience_level: string
  resume_file_name?: string
  resume_file_path?: string
  resume_file_size?: number
  resume_file_type?: string
  created_at?: string
  updated_at?: string
}
