import { supabase } from './SupabaseService';

export interface EmergencyContact {
  id?: number;
  user_id: string;
  contact_name: string;
  phone_number: string;
  relationship?: string;
  notes?: string;
}

export const getEmergencyContacts = async (): Promise<EmergencyContact[]> => {
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
      throw new Error('User not authenticated');
    }

    const { data, error } = await supabase
      .from('emergency_contacts')
      .select('*')
      .eq('user_id', user.id);

    if (error) {
      console.error('Error fetching emergency contacts:', error);
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error('Error in getEmergencyContacts:', error);
    throw error;
  }
};

export const addEmergencyContact = async (contact: Omit<EmergencyContact, 'user_id'>): Promise<EmergencyContact> => {
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
          user_id: user.id,
        }
      ])
      .select()
      .single();

    if (error) {
      console.error('Error adding emergency contact:', error);
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Error in addEmergencyContact:', error);
    throw error;
  }
};

export const updateEmergencyContact = async (
  id: number,
  updates: Partial<EmergencyContact>
): Promise<EmergencyContact> => {
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
      throw new Error('User not authenticated');
    }

    const { data, error } = await supabase
      .from('emergency_contacts')
      .update(updates)
      .eq('id', id)
      .eq('user_id', user.id) // Ensure user can only update their own contacts
      .select()
      .single();

    if (error) {
      console.error('Error updating emergency contact:', error);
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Error in updateEmergencyContact:', error);
    throw error;
  }
};

export const deleteEmergencyContact = async (id: number): Promise<void> => {
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
      throw new Error('User not authenticated');
    }

    const { error } = await supabase
      .from('emergency_contacts')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id); // Ensure user can only delete their own contacts

    if (error) {
      console.error('Error deleting emergency contact:', error);
      throw error;
    }
  } catch (error) {
    console.error('Error in deleteEmergencyContact:', error);
    throw error;
  }
};