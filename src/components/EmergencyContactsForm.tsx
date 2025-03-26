// src/components/EmergencyContactsForm.tsx
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { supabase } from '../services/SupabaseService';

interface EmergencyContact {
  contact_name: string;
  phone_number: string;
  relationship: string;
}

interface EmergencyContactsFormProps {
  userId: string;
  userName: string;
  onComplete: () => void;
}

export const EmergencyContactsForm = ({ userId, userName, onComplete }: EmergencyContactsFormProps) => {
  const [contacts, setContacts] = useState<EmergencyContact[]>([
    { contact_name: '', phone_number: '', relationship: '' },
    { contact_name: '', phone_number: '', relationship: '' },
    { contact_name: '', phone_number: '', relationship: '' },
    { contact_name: '', phone_number: '', relationship: '' },
    { contact_name: '', phone_number: '', relationship: '' },
  ]);

  const [error, setError] = useState<string>('');

  const updateContact = (index: number, field: keyof EmergencyContact, value: string) => {
    const newContacts = [...contacts];
    newContacts[index] = { ...newContacts[index], [field]: value };
    setContacts(newContacts);
  };

  const validateContacts = () => {
    // Require at least one contact
    const hasOneContact = contacts.some(contact => 
      contact.contact_name && contact.phone_number && contact.relationship
    );
    
    if (!hasOneContact) {
      setError('Please add at least one emergency contact');
      return false;
    }

    // Validate phone numbers
    const phoneRegex = /^\+?[1-9]\d{9,14}$/;
    const invalidPhone = contacts.some(contact => 
      contact.phone_number && !phoneRegex.test(contact.phone_number)
    );

    if (invalidPhone) {
      setError('Please enter valid phone numbers');
      return false;
    }

    return true;
  };

  const handleSubmit = async () => {
    try {
      if (!validateContacts()) {
        return;
      }

      setError('');

      // Filter out empty contacts
      const validContacts = contacts.filter(contact => 
        contact.contact_name && contact.phone_number && contact.relationship
      );

      // Insert all contacts
      const { error: insertError } = await supabase
        .from('emergency_contacts')
        .insert(
          validContacts.map(contact => ({
            user_id: userId,
            user_name: userName,
            contact_name: contact.contact_name,
            phone_number: contact.phone_number,
            relationship: contact.relationship,
          }))
        );

      if (insertError) throw insertError;

      onComplete();
    } catch (err) {
      console.error('Error saving emergency contacts:', err);
      setError('Failed to save emergency contacts. Please try again.');
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Emergency Contacts</Text>
      <Text style={styles.subtitle}>Please add at least one emergency contact</Text>

      {contacts.map((contact, index) => (
        <View key={index} style={styles.contactContainer}>
          <Text style={styles.contactHeader}>Contact {index + 1}</Text>
          
          <TextInput
            style={styles.input}
            placeholder="Contact Name"
            value={contact.contact_name}
            onChangeText={(value) => updateContact(index, 'contact_name', value)}
          />

          <TextInput
            style={styles.input}
            placeholder="Phone Number"
            value={contact.phone_number}
            onChangeText={(value) => updateContact(index, 'phone_number', value)}
            keyboardType="phone-pad"
          />

          <TextInput
            style={styles.input}
            placeholder="Relationship"
            value={contact.relationship}
            onChangeText={(value) => updateContact(index, 'relationship', value)}
          />
        </View>
      ))}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <TouchableOpacity style={styles.button} onPress={handleSubmit}>
        <Text style={styles.buttonText}>Save Emergency Contacts</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 20,
  },
  contactContainer: {
    marginBottom: 20,
    padding: 15,
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
  },
  contactHeader: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  input: {
    backgroundColor: 'white',
    padding: 12,
    borderRadius: 5,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 5,
    alignItems: 'center',
    marginVertical: 20,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  errorText: {
    color: 'red',
    marginVertical: 10,
  },
});