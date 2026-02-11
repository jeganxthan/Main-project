import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator, StatusBar, Image, ScrollView, Dimensions, Alert } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { WebView } from 'react-native-webview';
// Migrating to legacy import for SDK 54 compatibility as requested by error log
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Audio } from 'expo-av';

const SERVER_BASE = 'http://192.168.1.38:5000';
const SERVER_URL = `${SERVER_BASE}/run-ai`;
const RESET_URL = `${SERVER_BASE}/reset-alert`;

// Live camera source (direct camera web UI/stream)
// NOTE: https with a self-signed cert will fail in WebView (SSL not trusted).
// Use http or install a trusted certificate on the camera.
const CAMERA_BASE = 'http://192.168.1.39';
const CAMERA_STREAM_URL = `${CAMERA_BASE}/`;

// Toggle to use camera directly vs Flask proxy
const DEFAULT_USE_DIRECT_CAMERA = false;
// Optional: base64 for "user:pass" if your camera needs Basic Auth
const CAMERA_BASIC_AUTH = '';
const CAMERA_HEADERS = CAMERA_BASIC_AUTH ? { Authorization: `Basic ${CAMERA_BASIC_AUTH}` } : {};

const { width } = Dimensions.get('window');

export default function App() {
  const [activeTab, setActiveTab] = useState('live');
  const [result, setResult] = useState(null);
  const [alertMode, setAlertMode] = useState(false);
  const [imageUrls, setImageUrls] = useState([]);
  const [downloading, setDownloading] = useState(false);
  const [useDirectCamera, setUseDirectCamera] = useState(DEFAULT_USE_DIRECT_CAMERA);
  const [liveLoading, setLiveLoading] = useState(false);

  const [sirenSound, setSirenSound] = useState(null);
  const pollInterval = useRef(null);
  const liveStreamUrl = useDirectCamera ? CAMERA_STREAM_URL : `${SERVER_BASE}/video_feed`;
  const liveLoadingTimer = useRef(null);

  // Video Player for Clips
  const videoUri = result && result.video_url ? `${SERVER_BASE}${result.video_url}` : null;
  const videoSource = videoUri ? { uri: videoUri } : null;
  const player = useVideoPlayer(null, (player) => {
    player.loop = true;
  });

  useEffect(() => {
    let cancelled = false;
    const loadVideo = async () => {
      if (!videoSource) return;
      try {
        await player.replaceAsync(videoSource);
        if (!cancelled) player.play();
      } catch (e) {
        console.error('Video load error:', e);
      }
    };
    loadVideo();
    return () => {
      cancelled = true;
    };
  }, [videoUri, player]);

  useEffect(() => {
    startPolling();
    return () => {
      stopPolling();
      stopSiren();
      if (liveLoadingTimer.current) {
        clearTimeout(liveLoadingTimer.current);
        liveLoadingTimer.current = null;
      }
    };
  }, []);

  // Load siren sound
  useEffect(() => {
    async function loadSound() {
      try {
        const { sound } = await Audio.Sound.createAsync(
          require('./assets/siren.mp3'),
          { isLooping: true }
        );
        setSirenSound(sound);
      } catch (error) {
        console.error('Error loading siren:', error);
      }
    }
    loadSound();
    return () => {
      if (sirenSound) {
        sirenSound.unloadAsync();
      }
    };
  }, []);

  const kickLiveLoading = () => {
    setLiveLoading(true);
    if (liveLoadingTimer.current) clearTimeout(liveLoadingTimer.current);
    // MJPEG streams never "finish" loading, so hide after a short grace period.
    liveLoadingTimer.current = setTimeout(() => setLiveLoading(false), 1500);
  };

  const startPolling = () => {
    if (pollInterval.current) return;
    pollInterval.current = setInterval(runDetection, 3000);
  };

  const stopPolling = () => {
    if (pollInterval.current) {
      clearInterval(pollInterval.current);
      pollInterval.current = null;
    }
  };

  const stopSiren = async () => {
    try {
      if (sirenSound) {
        await sirenSound.stopAsync();
        await sirenSound.setPositionAsync(0);
      }
    } catch (e) {
      console.error('Siren stop error:', e);
    }
  };

  async function playSiren() {
    try {
      if (sirenSound) {
        await sirenSound.setIsLoopingAsync(true);
        await sirenSound.playAsync();
      }
    } catch (error) {
      console.error('Siren play error:', error);
    }
  }

  async function stopSirenAndDismiss() {
    stopSiren();
    setAlertMode(false);
    try {
      await fetch(RESET_URL);
    } catch (e) {
      console.error('Reset alert error:', e);
    }
  }

  const runDetection = async () => {
    try {
      const response = await fetch(SERVER_URL);
      const data = await response.json();

      if (data.fight) {
        setResult(data);
        if (!result || data.timestamp !== result.timestamp) {
          if (data.image_urls) {
            setImageUrls(data.image_urls.map(url => `${SERVER_BASE}${url}?t=${Date.now()}`));
          }
          if (!alertMode) {
            setAlertMode(true);
            await playSiren();
            setActiveTab('alerts');
          }
        }
      }
    } catch (error) {
      console.error('Polling Error:', error);
    }
  };

  const downloadFile = async (url) => {
    setDownloading(true);
    try {
      console.log('Starting download for:', url);
      const filename = url.split('/').pop().split('?')[0];
      const fileUri = `${FileSystem.documentDirectory}${filename}`;

      // Using legacy API as requested by the error log
      const downloadResumable = FileSystem.createDownloadResumable(
        url,
        fileUri,
        {},
        (downloadProgress) => {
          const progress = downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite;
          console.log(`Download progress: ${progress * 100}%`);
        }
      );

      const result = await downloadResumable.downloadAsync();

      if (result && result.uri) {
        console.log('Download complete, sharing:', result.uri);
        await Sharing.shareAsync(result.uri);
      } else {
        Alert.alert('Error', 'File saved but could not be shared.');
      }
    } catch (e) {
      console.error('Detailed Download error:', e);
      Alert.alert('Error', `Download failed: ${e.message}`);
    } finally {
      setDownloading(false);
    }
  };

  const renderLiveView = () => (
    <View style={styles.tabContent}>
      <Text style={styles.tabTitle}>LIVE CAMERA FEED</Text>
      <View style={styles.liveToolbar}>
        <Text style={styles.liveSourceLabel}>
          {useDirectCamera ? 'SOURCE: CAMERA' : 'SOURCE: SERVER'}
        </Text>
        <TouchableOpacity
          style={styles.sourceButton}
          onPress={() => setUseDirectCamera((prev) => !prev)}
        >
          <Text style={styles.sourceButtonText}>
            {useDirectCamera ? 'USE SERVER' : 'USE CAMERA'}
          </Text>
        </TouchableOpacity>
      </View>
      <View style={styles.liveContainer}>
        <WebView
          source={{ uri: liveStreamUrl, headers: useDirectCamera ? CAMERA_HEADERS : {} }}
          style={styles.liveStream}
          scrollEnabled={false}
          scalesPageToFit={true}
          containerStyle={{ backgroundColor: '#000' }}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          allowsFullscreenVideo
          mediaPlaybackRequiresUserAction={false}
          mixedContentMode="always"
          onLoadStart={kickLiveLoading}
          onLoadProgress={(e) => {
            if (e.nativeEvent.progress >= 0.1) setLiveLoading(false);
          }}
          onLoadEnd={() => setLiveLoading(false)}
          onError={(e) => {
            setLiveLoading(false);
            console.error('Live stream WebView error:', e.nativeEvent);
          }}
          onHttpError={(e) => {
            setLiveLoading(false);
            console.error('Live stream WebView HTTP error:', e.nativeEvent);
          }}
        />
        {liveLoading && (
          <View style={styles.liveLoadingOverlay}>
            <ActivityIndicator size="large" color="#0055ff" />
          </View>
        )}
        <View style={styles.liveBadge}>
          <View style={styles.redDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      </View>
    </View>
  );

  const renderAlertsView = () => (
    <View style={styles.tabContent}>
      <Text style={styles.tabTitle}>FIGHT EVIDENCE</Text>
      {!result || !result.fight ? (
        <View style={styles.emptyAlerts}><Text style={styles.statusText}>No active alerts</Text></View>
      ) : (
        <ScrollView style={styles.alertsScroll}>
          <Text style={styles.alertText}>🚨 INCIDENT AT {new Date(result.timestamp * 1000).toLocaleTimeString()}</Text>
          <ScrollView horizontal pagingEnabled style={styles.imageScroll}>
            {imageUrls.map((url, index) => (
              <View key={index} style={styles.imageWrapper}>
                <Image source={{ uri: url }} style={styles.detectionImage} resizeMode="contain" />
                <TouchableOpacity
                  style={styles.downloadBtn}
                  onPress={() => downloadFile(url)}
                  disabled={downloading}
                >
                  <Text style={styles.downloadBtnText}>{downloading ? 'FETCHING...' : `SAVE IMAGE ${index + 1}`}</Text>
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
          <TouchableOpacity style={styles.stopButton} onPress={stopSirenAndDismiss}>
            <Text style={styles.buttonText}>DISMISS ALERT</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );

  const renderClipsView = () => (
    <View style={styles.tabContent}>
      <Text style={styles.tabTitle}>RECORDED CLIPS</Text>
      {!result || !result.video_url ? (
        <View style={styles.emptyAlerts}>
          {result && result.fight ? (
            <View style={{ alignItems: 'center' }}>
              <ActivityIndicator size="large" color="#0055ff" />
              <Text style={{ color: '#fff', marginTop: 10 }}>Saving Clip...</Text>
            </View>
          ) : (
            <Text style={styles.statusText}>No clips available</Text>
          )}
        </View>
      ) : (
        <View style={styles.videoCard}>
          <VideoView
            player={player}
            style={styles.videoPlayer}
            nativeControls
            contentFit="contain"
            allowsFullscreen
            allowsPictureInPicture
          />
          <TouchableOpacity
            style={styles.downloadButton}
            onPress={() => downloadFile(`${SERVER_BASE}${result.video_url}`)}
            disabled={downloading}
          >
            <Text style={styles.buttonText}>{downloading ? 'SAVING...' : 'DOWNLOAD FIGHT CLIP'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  return (
    <View style={[styles.container, alertMode && styles.alertBackground]}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}><Text style={styles.title}>POLICE SURVEILLANCE</Text></View>
      <View style={styles.tabBar}>
        <TouchableOpacity style={[styles.tabButton, activeTab === 'live' && styles.activeTab]} onPress={() => setActiveTab('live')}><Text style={styles.tabText}>LIVE</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.tabButton, activeTab === 'alerts' && styles.activeTab]} onPress={() => setActiveTab('alerts')}><Text style={styles.tabText}>ALERTS</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.tabButton, activeTab === 'clips' && styles.activeTab]} onPress={() => setActiveTab('clips')}><Text style={styles.tabText}>CLIPS</Text></TouchableOpacity>
      </View>
      <View style={styles.main}>
        {activeTab === 'live' && renderLiveView()}
        {activeTab === 'alerts' && renderAlertsView()}
        {activeTab === 'clips' && renderClipsView()}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  alertBackground: { backgroundColor: '#400' },
  header: { paddingTop: 60, paddingBottom: 20, alignItems: 'center' },
  title: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  tabBar: { flexDirection: 'row', height: 50, borderBottomWidth: 1, borderColor: '#333' },
  tabButton: { flex: 1, justifyCenter: 'center', alignItems: 'center' },
  activeTab: { borderBottomWidth: 3, borderColor: '#0055ff' },
  tabText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  main: { flex: 1 },
  tabContent: { flex: 1, padding: 15 },
  tabTitle: { color: '#0055ff', fontSize: 14, fontWeight: 'bold', marginBottom: 15, textAlign: 'center' },
  liveContainer: { width: '100%', height: 300, backgroundColor: '#000', borderRadius: 10, overflow: 'hidden' },
  liveStream: { flex: 1 },
  liveLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)'
  },
  liveToolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  liveSourceLabel: { color: '#888', fontSize: 10, fontWeight: 'bold' },
  sourceButton: { backgroundColor: '#222', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6 },
  sourceButtonText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  liveBadge: { position: 'absolute', top: 10, left: 10, backgroundColor: 'rgba(255,0,0,0.7)', padding: 5, borderRadius: 3 },
  redDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  liveText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  emptyAlerts: { flex: 1, justifyCenter: 'center', alignItems: 'center' },
  statusText: { color: '#666' },
  alertsScroll: { flex: 1 },
  alertText: { color: '#f44', fontSize: 16, fontWeight: 'bold', textAlign: 'center', marginBottom: 10 },
  imageScroll: { width: '100%', height: 380 },
  imageWrapper: { width: width - 30, height: 350, alignItems: 'center' },
  detectionImage: { width: '100%', height: '80%', borderRadius: 10 },
  downloadBtn: { backgroundColor: '#333', padding: 12, borderRadius: 8, marginTop: 10, width: '80%', alignItems: 'center' },
  downloadBtnText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  stopButton: { backgroundColor: '#f44', padding: 15, borderRadius: 10, alignItems: 'center', marginTop: 20 },
  downloadButton: { backgroundColor: '#0055ff', padding: 15, borderRadius: 10, alignItems: 'center', marginTop: 15 },
  buttonText: { color: '#fff', fontWeight: 'bold' },
  videoCard: { flex: 1 },
  videoPlayer: { width: '100%', height: 300, borderRadius: 10, backgroundColor: '#000' },
});
