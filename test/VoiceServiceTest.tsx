import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { VoiceService } from '../src/services/VoiceService';

// Mock emergency contacts for testing
const mockEmergencyContacts = [
  { id: '1', name: 'Test Contact 1', phone_number: '1234567890' },
  { id: '2', name: 'Test Contact 2', phone_number: '0987654321' },
];

export default function VoiceServiceTest() {
  const [voiceService, setVoiceService] = useState<VoiceService | null>(null);
  const [status, setStatus] = useState<string>('Not initialized');

  useEffect(() => {
    // Initialize voice service
    const service = new VoiceService(mockEmergencyContacts);
    setVoiceService(service);
    setStatus('Initialized');

    // Cleanup on component unmount
    return () => {
      service.stopListening();
    };
  }, []);

  const handleStartListening = async () => {
    if (!voiceService) {
      Alert.alert('Error', 'Voice service not initialized');
      return;
    }

    try {
      await voiceService.startListening();
      setStatus('Listening for trigger words...');
    } catch (error) {
      console.error('Error starting listening:', error);
      Alert.alert('Error', 'Failed to start listening');
    }
  };

  const handleStopListening = () => {
    if (!voiceService) {
      Alert.alert('Error', 'Voice service not initialized');
      return;
    }

    voiceService.stopListening();
    setStatus('Stopped listening');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Emergency Voice Detection</Text>
      <Text style={styles.statusText}>Status: {status}</Text>
      <View style={styles.buttonContainer}>
        <TouchableOpacity 
          style={[styles.button, styles.startButton]} 
          onPress={handleStartListening}
        >
          <Text style={styles.buttonText}>Start Listening</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.button, styles.stopButton]} 
          onPress={handleStopListening}
        >
          <Text style={styles.buttonText}>Stop Listening</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5FCFF',
    padding: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  statusText: {
    fontSize: 18,
    marginBottom: 20,
    textAlign: 'center',
    color: '#333',
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  button: {
    flex: 1,
    padding: 15,
    borderRadius: 10,
    marginHorizontal: 10,
    alignItems: 'center',
  },
  startButton: {
    backgroundColor: '#4CAF50',
  },
  stopButton: {
    backgroundColor: '#F44336',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
});