import { AuthError, User } from '@supabase/supabase-js';
import { supabase } from './SupabaseService';

interface SignUpResponse {
  user: User | null;
  error: AuthError | null;
}

interface SignInResponse {
  user: User | null;
  error: AuthError | null;
  profile?: any;
}

export const signUp = async (
  email: string,
  password: string,
  username: string
): Promise<SignUpResponse> => {
  try {
    console.log('Starting signup process');

    // Sign up user without metadata
    const { data: authData, error: signUpError } = await supabase.auth.signUp({
      email,
      password
    });

    if (signUpError) throw signUpError;
    if (!authData.user) throw new Error('User creation failed');

    const user = authData.user;
    console.log('Auth user created:', user.id);

    // Create profile with username
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: user.id,
        username,
        email,
        updated_at: new Date().toISOString(),
      });

    if (profileError) {
      console.error('Profile creation error:', profileError);
      // If profile creation fails, we should delete the auth user
      await supabase.auth.admin.deleteUser(user.id);
      throw profileError;
    }

    console.log('Profile created successfully');
    return { user, error: null };
  } catch (error) {
    console.error('Error in signUp:', error);
    return { user: null, error: error as AuthError };
  }
};

export const signIn = async (
  email: string,
  password: string
): Promise<SignInResponse> => {
  try {
    console.log('Attempting sign in for:', email);
    
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) throw signInError;
    if (!data.user) throw new Error('No user returned from sign in');

    console.log('Sign in successful for user:', data.user.id);

    // Fetch profile data
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single();

    if (profileError) {
      console.error('Error fetching profile:', profileError);
      throw profileError;
    }

    console.log('Profile fetched successfully:', profileData);

    return { 
      user: data.user, 
      error: null,
      profile: profileData
    };

  } catch (error) {
    console.error('Error in signIn:', error);
    return { user: null, error: error as AuthError };
  }
};

export const signOut = async () => {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    console.log('Sign out successful');
    return { error: null };
  } catch (error) {
    console.error('Error in signOut:', error);
    return { error: error as AuthError };
  }
};

export const getCurrentUser = async () => {
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) throw error;

    if (user) {
      // Fetch profile data
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (profileError) {
        console.error('Error fetching profile:', profileError);
        throw profileError;
      }

      return { 
        user,
        profile: profileData,
        error: null 
      };
    }

    return { user: null, error: null };
  } catch (error) {
    console.error('Error in getCurrentUser:', error);
    return { user: null, error: error as AuthError };
  }
};

export const getUserProfile = async (userId: string) => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) throw error;
    return { profile: data, error: null };
  } catch (error) {
    console.error('Error in getUserProfile:', error);
    return { profile: null, error };
  }
};

// Add function to update profile
export const updateProfile = async (userId: string, updates: { [key: string]: any }) => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', userId)
      .single();

    if (error) throw error;
    return { profile: data, error: null };
  } catch (error) {
    console.error('Error in updateProfile:', error);
    return { profile: null, error };
  }
};