import React, { useState, useEffect, useCallback } from 'react';
import { 
  View, 
  Text, 
  TextInput, 
  FlatList, 
  TouchableOpacity, 
  StyleSheet 
} from 'react-native';
import debounce from 'lodash/debounce';

interface AutocompleteResult {
  id: string;
  text: string;
  place_name: string;
  coordinates: {
    latitude: number;
    longitude: number;
  };
}

interface DestinationSearchProps {
  mapboxApiKey: string;
  onDestinationSelect: (destination: AutocompleteResult) => void;
}

const DestinationSearch: React.FC<DestinationSearchProps> = ({ 
  mapboxApiKey, 
  onDestinationSelect 
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<AutocompleteResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchSuggestions = async (query: string) => {
    if (query.length < 3) {
      setSuggestions([]);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?` +
        `access_token=${mapboxApiKey}&` +
        'types=address,poi,neighborhood,place&' +
        'limit=5'
      );
      
      const data = await response.json();
      
      if (data.features && data.features.length > 0) {
        const formattedSuggestions = data.features.map((feature: any) => ({
          id: feature.id,
          text: feature.text,
          place_name: feature.place_name,
          coordinates: {
            latitude: feature.center[1],
            longitude: feature.center[0]
          }
        }));
        
        setSuggestions(formattedSuggestions);
      } else {
        setSuggestions([]);
      }
    } catch (error) {
      console.error('Geocoding error:', error);
      setSuggestions([]);
    } finally {
      setIsLoading(false);
    }
  };

  // Debounce the search to reduce unnecessary API calls
  const debouncedFetchSuggestions = useCallback(
    debounce((query: string) => {
      fetchSuggestions(query);
    }, 300),
    []
  );

  useEffect(() => {
    if (searchQuery) {
      debouncedFetchSuggestions(searchQuery);
    } else {
      setSuggestions([]);
    }

    return () => {
      debouncedFetchSuggestions.cancel();
    };
  }, [searchQuery]);

  const handleSelectDestination = (destination: AutocompleteResult) => {
    setSearchQuery(destination.place_name);
    onDestinationSelect(destination);
    setSuggestions([]);
  };

  const renderSuggestionItem = ({ item }: { item: AutocompleteResult }) => (
    <TouchableOpacity 
      style={styles.suggestionItem}
      onPress={() => handleSelectDestination(item)}
    >
      <Text style={styles.suggestionText}>{item.place_name}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        placeholder="Where are you heading?"
        value={searchQuery}
        onChangeText={setSearchQuery}
        clearButtonMode="while-editing"
      />
      {isLoading && <Text style={styles.loadingText}>Searching...</Text>}
      <FlatList
        data={suggestions}
        renderItem={renderSuggestionItem}
        keyExtractor={(item) => item.id}
        style={styles.suggestionsList}
        keyboardShouldPersistTaps="handled"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    padding: 10,
    borderRadius: 5,
    marginBottom: 10,
  },
  suggestionsList: {
    maxHeight: 200,
  },
  suggestionItem: {
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  suggestionText: {
    fontSize: 16,
  },
  loadingText: {
    textAlign: 'center',
    color: '#888',
    marginVertical: 10,
  },
});

export default DestinationSearch;