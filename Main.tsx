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
import { WebView } from 'react-native-webview'; // Correct import
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

const MAPBOX_API_KEY = 'pk.eyJ1Ijoic2hyZWVwYXdhbiIsImEiOiJjbHR4M2RlOWIwMXN2MmtwajMyaGxncnIxIn0.7tHp71unIQLe0cs_Azj4eQ';
const ROUTE_DEVIATION_THRESHOLD = 500; // 500 meters
const RESPONSE_TIMEOUT = 30000; // 30 secs
const NOTIFICATION_COOLDOWN = 60000; // 1 min

const speechRecognitionHtml = `
  <!DOCTYPE html>
  <html>
  <body>
    <script>
      const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onresult = (event) => {
        const transcript = event.results[event.results.length - 1][0].transcript.toLowerCase();
        if (transcript.includes('help') || transcript.includes('save me')) {
          window.ReactNativeWebView.postMessage('trigger:' + transcript);
        }
      };

      recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
      };

      recognition.onend = () => {
        recognition.start(); // Keep it running
      };

      recognition.start();
    </script>
  </body>
  </html>
`;

const MainApp: React.FC<MainAppProps> = ({ initialUsername, navigation }) => {
  const [location, setLocation] = useState<Coordinates | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [destination, setDestination] = useState<LocationState>({ coordinates: null, address: '' });
  const [destinationInput, setDestinationInput] = useState<string>('');
  const [routeCoordinates, setRouteCoordinates] = useState<Coordinates[]>([]);
  const [emergencyContacts, setEmergencyContacts] = useState<EmergencyContact[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [voiceServiceActive, setVoiceServiceActive] = useState<boolean>(false);

  const mapRef = useRef<MapView | null>(null);
  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  const responseTimer = useRef<NodeJS.Timeout | null>(null);
  const notificationListener = useRef<any>();
  const responseListener = useRef<any>();
  const lastNotificationTime = useRef<number>(0);
  const voiceServiceRef = useRef<VoiceService | null>(null);

  const fetchMapboxRoute = async (start: Coordinates, end: Coordinates) => {
    try {
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${start.longitude},${start.latitude};${end.longitude},${end.latitude}?geometries=geojson&access_token=${MAPBOX_API_KEY}`;
      const response = await fetch(url);
      const data = await response.json();

      if (data.routes && data.routes.length > 0) {
        const coords = data.routes[0].geometry.coordinates.map(([longitude, latitude]: [number, number]) => ({
          latitude,
          longitude,
        }));
        setRouteCoordinates(coords);
        return coords;
      }
      throw new Error('No route found, bro!');
    } catch (error) {
      console.error('Mapbox route error:', error);
      setErrorMsg('Route fetch failed—check your connection!');
      return null;
    }
  };

  const setupVoiceService = (contacts: EmergencyContact[]) => {
    voiceServiceRef.current = new VoiceService(contacts);
  };

  useEffect(() => {
    const initializeApp = async () => {
      await configureNotifications();
      await requestPermissions();
      await startLocationTracking();
      const contacts = await loadEmergencyContacts();
      setupVoiceService(contacts);
    };

    initializeApp().catch((error) => {
      console.error('Init went boom:', error);
      setErrorMsg('App startup failed—let’s retry!');
    });

    notificationListener.current = Notifications.addNotificationReceivedListener((notification) => {
      console.log('Notification dropped:', notification);
    });

    responseListener.current = Notifications.addNotificationResponseReceivedListener(async (response) => {
      const actionId = response.actionIdentifier;
      const currentLocation = location;

      if (responseTimer.current) {
        clearTimeout(responseTimer.current);
        responseTimer.current = null;
      }

      if (actionId === 'SEND_ALERT' && currentLocation) {
        await sendEmergencyAlert(currentLocation);
        await Notifications.scheduleNotificationAsync({
          content: { title: '🚨 Alert Sent', body: 'Your squad’s got your back!' },
          trigger: null,
        });
      } else if (actionId === 'IM_SAFE') {
        await Notifications.scheduleNotificationAsync({
          content: { title: '✅ Chill Vibes', body: 'Good to know you’re safe, fam!' },
          trigger: null,
        });
      }
    });

    return () => {
      if (voiceServiceRef.current) voiceServiceRef.current.stopListening();
      if (locationSubscription.current) locationSubscription.current.remove();
      if (responseTimer.current) clearTimeout(responseTimer.current);
      if (notificationListener.current) Notifications.removeNotificationSubscription(notificationListener.current);
      if (responseListener.current) Notifications.removeNotificationSubscription(responseListener.current);
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
      { identifier: 'SEND_ALERT', buttonTitle: 'Send Alert', options: { isDestructive: true } },
      { identifier: 'IM_SAFE', buttonTitle: "I'm Safe", options: { isDestructive: false } },
    ]);
  };

  const requestPermissions = async () => {
    try {
      const { status: locStatus } = await Location.requestForegroundPermissionsAsync();
      if (locStatus !== 'granted') {
        setErrorMsg('Location permission denied—can’t track without it!');
        return false;
      }

      if (Platform.OS === 'android') {
        const micStatus = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
        if (micStatus !== PermissionsAndroid.RESULTS.GRANTED) {
          setErrorMsg('Mic permission denied—voice feature’s toast!');
          return false;
        }
      }
      return true;
    } catch (error) {
      console.error('Permission request blew up:', error);
      setErrorMsg('Permissions failed—check your settings!');
      return false;
    }
  };

  const loadEmergencyContacts = async () => {
    try {
      setIsLoading(true);
      const contacts = await getEmergencyContacts();
      setEmergencyContacts(contacts);
      return contacts;
    } catch (error) {
      console.error('Contacts load failed:', error);
      return [];
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
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 5000, distanceInterval: 5 },
        (newLocation) => {
          const newCoords: Coordinates = {
            latitude: newLocation.coords.latitude,
            longitude: newLocation.coords.longitude,
            accuracy: newLocation.coords.accuracy,
          };
          setLocation(newCoords);
          setRouteCoordinates((prev) => [...prev, newCoords]);
          if (destination.coordinates) checkRouteDeviation(newCoords);
        }
      );
    } catch (error) {
      console.error('Location tracking crashed:', error);
      setErrorMsg('Can’t track location—retry time!');
    }
  };

  const sendEmergencyAlert = async (currentLocation: Coordinates, audioUrl?: string): Promise<void> => {
    if (emergencyContacts.length === 0) {
      await Notifications.scheduleNotificationAsync({
        content: { title: '⚠️ No Squad', body: 'Add some emergency contacts, bro!' },
        trigger: null,
      });
      return;
    }

    try {
      const destinationName = destination.address || 'unknown spot';
      const message = `EMERGENCY: ${initialUsername} might be in trouble near ${destinationName}. Location: https://www.openstreetmap.org/?mlat=${currentLocation.latitude}&mlon=${currentLocation.longitude}${audioUrl ? ` - Voice clip: ${audioUrl}` : ''}`;

      const phoneNumbers = emergencyContacts.map((contact) => contact.phone_number);
      const isAvailable = await SMS.isAvailableAsync();
      if (isAvailable) {
        const { result } = await SMS.sendSMSAsync(phoneNumbers, message);
        await Notifications.scheduleNotificationAsync({
          content: {
            title: result === 'sent' ? '✅ Alert Dropped' : '⚠️ Alert Glitch',
            body: result === 'sent' ? `Hit up ${emergencyContacts.length} contacts—help’s on the way!` : 'SMS didn’t fly—check it!',
          },
          trigger: null,
        });
      } else {
        throw new Error('SMS ain’t working, bro!');
      }
    } catch (error) {
      console.error('Alert send failed:', error);
      await Notifications.scheduleNotificationAsync({
        content: { title: '❌ Alert Crashed', body: 'Emergency alert didn’t send—retry!' },
        trigger: null,
      });
    }
  };

  const showDeviationNotification = async (currentLocation: Coordinates) => {
    try {
      if (responseTimer.current) clearTimeout(responseTimer.current);

      await Notifications.scheduleNotificationAsync({
        content: {
          title: '❗ Off the Path!',
          body: 'You good, fam? Hit us back in 30 secs!',
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
            content: { title: '🚨 Auto-Alert', body: 'No reply—squad’s been pinged!' },
            trigger: null,
          });
        }
      }, RESPONSE_TIMEOUT);
    } catch (error) {
      console.error('Deviation alert failed:', error);
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
    ) * 1000;

    if (deviationDistance > ROUTE_DEVIATION_THRESHOLD) {
      lastNotificationTime.current = now;
      showDeviationNotification(currentLocation);
    }
  };

  const simulateDeviation = (): void => {
    if (!location) return;
    const deviatedLocation: Coordinates = {
      latitude: location.latitude + 600 / 111320,
      longitude: location.longitude,
      accuracy: location.accuracy,
    };
    setLocation(deviatedLocation);
    setRouteCoordinates((prev) => [...prev, deviatedLocation]);
    if (destination.coordinates) checkRouteDeviation(deviatedLocation);
  };

  const geocodeDestination = async (address: string): Promise<Coordinates | null> => {
    try {
      const results = await Location.geocodeAsync(address);
      if (results.length > 0) {
        return { latitude: results[0].latitude, longitude: results[0].longitude };
      }
      setErrorMsg('Destination not found—try again!');
      return null;
    } catch (error) {
      console.error('Geocoding bombed:', error);
      setErrorMsg('Geocoding failed—check your input!');
      return null;
    }
  };

  const handleSetDestination = async () => {
    if (!destinationInput.trim()) {
      setErrorMsg('Yo, drop a destination first!');
      return;
    }

    const coords = await geocodeDestination(destinationInput);
    if (coords && location) {
      setDestination({ coordinates: coords, address: destinationInput });
  
      const route = await fetchMapboxRoute(location, coords);
      if (route && mapRef.current) {
        mapRef.current.fitToCoordinates(route, {
          edgePadding: { top: 50, right: 50, bottom: 50, left: 50 },
          animated: true,
        });
      }

      if (voiceServiceRef.current) {
        setVoiceServiceActive(true);
        await Notifications.scheduleNotificationAsync({
          content: { title: '🎙️ Mic’s Hot', body: 'Shout “help” or “save me” if you’re in trouble!' },
          trigger: null,
        });
      }

      if (emergencyContacts.length === 0) {
        await Notifications.scheduleNotificationAsync({
          content: { title: '⚠️ No Crew', body: 'Add some emergency contacts, bro!' },
          trigger: null,
        });
      }
    }
  };

  const stopVoiceService = () => {
    if (voiceServiceRef.current) {
      voiceServiceRef.current.stopListening();
      setVoiceServiceActive(false);
      Notifications.scheduleNotificationAsync({
        content: { title: '🎙️ Mic Off', body: 'Voice monitoring stopped!' },
        trigger: null,
      });
    }
  };

  const handleWebViewMessage = (event: { nativeEvent: { data: string } }) => {
    const message = event.nativeEvent.data;
    if (message.startsWith('trigger:')) {
      const transcription = message.replace('trigger:', '');
      console.log('WebView trigger detected:', transcription);
      if (voiceServiceRef.current) {
        voiceServiceRef.current.startFullRecording();
      }
    }
  };

  const handleLogout = async () => {
    try {
      stopVoiceService();
      navigation.navigate('Login');
    } catch (error) {
      console.error('Logout crashed:', error);
      setErrorMsg('Logout failed—try again!');
    }
  };

  if (errorMsg) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>{errorMsg}</Text>
        <TouchableOpacity style={styles.button} onPress={() => setErrorMsg(null)}>
          <Text style={styles.buttonText}>Retry, Bro!</Text>
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
                <Marker coordinate={destination.coordinates} title={destination.address} pinColor="blue" />
                <Polyline coordinates={routeCoordinates} strokeColor="#4a90e2" strokeWidth={3} />
              </>
            )}
            {routeCoordinates.length > 1 && (
              <Polyline coordinates={routeCoordinates} strokeColor="#000" strokeWidth={3} />
            )}
          </MapView>

          <View style={styles.headerContainer}>
            <Text style={styles.welcomeText}>Yo {initialUsername}, You’re Locked In!</Text>
            <TouchableOpacity style={styles.button} onPress={handleLogout}>
              <Text style={styles.buttonText}>Bounce Out</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Drop Your Spot:</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., Mumbai"
              value={destinationInput}
              onChangeText={setDestinationInput}
            />
            <TouchableOpacity style={styles.button} onPress={handleSetDestination}>
              <Text style={styles.buttonText}>Lock It In</Text>
            </TouchableOpacity>

            {destination.coordinates && (
              <TouchableOpacity style={[styles.button, styles.testButton]} onPress={simulateDeviation}>
                <Text style={styles.buttonText}>Test the Drift</Text>
              </TouchableOpacity>
            )}

            {voiceServiceActive && (
              <>
                <TouchableOpacity style={[styles.button, styles.voiceStopButton]} onPress={stopVoiceService}>
                  <Text style={styles.buttonText}>Kill Voice Mode</Text>
                </TouchableOpacity>
                <WebView
                  source={{ html: speechRecognitionHtml }}
                  style={styles.webview}
                  onMessage={handleWebViewMessage}
                  javaScriptEnabled={true}
                  domStorageEnabled={true}
                />
              </>
            )}

            <Text style={styles.contactInfo}>
              {emergencyContacts.length > 0
                ? `${emergencyContacts.length} homies on deck`
                : 'No crew yet—add some!'}
            </Text>
          </View>

          <StatusBar style="auto" />
        </>
      ) : (
        <View style={styles.loadingContainer}>
          <Text>Tracking your vibe...</Text>
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
  input: { borderWidth: 1, borderColor: '#ddd', padding: 10, borderRadius: 5, marginBottom: 10 },
  contactInfo: { marginTop: 10, textAlign: 'center', color: '#666' },
  webview: {
    width: 1,
    height: 1,
    opacity: 0,
  },
});

export default MainApp;