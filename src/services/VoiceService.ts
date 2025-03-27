import { Audio } from 'expo-av';
import * as SMS from 'expo-sms';
import * as FileSystem from 'expo-file-system';
import { supabase } from './SupabaseService';

const HIGH_QUALITY_RECORDING_OPTIONS = {
  android: {
    extension: '.m4a',
    outputFormat: Audio.RECORDING_OPTION_ANDROID_OUTPUT_FORMAT_MPEG_4,
    audioEncoder: Audio.RECORDING_OPTION_ANDROID_AUDIO_ENCODER_AAC,
    sampleRate: 44100,
    numberOfChannels: 2,
    bitRate: 128000,
  },
  ios: {
    extension: '.m4a',
    outputFormat: Audio.RECORDING_OPTION_IOS_OUTPUT_FORMAT_MPEG4AAC,
    audioQuality: Audio.RECORDING_OPTION_IOS_AUDIO_QUALITY_MAX,
    sampleRate: 44100,
    numberOfChannels: 2,
    bitRate: 128000,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 128000,
  },
};

const TRIGGER_WORDS = ['help', 'save me'];
const SNIPPET_DURATION = 3000; // 3 seconds
const RECORDING_DURATION = 15000; // 15 seconds

export interface EmergencyContact {
  id: string;
  name: string;
  phone_number: string;
}

export class VoiceService {
  private recording: Audio.Recording | null = null;
  private snippetRecording: Audio.Recording | null = null;
  private emergencyContacts: EmergencyContact[] = [];
  private isListening: boolean = false;
  private isRecordingSnippet: boolean = false;
  private listeningInterval: NodeJS.Timeout | null = null;

  constructor(contacts: EmergencyContact[]) {
    this.emergencyContacts = contacts;
    this.initializeAudio(); // Initialize audio system early
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

  async startListening(): Promise<void> {
    if (this.isListening) {
      console.log('Already listening');
      return;
    }

    const hasPermission = await this.requestPermissions();
    if (!hasPermission) {
      console.log('Cannot start listening: No permission');
      return;
    }

    this.isListening = true;
    console.log('Starting to listen for trigger words...');
    this.listeningLoop();
  }

  stopListening(): void {
    this.isListening = false;
    if (this.listeningInterval) {
      clearInterval(this.listeningInterval);
      this.listeningInterval = null;
    }
    if (this.snippetRecording) {
      this.snippetRecording.stopAndUnloadAsync().catch(err => console.error('Snippet cleanup error:', err));
      this.snippetRecording = null;
    }
    if (this.recording) {
      this.recording.stopAndUnloadAsync().catch(err => console.error('Recording cleanup error:', err));
      this.recording = null;
    }
    console.log('Stopped listening');
  }

  private listeningLoop(): void {
    this.listeningInterval = setInterval(async () => {
      if (!this.isListening || this.isRecordingSnippet) return;

      this.isRecordingSnippet = true;
      const snippetUri = await this.recordSnippet();
      this.isRecordingSnippet = false;

      if (!snippetUri) return;

      try {
        const transcription = await this.mockTranscribeAudio(snippetUri);
        console.log('Mock transcription:', transcription);

        if (transcription && this.containsTriggerWord(transcription.toLowerCase())) {
          console.log('Trigger word detected:', transcription);
          await this.startRecording();
        }
      } catch (error) {
        console.error('Error processing snippet:', error);
      } finally {
        await FileSystem.deleteAsync(snippetUri).catch(err => console.error('File delete error:', err));
      }
    }, SNIPPET_DURATION + 1000);
  }

  private async recordSnippet(): Promise<string | null> {
    try {
      if (!Audio.Recording) {
        throw new Error('Audio.Recording is not available');
      }

      this.snippetRecording = new Audio.Recording();
      await this.snippetRecording.prepareToRecordAsync(HIGH_QUALITY_RECORDING_OPTIONS);
      await this.snippetRecording.startAsync();

      await new Promise(resolve => setTimeout(resolve, SNIPPET_DURATION));

      await this.snippetRecording.stopAndUnloadAsync();
      const uri = this.snippetRecording.getURI();
      if (!uri) throw new Error('No URI returned from snippet recording');
      
      this.snippetRecording = null;
      return uri;
    } catch (error) {
      console.error('Error recording snippet:', error);
      if (this.snippetRecording) {
        this.snippetRecording.stopAndUnloadAsync().catch(err => console.error('Snippet cleanup error:', err));
        this.snippetRecording = null;
      }
      return null;
    }
  }

  private async mockTranscribeAudio(audioUri: string): Promise<string | null> {
    try {
      const random = Math.random();
      return random > 0.5 ? 'help' : 'nothing';
    } catch (error) {
      console.error('Mock transcription error:', error);
      return null;
    }
  }

  private containsTriggerWord(transcription: string): boolean {
    return TRIGGER_WORDS.some(word => transcription.includes(word));
  }

  public async startRecording(): Promise<void> {
    try {
      if (!Audio.Recording) {
        throw new Error('Audio.Recording is not available');
      }

      if (this.recording) {
        await this.recording.stopAndUnloadAsync();
        this.recording = null;
      }

      this.recording = new Audio.Recording();
      await this.recording.prepareToRecordAsync(HIGH_QUALITY_RECORDING_OPTIONS);
      await this.recording.startAsync();

      setTimeout(async () => {
        await this.stopRecordingAndSend();
      }, RECORDING_DURATION);
    } catch (error) {
      console.error('Error starting recording:', error);
      if (this.recording) {
        this.recording.stopAndUnloadAsync().catch(err => console.error('Recording cleanup error:', err));
        this.recording = null;
      }
    }
  }

  private async stopRecordingAndSend(): Promise<void> {
    if (!this.recording) {
      console.log('No active recording to stop');
      return;
    }

    try {
      await this.recording.stopAndUnloadAsync();
      const uri = this.recording.getURI();
      console.log('Recording saved at:', uri);

      if (uri) {
        const publicUrl = await this.uploadToSupabase(uri);
        if (publicUrl) {
          await this.sendAudioToContacts(publicUrl);
        } else {
          console.error('Failed to upload recording to Supabase');
        }
      } else {
        console.error('No URI returned from recording');
      }
    } catch (error) {
      console.error('Error stopping recording:', error);
    } finally {
      this.recording = null;
    }
  }

  private async uploadToSupabase(audioUri: string): Promise<string | null> {
    try {
      console.log('Starting uploadToSupabase with audioUri:', audioUri);

      const fileName = `recording-${Date.now()}.m4a`;
      const fileContent = await FileSystem.readAsStringAsync(audioUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      if (!fileContent) {
        throw new Error('Failed to read audio file content');
      }

      const arrayBuffer = Uint8Array.from(atob(fileContent), c => c.charCodeAt(0)).buffer;

      const { data, error } = await supabase.storage
        .from('recordings')
        .upload(fileName, arrayBuffer, {
          contentType: 'audio/m4a',
        });

      if (error || !data) {
        console.error('Error uploading to Supabase:', error || 'No data returned');
        return null;
      }

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

  private async sendAudioToContacts(audioUrl: string): Promise<void> {
    if (this.emergencyContacts.length === 0) {
      console.error('No emergency contacts');
      return;
    }

    const message = `EMERGENCY: Voice alert triggered. Audio: ${audioUrl}`;
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