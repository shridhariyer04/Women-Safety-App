import React, { useState } from 'react';
import { View, TextInput, TouchableOpacity, Text, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { signIn, signUp } from '../services/AuthService';
import { EmergencyContactsForm } from './EmergencyContactsForm';

interface AuthScreensProps {
  onAuthSuccess: (username: string) => void;
}

export const AuthScreens: React.FC<AuthScreensProps> = ({ onAuthSuccess }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [showEmergencyForm, setShowEmergencyForm] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState<string>('');

  const handleAuth = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    setLoading(true);
    try {
      if (isLogin) {
        const { user, error, profile } = await signIn(email, password);
        if (error) throw error;
        if (profile?.username) {
          onAuthSuccess(profile.username);
        } else {
          Alert.alert('Error', 'Username not found in profile');
        }
      } else {
        if (!username.trim()) {
          Alert.alert('Error', 'Username is required');
          return;
        }
        const { user, error } = await signUp(email, password, username);
        if (error) throw error;
        
        // Store userId for emergency contacts form
        if (user?.id) {
          setUserId(user.id);
          setShowEmergencyForm(true);
        } else {
          throw new Error('User ID not found after signup');
        }
      }
    } catch (error: any) {
      console.error('Auth error:', error);
      Alert.alert('Error', error.message || 'An error occurred during authentication');
      setLoading(false);
    }
  };

  const handleEmergencyContactsComplete = () => {
    Alert.alert(
      'Success',
      'Account created successfully!',
      [
        {
          text: 'OK',
          onPress: () => {
            // Reset form and show login
            setShowEmergencyForm(false);
            setIsLogin(true);
            setEmail('');
            setPassword('');
            setUsername('');
            setLoading(false);
          }
        }
      ]
    );
  };

  const validateEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validatePassword = (password: string) => {
    return password.length >= 6;
  };

  const validateUsername = (username: string) => {
    return username.length >= 3;
  };

  const handleSubmit = async () => {
    // Validate email
    if (!validateEmail(email)) {
      Alert.alert('Error', 'Please enter a valid email address');
      return;
    }

    // Validate password
    if (!validatePassword(password)) {
      Alert.alert('Error', 'Password must be at least 6 characters long');
      return;
    }

    // Validate username for signup
    if (!isLogin && !validateUsername(username)) {
      Alert.alert('Error', 'Username must be at least 3 characters long');
      return;
    }

    handleAuth();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{isLogin ? 'Login' : 'Sign Up'}</Text>
      
      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        editable={!loading}
        autoComplete="email"
      />
      
      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        editable={!loading}
        autoComplete="password"
      />
      
      {!isLogin && (
        <TextInput
          style={styles.input}
          placeholder="Username"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          editable={!loading}
          autoComplete="username"
        />
      )}
      
      <TouchableOpacity 
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={styles.buttonText}>
            {isLogin ? 'Login' : 'Sign Up'}
          </Text>
        )}
      </TouchableOpacity>
      
      <TouchableOpacity 
        style={styles.switchButton}
        onPress={() => {
          setIsLogin(!isLogin);
          setEmail('');
          setPassword('');
          setUsername('');
        }}
        disabled={loading}
      >
        <Text style={styles.switchText}>
          {isLogin ? 'Need an account? Sign Up' : 'Already have an account? Login'}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5F5F5', // Light gray background
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 30,
    textAlign: 'center',
    color: '#333333', // Dark gray text
  },
  input: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#E0E0E0', // Light gray border
    padding: 15,
    marginBottom: 15,
    borderRadius: 12,
    backgroundColor: 'white',
    fontSize: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  button: {
    backgroundColor: '#007AFF', // Bright blue
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
    elevation: 4,
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    width: '100%', // Make button full width
  },
  buttonDisabled: {
    backgroundColor: '#999',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  switchButton: {
    marginTop: 20,
    alignItems: 'center',
    padding: 10,
  },
  switchText: {
    color: '#007AFF', // Match button color
    fontSize: 16,
    fontWeight: '500',
    textDecorationLine: 'underline',
  },
});