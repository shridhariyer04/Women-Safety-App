import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, Platform, Alert, Linking } from 'react-native';
import MapView, { Marker, Polyline, Circle } from 'react-native-maps';
import * as Location from 'expo-location';
import * as SMS from 'expo-sms';
import { distance } from '@turf/turf';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Application from 'expo-application';
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { Audio } from 'expo-av';
import Voice from '@react-native-voice/voice';
import { getEmergencyContacts, EmergencyContact, supabase } from './src/services/SupabaseService';
import { signOut } from './src/services/AuthService';
import { EmergencyContactManager } from './src/components/EmergencyContactManager';

// Type definitions
interface Coordinates {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

interface LocationState {
  coordinates: Coordinates | null;
  address: string;
}

interface NavigationProp {
  navigate: (screen: string, params?: any) => void;
  goBack: () => void;
}

interface MainAppProps {
  initialUsername: string;
  navigation: NavigationProp;
}

// Constants
const ROUTE_DEVIATION_THRESHOLD = 1000; // 1000 meters
const RESPONSE_TIMEOUT = 30000; // 30 seconds in milliseconds
const NOTIFICATION_COOLDOWN = 60000;

export default function MainApp({ initialUsername, navigation }: MainAppProps): JSX.Element {
  // State declarations
  const [location, setLocation] = useState<Coordinates | null>(null);
  const [lastLoggedLocation, setLastLoggedLocation] = useState<Coordinates | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [destination, setDestination] = useState<LocationState>({
    coordinates: null,
    address: '',
  });
  const [destinationInput, setDestinationInput] = useState<string>('');
  const [routeCoordinates, setRouteCoordinates] = useState<Coordinates[]>([]);
  const [emergencyContacts, setEmergencyContacts] = useState<EmergencyContact[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isListening, setIsListening] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  // Refs
  const mapRef = useRef<MapView | null>(null);
  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  const responseTimer = useRef<NodeJS.Timeout | null>(null);
  const notificationListener = useRef<any>();
  const responseListener = useRef<any>();
  const lastNotificationTime = useRef<number>(0);
  const audioRecorderRef = useRef<Audio.Recording | null>(null);

  // Emergency keywords for voice detection
  const EMERGENCY_KEYWORDS = ['help', 'save me', 'danger', 'emergency'];

  // useEffect for setup
  useEffect(() => {
    console.log('MainApp useEffect running');
    const setup = async () => {
      console.log('Calling configureNotifications');
      await configureNotifications();
      console.log('Calling startLocationTracking');
      await startLocationTracking();
      console.log('Calling loadEmergencyContacts');
      await loadEmergencyContacts();

      console.log('Setting up notification listeners');
      if (!notificationListener.current) {
        notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
          console.log('Notification received:', notification);
        });
      }

      if (!responseListener.current) {
        responseListener.current = Notifications.addNotificationResponseReceivedListener(async response => {
          const actionId = response.actionIdentifier;
          const currentLocation = location;

          console.log('Notification response received:', { actionId, currentLocation });

          if (responseTimer.current) {
            clearTimeout(responseTimer.current);
            responseTimer.current = null;
          }

          if (actionId === 'SEND_ALERT') {
            if (currentLocation) {
              console.log('Attempting to send alert from SEND_ALERT');
              await sendEmergencyAlert(currentLocation);
              await Notifications.scheduleNotificationAsync({
                content: {
                  title: '🚨 Alert Sent',
                  body: 'Emergency alert has been sent to your contacts.',
                },
                trigger: null,
              });
            } else {
              console.log('No current location available for SEND_ALERT');
            }
          } else if (actionId === 'IM_SAFE') {
            const now = Date.now();
            if (now - lastNotificationTime.current < NOTIFICATION_COOLDOWN) {
              console.log('IM_SAFE ignored due to cooldown');
              return;
            }
            lastNotificationTime.current = now;

            console.log('Processing IM_SAFE response');

            await Notifications.scheduleNotificationAsync({
              content: {
                title: '✅ Status Updated',
                body: 'Glad you are safe! Route monitoring continues.',
              },
              trigger: null,
            });
          }
        });
      }

      // Voice recognition setup
      console.log('Setting up voice recognition');
      Voice.onSpeechResults = onSpeechResults;
      await startVoiceRecognition();

      console.log('Setup complete');
    };

    setup().catch(error => {
      console.error('Error in MainApp useEffect setup:', error);
      setErrorMsg('Failed to initialize app: ' + (error.message || error.toString()));
    });

    return () => {
      console.log('Cleaning up useEffect');
      if (locationSubscription.current) locationSubscription.current.remove();
      if (responseTimer.current) clearTimeout(responseTimer.current);
      if (notificationListener.current) Notifications.removeNotificationSubscription(notificationListener.current);
      if (responseListener.current) Notifications.removeNotificationSubscription(responseListener.current);
      Voice.destroy().then(Voice.removeAllListeners);
      if (audioRecorderRef.current) {
        audioRecorderRef.current.stopAndUnloadAsync().catch(err => console.error('Error stopping recording on cleanup:', err));
      }
    };
  }, [initialUsername]);

  // Configure notifications
  const configureNotifications = async () => {
    try {
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

      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge: true,
        }),
      });

      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        throw new Error('Permission not granted for notifications');
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
    } catch (error) {
      console.error('Error configuring notifications:', error);
      setErrorMsg('Failed to configure notifications: ' + (error.message || error.toString()));
    }
  };

  // Load emergency contacts
  const loadEmergencyContacts = async () => {
    try {
      setIsLoading(true);
      const contacts = await getEmergencyContacts();
      console.log('Fetched contacts:', contacts);
      setEmergencyContacts(contacts);
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
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '❌ Error',
          body: 'Failed to load emergency contacts',
        },
        trigger: null,
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Handle logout
  const handleLogout = async () => {
    try {
      const { error } = await signOut();
      if (error) {
        console.error('Logout error:', error);
        await Notifications.scheduleNotificationAsync({
          content: {
            title: '❌ Logout Failed',
            body: 'Please try again',
          },
          trigger: null,
        });
      } else {
        if (navigation) {
          console.log('Navigating to Login screen after logout');
          navigation.navigate('Login');
        } else {
          console.error('Navigation is undefined');
        }
      }
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  // Start location tracking
  const startLocationTracking = async (): Promise<void> => {
    try {
      console.log('DEBUG: Starting location tracking for user:', initialUsername);

      if (Platform.OS === 'ios') {
        const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync();
        console.log('DEBUG: iOS Background Location Permission Status:', backgroundStatus);
      }

      let { status: locationStatus } = await Location.getForegroundPermissionsAsync();
      console.log('DEBUG: Initial Foreground Location Permission Status:', locationStatus);

      if (locationStatus !== 'granted') {
        const { status } = await Location.requestForegroundPermissionsAsync();
        locationStatus = status;
        console.log('DEBUG: Requested Foreground Location Permission Status:', locationStatus);
      }

      if (locationStatus !== 'granted') {
        console.error('DEBUG: Location permission denied');
        Alert.alert(
          'Location Permission Required',
          'This app needs location access to track your route. Please enable location permissions in your device settings.',
          [
            {
              text: 'Open Settings',
              onPress: () => {
                if (Platform.OS === 'ios') {
                  Linking.openSettings();
                } else {
                  IntentLauncher.startActivityAsync(
                    IntentLauncher.ACTION_APPLICATION_DETAILS_SETTINGS,
                    { data: 'package:' + Application.applicationId }
                  );
                }
              }
            },
            {
              text: 'Cancel',
              style: 'cancel',
              onPress: () => navigation.goBack(),
            }
          ]
        );
        setErrorMsg('Permission to access location was denied. Please enable location permissions.');
        return;
      }

      console.log('DEBUG: Attempting to get current location');
      const initialLocation = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
        timeout: 15000,
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
          distanceInterval: 5,
          mayShowUserSettingsDialog: true,
        },
        (newLocation) => {
          // Comment out to reduce logging
          // console.log('DEBUG: Location Update Received:', {
          //   latitude: newLocation.coords.latitude,
          //   longitude: newLocation.coords.longitude,
          //   accuracy: newLocation.coords.accuracy,
          //   timestamp: newLocation.timestamp
          // });

          const locationWithAccuracy: Coordinates = {
            latitude: newLocation.coords.latitude,
            longitude: newLocation.coords.longitude,
            accuracy: newLocation.coords.accuracy,
          };

          setLocation(locationWithAccuracy);
          updateRouteCoordinates(locationWithAccuracy);
          if (destination.coordinates) {
            checkRouteDeviation(locationWithAccuracy);
          }
        }
      );
    } catch (error) {
      console.error('DEBUG: Comprehensive Location Tracking Error:', {
        errorName: error.name,
        errorMessage: error.message,
        errorStack: error.stack
      });
      setErrorMsg(`Location tracking failed: ${error.message}. Please check your device settings.`);
      Alert.alert(
        'Location Tracking Error',
        `Unable to track location: ${error.message}. Please check your device settings and try again.`,
        [
          { text: 'Retry', onPress: () => startLocationTracking() },
          { text: 'Cancel', style: 'cancel', onPress: () => navigation.goBack() }
        ]
      );
    }
  };

  // Voice recognition functions
  const startVoiceRecognition = async () => {
    try {
      await Audio.requestPermissionsAsync();
      await Voice.start('en-US');
      setIsListening(true);
      console.log('Voice recognition started');
    } catch (error) {
      console.error('Voice recognition error:', error);
      setErrorMsg('Failed to start voice recognition: ' + (error.message || error.toString()));
    }
  };

  const onSpeechResults = async (event: any) => {
    if (!event.value || event.value.length === 0) return;

    const recognizedText = event.value[0].toLowerCase();
    console.log('Recognized speech:', recognizedText);

    const isEmergency = EMERGENCY_KEYWORDS.some(keyword =>
      recognizedText.includes(keyword)
    );

    if (isEmergency) {
      console.log('Emergency keyword detected, starting recording');
      await startEmergencyRecording();
    }
  };

  const startEmergencyRecording = async () => {
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        console.error('Media library permissions not granted');
        setErrorMsg('Media library permissions not granted');
        return;
      }

      const { status: audioStatus } = await Audio.requestPermissionsAsync();
      if (audioStatus !== 'granted') {
        console.error('Audio recording permissions not granted');
        setErrorMsg('Audio recording permissions not granted');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const recording = new Audio.Recording();
      audioRecorderRef.current = recording;

      const recordingOptions = {
        isMeteringEnabled: true,
        android: {
          extension: '.m4a',
          outputFormat: Audio.RecordingOptionsPresets.HIGH_QUALITY.android.outputFormat,
          audioEncoder: Audio.RecordingOptionsPresets.HIGH_QUALITY.android.audioEncoder,
        },
        ios: {
          extension: '.m4a',
          audioQuality: Audio.RecordingOptionsPresets.HIGH_QUALITY.ios.audioQuality,
          sampleRate: 44100,
          numberOfChannels: 2,
          bitRate: 128000,
        },
        web: {
          mimeType: 'audio/webm',
          bitsPerSecond: 128000,
        },
      };

      await recording.prepareToRecordAsync(recordingOptions);
      await recording.startAsync();
      setIsRecording(true);
      console.log('Emergency recording started');

      setTimeout(async () => {
        if (audioRecorderRef.current) {
          await audioRecorderRef.current.stopAndUnloadAsync();
          const uri = audioRecorderRef.current.getURI();
          if (uri) {
            await processEmergencyRecording(uri);
          }
          setIsRecording(false);
          audioRecorderRef.current = null;
        }
      }, 60000);
    } catch (error) {
      console.error('Emergency recording error:', error);
      setErrorMsg('Failed to start emergency recording: ' + (error.message || error.toString()));
      setIsRecording(false);
    }
  };

  const processEmergencyRecording = async (audioUri: string) => {
    try {
      console.log('Processing emergency recording:', audioUri);
      const audioFile = await FileSystem.readAsStringAsync(audioUri, {
        encoding: FileSystem.EncodingType.Base64
      });

      const { data, error } = await supabase.storage
        .from('emergency-recordings')
        .upload(`recordings/${Date.now()}.m4a`, audioFile, {
          contentType: 'audio/m4a'
        });

      if (error) throw error;

      const publicUrl = supabase.storage
        .from('emergency-recordings')
        .getPublicUrl(data.path).data.publicUrl;

      console.log('Audio uploaded, public URL:', publicUrl);

      if (location) {
        await sendEmergencyAlert(location, publicUrl);
      } else {
        console.error('No location available to send with recording');
        await Notifications.scheduleNotificationAsync({
          content: {
            title: '❌ Alert Failed',
            body: 'Location unavailable for emergency alert with recording.',
          },
          trigger: null,
        });
      }
    } catch (error) {
      console.error('Emergency recording processing error:', error);
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '❌ Recording Upload Failed',
          body: 'Failed to upload emergency recording.',
        },
        trigger: null,
      });
    }
  };

  // Show deviation notification
  const showDeviationNotification = async (currentLocation: Coordinates) => {
    try {
      if (responseTimer.current) {
        clearTimeout(responseTimer.current);
      }

      console.log('Scheduling deviation notification for:', currentLocation);

      await Notifications.scheduleNotificationAsync({
        content: {
          title: '❗ Route Deviation Detected',
          body: 'Are you safe? Please respond within 30 seconds.',
          data: { currentLocation },
          categoryIdentifier: 'route-deviation',
          sound: 'default',
          priority: Notifications.AndroidNotificationPriority.MAX,
          channelId: 'route-deviation',
          sticky: false,
          autoDismiss: false,
        },
        trigger: null,
      });

      responseTimer.current = setTimeout(async () => {
        console.log('Response timeout triggered after 30 seconds');
        if (responseTimer.current) {
          console.log('Calling sendEmergencyAlert for automatic alert');
          await sendEmergencyAlert(currentLocation);
          await Notifications.scheduleNotificationAsync({
            content: {
              title: '🚨 Automatic Alert Sent',
              body: 'No response received within 30 seconds. Emergency contacts have been notified.',
            },
            trigger: null,
          });
        }
      }, RESPONSE_TIMEOUT);
    } catch (error) {
      console.error('Error showing deviation notification:', error);
      await sendEmergencyAlert(currentLocation);
    }
  };

  // Send emergency alert
  const sendEmergencyAlert = async (currentLocation: Coordinates, audioUrl?: string): Promise<void> => {
    console.log('sendEmergencyAlert called with location:', currentLocation, 'audioUrl:', audioUrl);
    console.log('Emergency contacts:', emergencyContacts);

    if (emergencyContacts.length === 0) {
      console.log('No emergency contacts available');
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '⚠️ Alert Failed',
          body: 'No emergency contacts available to send alerts to',
        },
        trigger: null,
      });
      return;
    }

    if (!currentLocation) {
      console.log('Current location unavailable');
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '❌ Alert Failed',
          body: 'Current location unavailable. Please try again.',
        },
        trigger: null,
      });
      return;
    }

    try {
      const destinationName = destination.address || 'unknown location';
      let message = `EMERGENCY: Route deviation detected for ${initialUsername} near ${destinationName}. Current location: https://www.openstreetmap.org/?mlat=${currentLocation.latitude}&mlon=${currentLocation.longitude}`;
      if (audioUrl) {
        message += `\nEmergency recording: ${audioUrl}`;
      }

      const isAvailable = await SMS.isAvailableAsync();
      console.log('SMS availability:', isAvailable);

      if (isAvailable) {
        const phoneNumbers = emergencyContacts.map(contact => {
          let number = contact.phone_number;
          if (!number.startsWith('+')) {
            number = '+91' + number; // Add India country code
          }
          return number;
        });
        console.log('Sending SMS to:', phoneNumbers, 'with message:', message);
        const { result } = await SMS.sendSMSAsync(phoneNumbers, message);
        console.log('SMS send result:', result);

        await Notifications.scheduleNotificationAsync({
          content: {
            title: result === 'sent' ? '✅ Alert Sent' : '⚠️ Alert Status',
            body: result === 'sent'
              ? `Emergency alert sent to ${emergencyContacts.length} contacts`
              : 'Message prepared. Please send it manually if it does not send automatically.',
          },
          trigger: null,
        });
      } else {
        throw new Error('SMS is not available on this device');
      }
    } catch (error) {
      console.error('Error sending SMS:', error);
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '❌ Alert Failed',
          body: 'Failed to send emergency alert. Please check SMS permissions or contact emergency services directly.',
        },
        trigger: null,
      });
    }
  };

  // Geocode address
  const geocodeAddress = async (address: string): Promise<Coordinates | null> => {
    try {
      const results = await Location.geocodeAsync(address);
      if (results.length > 0) {
        return {
          latitude: results[0].latitude,
          longitude: results[0].longitude,
        };
      }
      return null;
    } catch (error) {
      console.error('Geocoding error:', error);
      return null;
    }
  };

  // Set destination
  const handleSetDestination = async (): Promise<void> => {
    if (!destinationInput.trim()) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '⚠️ Invalid Input',
          body: 'Please enter a destination',
        },
        trigger: null,
      });
      return;
    }

    if (emergencyContacts.length === 0) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '⚠️ Warning',
          body: 'No emergency contacts found. Add contacts for better safety.',
        },
        trigger: null,
      });
    }

    await setDestinationCoordinates();
  };

  const setDestinationCoordinates = async (): Promise<void> => {
    try {
      const coordinates = await geocodeAddress(destinationInput);
      if (!coordinates) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: '❌ Location Error',
            body: 'Could not find the location. Please try a different address.',
          },
          trigger: null,
        });
        return;
      }

      setDestination({
        coordinates,
        address: destinationInput,
      });

      await Notifications.scheduleNotificationAsync({
        content: {
          title: '✅ Destination Set',
          body: `Route monitoring active for ${destinationInput}`,
        },
        trigger: null,
      });

      if (location && mapRef.current) {
        mapRef.current.fitToCoordinates(
          [location, coordinates],
          {
            edgePadding: { top: 50, right: 50, bottom: 50, left: 50 },
            animated: true,
          }
        );
      }
    } catch (error) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '❌ Error',
          body: 'Failed to set destination. Please try again.',
        },
        trigger: null,
      });
    }
  };

  // Update route coordinates
  const updateRouteCoordinates = (newCoord: Coordinates): void => {
    setRouteCoordinates(prev => [...prev, newCoord]);
  };

  // Check route deviation
  const checkRouteDeviation = (currentLocation: Coordinates): void => {
    if (!destination.coordinates) return;

    const now = Date.now();
    if (now - lastNotificationTime.current < NOTIFICATION_COOLDOWN) return;

    const deviationDistance = distance(
      [currentLocation.longitude, currentLocation.latitude],
      [destination.coordinates.longitude, destination.coordinates.latitude]
    ) * 1000;

    console.log('Deviation distance (meters):', deviationDistance);

    if (deviationDistance > ROUTE_DEVIATION_THRESHOLD) {
      lastNotificationTime.current = now;
      showDeviationNotification(currentLocation);
    }
  };

  // Simulate deviation
  const simulateDeviation = (): void => {
    if (!location) return;

    const deviatedLocation: Coordinates = {
      latitude: location.latitude + (600 / 111320), // ~600 meters north
      longitude: location.longitude,
      accuracy: location.accuracy,
    };

    setLocation(deviatedLocation);
    updateRouteCoordinates(deviatedLocation);

    if (destination.coordinates) {
      checkRouteDeviation(deviatedLocation);
    }
  };

  // Render logic with reduced logging
  if (errorMsg || (location && !lastLoggedLocation)) {
    console.log('MainApp render - location:', location, 'errorMsg:', errorMsg);
    if (location) setLastLoggedLocation(location);
  }

  if (errorMsg) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>{errorMsg}</Text>
      </View>
    );
  }

  if (!location) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Loading location...</Text>
      </View>
    );
  }

  const renderEmergencyContactsManager = () => {
    if (typeof EmergencyContactManager === 'undefined') {
      return (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Emergency contacts manager not available</Text>
        </View>
      );
    }

    return (
      <EmergencyContactManager
        contacts={emergencyContacts}
        isLoading={isLoading}
        onRefresh={loadEmergencyContacts}
      />
    );
  };

  return (
    <View style={styles.container}>
      {location && (
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
            followsUserLocation={true}
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
                  description="Destination"
                  pinColor="blue"
                />
                <Polyline
                  coordinates={[location, destination.coordinates]}
                  strokeColor="#4a90e2"
                  strokeWidth={2}
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

          {renderEmergencyContactsManager()}

          <View style={styles.inputContainer}>
            <Text style={styles.contactsInfo}>
              {isLoading
                ? 'Loading contacts...'
                : emergencyContacts.length > 0
                  ? `${emergencyContacts.length} emergency contacts loaded`
                  : 'No emergency contacts found'}
            </Text>
            <Text style={styles.statusText}>
              {isListening ? '🎙️ Listening for voice commands...' : 'Voice recognition off'}
              {isRecording ? ' 🔴 Recording emergency audio...' : ''}
            </Text>

            <Text style={styles.inputLabel}>Enter Destination:</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter city or area name (e.g., Mumbai, Pune)"
              value={destinationInput}
              onChangeText={setDestinationInput}
              autoCorrect={false}
            />

            <TouchableOpacity
              style={styles.button}
              onPress={handleSetDestination}
            >
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
          </View>
        </>
      )}
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  errorText: {
    fontSize: 16,
    color: 'red',
    textAlign: 'center',
    padding: 20,
  },
  errorContainer: {
    backgroundColor: 'rgba(255, 200, 200, 0.8)',
    padding: 10,
    margin: 10,
    borderRadius: 5,
  },
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  welcomeText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  inputContainer: {
    position: 'absolute',
    top: 100,
    left: 10,
    right: 10,
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 10,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    padding: 10,
    marginBottom: 10,
    borderRadius: 5,
    backgroundColor: 'white',
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 5,
    alignItems: 'center',
  },
  testButton: {
    backgroundColor: '#FF6B6B',
    marginTop: 10,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  contactsInfo: {
    marginTop: 5,
    marginBottom: 10,
    textAlign: 'center',
    color: '#666',
    fontSize: 14,
  },
  statusText: {
    marginBottom: 10,
    textAlign: 'center',
    color: '#666',
    fontSize: 14,
  },
  loadingText: {
    fontSize: 16,
    textAlign: 'center',
    padding: 20,
  },
});