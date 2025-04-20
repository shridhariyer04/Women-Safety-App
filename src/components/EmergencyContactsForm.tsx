import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, ScrollView } from 'react-native';
import { supabase } from '../services/SupabaseService';

interface EmergencyContact {
  user_name: string;
  contact_name: string;
  phone_number: string;
  relationship: string;
  user_id?: string; // Add user_id field
}

interface EmergencyContactsFormProps {
  userId: string;
  userName?: string;  // Make it optional
  onComplete: () => void;
}

export const EmergencyContactsForm: React.FC<EmergencyContactsFormProps> = ({ userId, onComplete }) => {
  const [contacts, setContacts] = useState<EmergencyContact[]>([
    { user_name: '', contact_name: '', phone_number: '', relationship: '' }
  ]);
  const [loading, setLoading] = useState(false);

  const addContact = () => {
    setContacts([...contacts, { user_name: '', contact_name: '', phone_number: '', relationship: '' }]);
  };

  const removeContact = (index: number) => {
    if (contacts.length > 1) {
      const newContacts = [...contacts];
      newContacts.splice(index, 1);
      setContacts(newContacts);
    } else {
      Alert.alert('Required', 'You need at least one emergency contact');
    }
  };

  const handleInputChange = (index: number, field: keyof EmergencyContact, value: string) => {
    const newContacts = [...contacts];
    newContacts[index][field] = value;
    setContacts(newContacts);
  };

  const validatePhoneNumber = (phone: string) => {
    const phoneRegex = /^\d{10}$/;
    return phoneRegex.test(phone);
  };

  const validateForm = () => {
    // Validate at least one contact is fully filled
    for (const contact of contacts) {
      if (!contact.contact_name.trim()) {
        Alert.alert('Error', 'Contact name is required');
        return false;
      }
      if (!contact.phone_number.trim()) {
        Alert.alert('Error', 'Phone number is required');
        return false;
      }
      if (!validatePhoneNumber(contact.phone_number)) {
        Alert.alert('Error', 'Please enter a valid 10-digit phone number');
        return false;
      }
      if (!contact.relationship.trim()) {
        Alert.alert('Error', 'Relationship is required');
        return false;
      }
    }
    return true;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    setLoading(true);
    try {
      // Get the username for the current user
      const { data: userData, error: userError } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', userId)
        .single();

      if (userError) throw userError;
      
      // Prepare contacts with both user_name and user_id fields
      const preparedContacts = contacts.map(contact => ({
        ...contact,
        user_name: userData.username,
        user_id: userId  // Add the user_id field
      }));

      // Insert contacts into the emergency_contacts table
      const { error } = await supabase
        .from('emergency_contacts')
        .insert(preparedContacts);

      if (error) throw error;

      Alert.alert(
        'Success',
        'Emergency contacts saved successfully!',
        [{ text: 'OK', onPress: onComplete }]
      );
    } catch (error: any) {
      console.error('Error saving emergency contacts:', error);
      Alert.alert('Error', error.message || 'Failed to save emergency contacts');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Add Emergency Contacts</Text>
      <Text style={styles.subtitle}>
        Add at least one trusted contact who can be notified in case of emergency
      </Text>

      {contacts.map((contact, index) => (
        <View key={index} style={styles.contactContainer}>
          <Text style={styles.contactLabel}>Contact {index + 1}</Text>
          
          <TextInput
            style={styles.input}
            placeholder="Contact Name"
            value={contact.contact_name}
            onChangeText={(value) => handleInputChange(index, 'contact_name', value)}
            editable={!loading}
          />
          
          <TextInput
            style={styles.input}
            placeholder="Phone Number (10 digits)"
            value={contact.phone_number}
            onChangeText={(value) => handleInputChange(index, 'phone_number', value)}
            keyboardType="phone-pad"
            editable={!loading}
            maxLength={10}
          />
          
          <TextInput
            style={styles.input}
            placeholder="Relationship (e.g., Mother, Sister, Friend)"
            value={contact.relationship}
            onChangeText={(value) => handleInputChange(index, 'relationship', value)}
            editable={!loading}
          />
          
          {contacts.length > 1 && (
            <TouchableOpacity
              style={styles.removeButton}
              onPress={() => removeContact(index)}
              disabled={loading}
            >
              <Text style={styles.removeButtonText}>Remove Contact</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}
      
      <TouchableOpacity
        style={styles.addButton}
        onPress={addContact}
        disabled={loading || contacts.length >= 3}
      >
        <Text style={styles.addButtonText}>+ Add Another Contact</Text>
      </TouchableOpacity>
      
      <TouchableOpacity
        style={[styles.submitButton, loading && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={styles.submitButtonText}>Save Contacts & Continue</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#F5F5F5',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center',
    color: '#333333',
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 30,
    color: '#666666',
  },
  contactContainer: {
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 12,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  contactLabel: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 15,
    color: '#333333',
  },
  input: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    padding: 15,
    marginBottom: 15,
    borderRadius: 12,
    fontSize: 16,
    backgroundColor: '#F9F9F9',
  },
  addButton: {
    backgroundColor: '#EBF5FF',
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  addButtonText: {
    color: '#007AFF',
    fontSize: 16,
    fontWeight: '600',
  },
  removeButton: {
    backgroundColor: '#FFF1F0',
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 5,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  removeButtonText: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '600',
  },
  submitButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 30,
    elevation: 4,
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  buttonDisabled: {
    backgroundColor: '#999',
  },
  submitButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
});