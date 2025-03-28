import { Audio } from 'expo-av';
import * as SMS from 'expo-sms';
import * as FileSystem from 'expo-file-system';
import { supabase } from './SupabaseService';

const HIGH_QUALITY_RECORDING_OPTIONS: Audio.RecordingOptions = {
  android: {
    extension: '.m4a',
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 44100,
    numberOfChannels: 2,
    bitRate: 128000,
  },
  ios: {
    extension: '.m4a',
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
    audioQuality: Audio.IOSAudioQuality.MAX,
    sampleRate: 44100,
    numberOfChannels: 2,
    bitRate: 128000,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 128000,
  },
};

const RECORDING_DURATION = 15000; // 15 seconds
const DEBOUNCE_DELAY = 16000; // 16 seconds to cover recording + buffer

interface Coordinates {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export interface EmergencyContact {
  id: string;
  name: string;
  phone_number: string;
}

export class VoiceService {
  private recording: Audio.Recording | null = null;
  private emergencyContacts: EmergencyContact[] = [];
  private isRecording: boolean = false;
  private lastRecordingTime: number = 0; // Debounce tracker

  constructor(contacts: EmergencyContact[]) {
    this.emergencyContacts = contacts;
    this.initializeAudio();
  }

  private async initializeAudio(): Promise<void> {
    try {
      console.log('Initializing audio system');
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
      });
    } catch (error) {
      console.error('Failed to initialize audio:', error);
    }
  }

  async requestPermissions(): Promise<boolean> {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      console.log('Mic permission status:', status);
      if (status !== 'granted') {
        console.error('Microphone permission not granted');
        return false;
      }
      return true;
    } catch (error) {
      console.error('Permission request failed:', error);
      return false;
    }
  }

  stopListening(): void {
    console.log('Stopped listening');
    this.stopAndCleanupRecording();
  }

  private async stopAndCleanupRecording(): Promise<void> {
    if (!this.recording) return;

    try {
      const status = await this.recording.getStatusAsync();
      if (status.isRecording) {
        await this.recording.stopAndUnloadAsync();
        console.log('Recording stopped during cleanup');
      }
      this.recording = null;
      this.isRecording = false;
    } catch (error) {
      console.error('Error cleaning up recording:', error);
    } finally {
      this.recording = null; // Force reset
      this.isRecording = false;
    }
  }

  public async startFullRecording(location?: Coordinates): Promise<void> {
    const now = Date.now();
    if (this.isRecording || (now - this.lastRecordingTime < DEBOUNCE_DELAY)) {
      console.log('Recording in progress or debounced');
      return;
    }

    const hasPermission = await this.requestPermissions();
    if (!hasPermission) {
      console.log('Cannot start recording: No permission');
      return;
    }

    try {
      console.log('Starting full recording process');
      await this.stopAndCleanupRecording(); // Hard reset
      this.recording = new Audio.Recording();
      console.log('Preparing recording');
      await this.recording.prepareToRecordAsync(HIGH_QUALITY_RECORDING_OPTIONS);
      console.log('Starting recording');
      await this.recording.startAsync();
      this.isRecording = true;
      this.lastRecordingTime = now;

      setTimeout(async () => {
        console.log('Recording timeout triggered');
        await this.stopRecordingAndSend(location);
      }, RECORDING_DURATION);
    } catch (error) {
      console.error('Error starting full recording:', error);
      await this.stopAndCleanupRecording();
    }
  }

  private async stopRecordingAndSend(location?: Coordinates): Promise<void> {
    if (!this.recording || !this.isRecording) {
      console.log('No active recording to stop');
      return;
    }

    try {
      console.log('Stopping recording');
      await this.recording.stopAndUnloadAsync();
      const uri = this.recording.getURI();
      console.log('Recording saved at:', uri);

      if (uri) {
        console.log('Attempting to upload recording');
        const publicUrl = await this.uploadToSupabase(uri);
        if (publicUrl) {
          console.log('Sending audio to contacts');
          await this.sendAudioToContacts(publicUrl, location);
        } else {
          console.error('Upload failed, no public URL');
        }
      } else {
        console.error('No URI returned from recording');
      }
    } catch (error) {
      console.error('Error stopping recording:', error);
    } finally {
      await this.stopAndCleanupRecording(); // Ensure cleanup
    }
  }

  private async uploadToSupabase(audioUri: string): Promise<string | null> {
    try {
      console.log('Starting uploadToSupabase with audioUri:', audioUri);
      const fileName = `recording-${Date.now()}.m4a`;

      console.log('Reading file info');
      const fileInfo = await FileSystem.getInfoAsync(audioUri);
      if (!fileInfo.exists) {
        console.error('File does not exist at URI:', audioUri);
        return null;
      }

      console.log('Uploading to Supabase');
      const fileContent = await FileSystem.readAsStringAsync(audioUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const { data, error } = await supabase.storage
        .from('recordings')
        .upload(fileName, {
          uri: audioUri,
          name: fileName,
          type: 'audio/m4a',
        } as any, {
          contentType: 'audio/m4a',
          upsert: true,
        });

      if (error) {
        console.error('Supabase upload error:', error.message);
        return null;
      }

      if (!data) {
        console.error('No data returned from Supabase upload');
        return null;
      }

      console.log('Getting public URL');
      const { data: publicUrlData } = supabase.storage
        .from('recordings')
        .getPublicUrl(fileName);

      if (!publicUrlData?.publicUrl) {
        console.error('Failed to get public URL from Supabase');
        return null;
      }

      console.log('Uploaded to Supabase:', publicUrlData.publicUrl);
      return publicUrlData.publicUrl;
    } catch (error) {
      console.error('Error in uploadToSupabase:', error);
      return null;
    }
  }

  private async sendAudioToContacts(audioUrl: string, location?: Coordinates): Promise<void> {
    if (this.emergencyContacts.length === 0) {
      console.error('No emergency contacts');
      return;
    }

    const message = `EMERGENCY: Voice alert triggered. Audio: ${audioUrl}${location ? ` - Location: https://www.openstreetmap.org/?mlat=${location.latitude}&mlon=${location.longitude}` : ''}`;
    const phoneNumbers = this.emergencyContacts.map(contact => contact.phone_number);

    try {
      const isAvailable = await SMS.isAvailableAsync();
      if (isAvailable) {
        await SMS.sendSMSAsync(phoneNumbers, message);
        console.log('Audio alert sent');
      } else {
        console.error('SMS not available');
      }
    } catch (error) {
      console.error('Error sending SMS:', error);
    }
  }
}

export default VoiceService;