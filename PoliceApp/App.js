import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator, StatusBar, Image, ScrollView } from 'react-native';
import { Audio } from 'expo-av';

const SERVER_BASE = 'http://10.96.18.149:5000';
const SERVER_URL = `${SERVER_BASE}/run-ai`;
const SIREN_URL = 'https://www.soundjay.com/buttons/sounds/beep-07.mp3'; // Placeholder siren sound

export default function App() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [sound, setSound] = useState();
  const [alertMode, setAlertMode] = useState(false);
  const [imageUrl, setImageUrl] = useState(null);

  async function playSound() {
    try {
      console.log('Loading Sound');
      const { sound } = await Audio.Sound.createAsync(
        require('./assets/siren.mp3')
      );
      setSound(sound);

      console.log('Playing Sound');
      await sound.setIsLoopingAsync(true);
      await sound.playAsync();
    } catch (error) {
      console.error('Error playing sound:', error);
      alert('Siren sound failed to play. Check audio settings.');
    }
  }

  async function stopSound() {
    if (sound) {
      console.log('Stopping Sound');
      await sound.stopAsync();
      await sound.unloadAsync();
      setSound(undefined);
    }
  }

  useEffect(() => {
    return sound
      ? () => {
        console.log('Unloading Sound on cleanup');
        sound.unloadAsync();
      }
      : undefined;
  }, [sound]);

  const runDetection = async () => {
    setLoading(true);
    setResult(null);
    setAlertMode(false);
    setImageUrl(null);
    await stopSound();

    let data;
    try {
      const response = await fetch(SERVER_URL);
      data = await response.json();
      setResult(data);

      // Set image URL if available
      if (data.image_url) {
        setImageUrl(`${SERVER_BASE}${data.image_url}?t=${Date.now()}`);
      }
    } catch (error) {
      console.error('Network Error:', error);
      alert(`Failed to connect to ${SERVER_URL}. \nCheck if server is running.`);
      setLoading(false);
      return;
    }

    setLoading(false);

    if (data && data.blood) {
      setAlertMode(true);
      await playSound(); // This has its own try/catch now
    }
  };

  return (
    <View style={[styles.container, alertMode && styles.alertBackground]}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        <Text style={styles.title}>POLICE SURVEILLANCE</Text>
        <Text style={styles.subtitle}>AI Monitoring System</Text>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.main}>
        {loading ? (
          <View style={styles.statusBox}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.statusText}>Analyzing Video Stream...</Text>
          </View>
        ) : (
          <View style={styles.statusBox}>
            {!result ? (
              <Text style={styles.statusText}>Ready to Detect</Text>
            ) : (
              <View style={styles.resultContainer}>
                <Text style={styles.alertText}>
                  ALERT: {result.alert}
                </Text>
                <Text style={styles.infoText}>
                  Fight Detection: {result.fight ? 'YES' : 'NO'}
                </Text>
                <Text style={styles.infoText}>
                  Blood Detection: {result.blood ? 'YES' : 'NO'}
                </Text>
                {result.frame && (
                  <Text style={styles.infoText}>
                    Frame: {result.frame}
                  </Text>
                )}
              </View>
            )}
          </View>
        )}

        {imageUrl && (
          <View style={styles.imageContainer}>
            <Text style={styles.imageLabel}>Enhanced Detection Frame:</Text>
            <Image
              source={{ uri: imageUrl }}
              style={styles.detectionImage}
              resizeMode="contain"
            />
          </View>
        )}

        <TouchableOpacity
          style={styles.button}
          onPress={runDetection}
          disabled={loading}
        >
          <Text style={styles.buttonText}>START DETECTION</Text>
        </TouchableOpacity>

        {alertMode && (
          <TouchableOpacity
            style={styles.stopButton}
            onPress={stopSound}
          >
            <Text style={styles.buttonText}>STOP SIREN</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Secure Monitoring Unit v1.0</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 50,
  },
  alertBackground: {
    backgroundColor: '#8b0000',
  },
  header: {
    alignItems: 'center',
  },
  title: {
    color: '#fff',
    fontSize: 28,
    fontWeight: 'bold',
    letterSpacing: 2,
  },
  subtitle: {
    color: '#ccc',
    fontSize: 14,
    marginTop: 5,
  },
  scrollView: {
    width: '100%',
  },
  main: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: '10%',
  },
  statusBox: {
    backgroundColor: '#333',
    padding: 30,
    borderRadius: 15,
    width: '100%',
    alignItems: 'center',
    marginBottom: 30,
    borderWidth: 1,
    borderColor: '#444',
  },
  statusText: {
    color: '#fff',
    fontSize: 18,
  },
  resultContainer: {
    width: '100%',
  },
  alertText: {
    color: '#ff4444',
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 10,
  },
  infoText: {
    color: '#fff',
    fontSize: 16,
    marginVertical: 2,
  },
  imageContainer: {
    width: '100%',
    backgroundColor: '#222',
    borderRadius: 15,
    padding: 15,
    marginBottom: 20,
    borderWidth: 2,
    borderColor: '#ff4444',
  },
  imageLabel: {
    color: '#ff4444',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center',
  },
  detectionImage: {
    width: '100%',
    height: 300,
    borderRadius: 10,
  },
  button: {
    backgroundColor: '#0055ff',
    paddingVertical: 15,
    paddingHorizontal: 40,
    borderRadius: 30,
    elevation: 5,
  },
  stopButton: {
    backgroundColor: '#ff4444',
    paddingVertical: 15,
    paddingHorizontal: 40,
    borderRadius: 30,
    elevation: 5,
    marginTop: 20,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  footer: {
    alignItems: 'center',
  },
  footerText: {
    color: '#666',
    fontSize: 12,
  },
});
