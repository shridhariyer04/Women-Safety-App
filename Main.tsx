import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Platform,
  PermissionsAndroid,
} from 'react-native';
import MapView, { Marker, Polyline, Circle } from 'react-native-maps';
import * as Location from 'expo-location';
import * as SMS from 'expo-sms';
import * as Notifications from 'expo-notifications';
import { distance } from '@turf/turf';
import { StatusBar } from 'expo-status-bar';
import { getEmergencyContacts, EmergencyContact } from './src/services/SupabaseService';
import { VoiceService } from './src/services/VoiceService';

interface Coordinates {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

interface LocationState {
  coordinates: Coordinates | null;
  address: string;
}

interface MainAppProps {
  initialUsername: string;
  navigation: { navigate: (screen: string) => void };
}

// Constants
const ROUTE_DEVIATION_THRESHOLD = 500; // 500 meters
const RESPONSE_TIMEOUT = 30000; // 30 seconds in milliseconds
const NOTIFICATION_COOLDOWN = 60000; // 1 minute between notifications

const MainApp: React.FC<MainAppProps> = ({ initialUsername, navigation }) => {
  // State declarations
  const [location, setLocation] = useState<Coordinates | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [destination, setDestination] = useState<LocationState>({ coordinates: null, address: '' });
  const [destinationInput, setDestinationInput] = useState<string>('');
  const [routeCoordinates, setRouteCoordinates] = useState<Coordinates[]>([]);
  const [emergencyContacts, setEmergencyContacts] = useState<EmergencyContact[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [voiceServiceActive, setVoiceServiceActive] = useState<boolean>(false);

  // Refs
  const mapRef = useRef<MapView | null>(null);
  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  const responseTimer = useRef<NodeJS.Timeout | null>(null);
  const notificationListener = useRef<any>();
  const responseListener = useRef<any>();
  const lastNotificationTime = useRef<number>(0);
  const voiceServiceRef = useRef<VoiceService | null>(null);

  useEffect(() => {
    const initializeApp = async () => {
      await configureNotifications();
      await requestPermissions();
      await startLocationTracking();
      await loadEmergencyContacts();
    };

    initializeApp().catch((error) => {
      console.error('Initialization error:', error);
      setErrorMsg('Failed to initialize app');
    });

    // Notification listeners
    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      console.log('Notification received:', notification);
    });

    responseListener.current = Notifications.addNotificationResponseReceivedListener(async response => {
      const actionId = response.actionIdentifier;
      const currentLocation = location;

      if (responseTimer.current) {
        clearTimeout(responseTimer.current);
        responseTimer.current = null;
      }

      if (actionId === 'SEND_ALERT') {
        if (currentLocation) {
          await sendEmergencyAlert(currentLocation);
          await Notifications.scheduleNotificationAsync({
            content: {
              title: '🚨 Alert Sent',
              body: 'Emergency alert has been sent to your contacts.',
            },
            trigger: null,
          });
        }
      } else if (actionId === 'IM_SAFE') {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: '✅ Status Updated',
            body: 'Glad you are safe! Route monitoring continues.',
          },
          trigger: null,
        });
      }
    });

    return () => {
      // Stop voice service when component unmounts
      voiceServiceRef.current?.stopListening();
      
      if (locationSubscription.current) locationSubscription.current.remove();
      if (responseTimer.current) clearTimeout(responseTimer.current);
      if (notificationListener.current) 
        Notifications.removeNotificationSubscription(notificationListener.current);
      if (responseListener.current) 
        Notifications.removeNotificationSubscription(responseListener.current);
    };
  }, []);

  const configureNotifications = async () => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('route-deviation', {
        name: 'Route Deviation Alerts',
        importance: Notifications.AndroidImportance.MAX,
        sound: 'default',
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        bypassDnd: true,
      });
    }

    await Notifications.setNotificationCategoryAsync('route-deviation', [
      {
        identifier: 'SEND_ALERT',
        buttonTitle: 'Send Alert',
        options: { isDestructive: true, isAuthenticationRequired: false },
      },
      {
        identifier: 'IM_SAFE',
        buttonTitle: "I'm Safe",
        options: { isDestructive: false, isAuthenticationRequired: false },
      },
    ]);
  };

  const requestPermissions = async () => {
    try {
      const { status: locStatus } = await Location.requestForegroundPermissionsAsync();
      if (locStatus !== 'granted') {
        setErrorMsg('Location permission denied');
        return false;
      }

      if (Platform.OS === 'android') {
        const micStatus = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          { 
            title: 'Microphone Permission', 
            message: 'App needs microphone access', 
            buttonPositive: 'OK' 
          }
        );
        if (micStatus !== PermissionsAndroid.RESULTS.GRANTED) {
          setErrorMsg('Microphone permission denied');
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error('Permission request error:', error);
      setErrorMsg('Failed to request permissions');
      return false;
    }
  };

  const loadEmergencyContacts = async () => {
    try {
      setIsLoading(true);
      const contacts = await getEmergencyContacts();
      setEmergencyContacts(contacts);
      
      // Initialize VoiceService with emergency contacts
      voiceServiceRef.current = new VoiceService(contacts);
      
      if (contacts.length > 0) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: '✅ Contacts Loaded',
            body: `Successfully loaded ${contacts.length} emergency contacts`,
          },
          trigger: null,
        });
      } else {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: '⚠️ No Contacts',
            body: 'No emergency contacts found. Please add contacts for safety alerts.',
          },
          trigger: null,
        });
      }
    } catch (error) {
      console.error('Error loading emergency contacts:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const startLocationTracking = async () => {
    try {
      const initialLocation = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
      });

      const initialCoords: Coordinates = {
        latitude: initialLocation.coords.latitude,
        longitude: initialLocation.coords.longitude,
        accuracy: initialLocation.coords.accuracy,
      };

      setLocation(initialCoords);
      setRouteCoordinates([initialCoords]);

      locationSubscription.current = await Location.watchPositionAsync(
        { 
          accuracy: Location.Accuracy.BestForNavigation, 
          timeInterval: 5000, 
          distanceInterval: 5 
        },
        (newLocation) => {
          const newCoords: Coordinates = {
            latitude: newLocation.coords.latitude,
            longitude: newLocation.coords.longitude,
            accuracy: newLocation.coords.accuracy,
          };
          
          setLocation(newCoords);
          setRouteCoordinates((prev) => [...prev, newCoords]);
          
          if (destination.coordinates) {
            checkRouteDeviation(newCoords);
          }
        }
      );
    } catch (error) {
      console.error('Location tracking error:', error);
      setErrorMsg('Failed to start location tracking');
    }
  };

  const sendEmergencyAlert = async (currentLocation: Coordinates): Promise<void> => {
    if (emergencyContacts.length === 0) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '⚠️ Alert Failed',
          body: 'No emergency contacts available',
        },
        trigger: null,
      });
      return;
    }

    try {
      const destinationName = destination.address || 'unknown location';
      const message = `EMERGENCY: ${initialUsername} may be in danger near ${destinationName}. Location: https://www.openstreetmap.org/?mlat=${currentLocation.latitude}&mlon=${currentLocation.longitude}`;
      
      const isAvailable = await SMS.isAvailableAsync();
      if (isAvailable) {
        const phoneNumbers = emergencyContacts.map(contact => contact.phone_number);
        const { result } = await SMS.sendSMSAsync(phoneNumbers, message);

        await Notifications.scheduleNotificationAsync({
          content: {
            title: result === 'sent' ? '✅ Alert Sent' : '⚠️ Alert Status',
            body: result === 'sent'
              ? `Emergency alert sent to ${emergencyContacts.length} contacts`
              : 'Message preparation failed',
          },
          trigger: null,
        });
      } else {
        throw new Error('SMS is not available');
      }
    } catch (error) {
      console.error('Error sending SMS:', error);
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '❌ Alert Failed',
          body: 'Failed to send emergency alert',
        },
        trigger: null,
      });
    }
  };

  const showDeviationNotification = async (currentLocation: Coordinates) => {
    try {
      if (responseTimer.current) {
        clearTimeout(responseTimer.current);
      }

      await Notifications.scheduleNotificationAsync({
        content: {
          title: '❗ Route Deviation Detected',
          body: 'Are you safe? Please respond within 30 seconds.',
          data: { currentLocation },
          categoryIdentifier: 'route-deviation',
          sound: 'default',
        },
        trigger: null,
      });

      responseTimer.current = setTimeout(async () => {
        if (responseTimer.current) {
          await sendEmergencyAlert(currentLocation);
          await Notifications.scheduleNotificationAsync({
            content: {
              title: '🚨 Automatic Alert Sent',
              body: 'No response received. Emergency contacts notified.',
            },
            trigger: null,
          });
        }
      }, RESPONSE_TIMEOUT);
    } catch (error) {
      console.error('Deviation notification error:', error);
      await sendEmergencyAlert(currentLocation);
    }
  };

  const checkRouteDeviation = (currentLocation: Coordinates): void => {
    if (!destination.coordinates) return;

    const now = Date.now();
    if (now - lastNotificationTime.current < NOTIFICATION_COOLDOWN) return;

    const deviationDistance = distance(
      [currentLocation.longitude, currentLocation.latitude],
      [destination.coordinates.longitude, destination.coordinates.latitude]
    ) * 1000; // Convert to meters

    if (deviationDistance > ROUTE_DEVIATION_THRESHOLD) {
      lastNotificationTime.current = now;
      showDeviationNotification(currentLocation);
    }
  };

  const simulateDeviation = (): void => {
    if (!location) return;

    const deviatedLocation: Coordinates = {
      latitude: location.latitude + (600 / 111320), // Approximately 600 meters north
      longitude: location.longitude,
      accuracy: location.accuracy
    };

    setLocation(deviatedLocation);
    setRouteCoordinates(prev => [...prev, deviatedLocation]);
    
    if (destination.coordinates) {
      checkRouteDeviation(deviatedLocation);
    }
  };

  const geocodeDestination = async (address: string): Promise<Coordinates | null> => {
    try {
      const results = await Location.geocodeAsync(address);
      if (results.length > 0) {
        return { 
          latitude: results[0].latitude, 
          longitude: results[0].longitude 
        };
      }
      setErrorMsg('Could not find destination');
      return null;
    } catch (error) {
      console.error('Geocoding error:', error);
      setErrorMsg('Failed to geocode destination');
      return null;
    }
  };

  const handleSetDestination = async () => {
    if (!destinationInput.trim()) {
      setErrorMsg('Please enter a destination');
      return;
    }

    const coords = await geocodeDestination(destinationInput);
    if (coords) {
      setDestination({ coordinates: coords, address: destinationInput });
      
      // Start voice listening when destination is set
      if (voiceServiceRef.current) {
        try {
          await voiceServiceRef.current.startListening();
          setVoiceServiceActive(true);
          
          await Notifications.scheduleNotificationAsync({
            content: {
              title: '🎙️ Voice Safety Active',
              body: 'Voice safety monitoring is now active',
            },
            trigger: null,
          });
        } catch (error) {
          console.error('Failed to start voice service:', error);
          await Notifications.scheduleNotificationAsync({
            content: {
              title: '⚠️ Voice Safety Failed',
              body: 'Could not activate voice safety feature',
            },
            trigger: null,
          });
        }
      }

      if (location && mapRef.current) {
        mapRef.current.fitToCoordinates([location, coords], {
          edgePadding: { top: 50, right: 50, bottom: 50, left: 50 },
          animated: true,
        });
      }

      // Notify about emergency contacts
      if (emergencyContacts.length === 0) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: '⚠️ No Emergency Contacts',
            body: 'Please add emergency contacts for safety',
          },
          trigger: null,
        });
      }
    }
  };

  const stopVoiceService = () => {
    if (voiceServiceRef.current) {
      voiceServiceRef.current.stopListening();
      setVoiceServiceActive(false);
    }
  };

  const handleLogout = async () => {
    try {
      navigation.navigate('Login');
    } catch (error) {
      console.error('Logout error:', error);
      setErrorMsg('Failed to logout');
    }
  };

  if (errorMsg) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>{errorMsg}</Text>
        <TouchableOpacity style={styles.button} onPress={() => setErrorMsg(null)}>
          <Text style={styles.buttonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {location ? (
        <>
          <MapView
            ref={mapRef}
            style={styles.map}
            initialRegion={{
              latitude: location.latitude,
              longitude: location.longitude,
              latitudeDelta: 0.0922,
              longitudeDelta: 0.0421,
            }}
            showsUserLocation={true}
          >
            {location.accuracy && (
              <Circle
                center={location}
                radius={location.accuracy}
                strokeWidth={1}
                strokeColor="rgba(0, 150, 255, 0.5)"
                fillColor="rgba(0, 150, 255, 0.1)"
              />
            )}
            
            {destination.coordinates && (
              <>
                <Marker 
                  coordinate={destination.coordinates} 
                  title={destination.address} 
                  pinColor="blue" 
                />
                <Polyline
                  coordinates={[location, destination.coordinates]}
                  strokeColor="#4a90e2"
                  strokeWidth={3}
                  lineDashPattern={[5, 5]}
                />
              </>
            )}
            
            {routeCoordinates.length > 1 && (
              <Polyline
                coordinates={routeCoordinates}
                strokeColor="#000"
                strokeWidth={3}
              />
            )}
          </MapView>

          <View style={styles.headerContainer}>
            <Text style={styles.welcomeText}>Welcome, {initialUsername}</Text>
            <TouchableOpacity style={styles.button} onPress={handleLogout}>
              <Text style={styles.buttonText}>Logout</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Enter Destination:</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., Mumbai"
              value={destinationInput}
              onChangeText={setDestinationInput}
            />
            <TouchableOpacity style={styles.button} onPress={handleSetDestination}>
              <Text style={styles.buttonText}>Set Destination</Text>
            </TouchableOpacity>

            {destination.coordinates && (
              <TouchableOpacity 
                style={[styles.button, styles.testButton]} 
                onPress={simulateDeviation}
              >
                <Text style={styles.buttonText}>Test Route Deviation</Text>
              </TouchableOpacity>
            )}

            {voiceServiceActive && (
              <TouchableOpacity 
                style={[styles.button, styles.voiceStopButton]} 
                onPress={stopVoiceService}
              >
                <Text style={styles.buttonText}>Stop Voice Safety</Text>
              </TouchableOpacity>
            )}

            <Text style={styles.contactInfo}>
              {emergencyContacts.length > 0 
                ? `${emergencyContacts.length} emergency contacts loaded` 
                : 'No emergency contacts found'}
            </Text>
          </View>

          <StatusBar style="auto" />
        </>
      ) : (
        <View style={styles.loadingContainer}>
          <Text>Loading location...</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  map: { flex: 1 },
  errorText: { color: 'red', textAlign: 'center', marginTop: 50 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  headerContainer: {
    position: 'absolute',
    top: 40,
    left: 10,
    right: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'white',
    padding: 10,
    borderRadius: 10,
    elevation: 5,
  },
  welcomeText: { fontSize: 16, fontWeight: 'bold' },
  button: { backgroundColor: '#007AFF', padding: 10, borderRadius: 5, marginVertical: 5 },
  testButton: { backgroundColor: '#FF6B6B', marginTop: 10 },
  voiceStopButton: { backgroundColor: '#FF6B6B', marginTop: 10 },
  buttonText: { color: 'white', fontWeight: 'bold' },
  inputContainer: {
    position: 'absolute',
    top: 100,
    left: 10,
    right: 10,
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 10,
    elevation: 5,
  },
  inputLabel: { fontSize: 16, marginBottom: 10 },
  input: { 
    borderWidth: 1, 
    borderColor: '#ddd', 
    padding: 10, 
    borderRadius: 5, 
    marginBottom: 10 
  },
  contactInfo: { 
    marginTop: 10, 
    textAlign: 'center', 
    color: '#666' 
  },
});

export default MainApp;