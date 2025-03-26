import React, { useState, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { AuthScreens } from './src/components/AuthScreen';
import MainApp from './Main';
import { getCurrentUser } from './src/services/AuthService';

export default function App() {
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => {
    checkUser();
  }, []);

  const checkUser = async () => {
    try {
      const { user } = await getCurrentUser();
      if (user?.user_metadata?.username) {
        setUsername(user.user_metadata.username);
      }
    } catch (error) {
      console.error('Error checking user:', error);
    }
  };

  const handleAuthSuccess = (newUsername: string) => {
    setUsername(newUsername);
  };

  return (
    <View style={styles.container}>
      {username ? (
        <MainApp initialUsername={username} />
      ) : (
        <AuthScreens onAuthSuccess={handleAuthSuccess} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});