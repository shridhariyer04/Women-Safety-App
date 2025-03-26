// SupabaseService.ts
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const supabaseUrl = 'https://zdsmispzryzzduamrfcz.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpkc21pc3B6cnl6emR1YW1yZmN6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzcwNDM1MjcsImV4cCI6MjA1MjYxOTUyN30.hUGLhWsQkUkgma_sWxYB4It_1lpBO-LFnd511GS5pjE';

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export interface EmergencyContact {
  id: number;
  user_id?: string;
  user_name: string;
  contact_name: string;
  phone_number: string;
  relationship?: string;
  notes?: string;
  created_at: string;
}

export interface Profile {
  id: string;
  username: string;
  email: string;
  updated_at: string;
}

export const getEmergencyContacts = async (): Promise<EmergencyContact[]> => {
  try {
    // Get the current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
      console.error('User authentication error:', userError);
      throw new Error('User not authenticated');
    }

    // Fetch emergency contacts for the current user
    const { data, error } = await supabase
      .from('emergency_contacts')
      .select('*')
      .eq('user_id', user.id);

    if (error) {
      console.error('Supabase query error:', error);
      throw new Error(`Failed to fetch contacts: ${error.message}`);
    }

    console.log('Fetched contacts:', data); // Debug log
    return data || [];
  } catch (error) {
    console.error('GetEmergencyContacts error:', error);
    throw error;
  }
};

export const addEmergencyContact = async (
  contact: Omit<EmergencyContact, 'id' | 'created_at' | 'user_id'>
): Promise<EmergencyContact> => {
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
      throw new Error('User not authenticated');
    }

    const { data, error } = await supabase
      .from('emergency_contacts')
      .insert([
        {
          ...contact,
          user_id: user.id
        }
      ])
      .select()
      .single();

    if (error) {
      console.error('Insert contact error:', error);
      throw error;
    }

    return data;
  } catch (error) {
    console.error('AddEmergencyContact error:', error);
    throw error;
  }
};

export const deleteEmergencyContact = async (contactId: number): Promise<void> => {
  try {
    const { error } = await supabase
      .from('emergency_contacts')
      .delete()
      .eq('id', contactId);

    if (error) {
      throw error;
    }
  } catch (error) {
    console.error('DeleteEmergencyContact error:', error);
    throw error;
  }
};

export const updateEmergencyContact = async (
  contactId: number,
  updates: Partial<EmergencyContact>
): Promise<EmergencyContact> => {
  try {
    const { data, error } = await supabase
      .from('emergency_contacts')
      .update(updates)
      .eq('id', contactId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  } catch (error) {
    console.error('UpdateEmergencyContact error:', error);
    throw error;
  }
};