import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  ImageBackground,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as FileSystem from 'expo-file-system/legacy';
import { setAudioModeAsync, createAudioPlayer } from 'expo-audio';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { LinearGradient } from 'expo-linear-gradient';

const Tab = createBottomTabNavigator();

// ─── Credentials ──────────────────────────────────────────────────────────────
const ELEVENLABS_API_KEY = process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY ?? '';
const PUSHOVER_TOKEN     = process.env.EXPO_PUBLIC_PUSHOVER_TOKEN     ?? '';
const PUSHOVER_USER      = process.env.EXPO_PUBLIC_PUSHOVER_USER      ?? '';

console.log('[Config] ElevenLabs key set:', !!ELEVENLABS_API_KEY);
console.log('[Config] Pushover token set:', !!PUSHOVER_TOKEN);
console.log('[Config] Pushover user set:',  !!PUSHOVER_USER);

// ─── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_USER_NAME  = 'Space Cowboy';
const ESP32_IP           = '10.244.175.209';
const STORAGE_ROOT       = FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? '';
const STORAGE_FILE_PATH  = STORAGE_ROOT ? `${STORAGE_ROOT}medication-app-data.json` : '';
const UTF8_ENCODING      = 'utf8';
const DEFAULT_TIME_VALUE = '08:00 AM';
const DEFAULT_USER_MEDICATIONS = [
  { id: 1, name: 'Oompa lompa Medicine',      time: '08:00 AM', dosage: '10mg',  slot: 1 },
  { id: 2, name: 'Blood Pressure Medication', time: '10:00 AM', dosage: '25mg',  slot: 2 },
  { id: 3, name: 'Heart Medication',          time: '12:00 PM', dosage: '100mg', slot: 3 },
];
const VOICE_PROFILES = [
  {
    id: 'guide',
    label: 'Calm Guide',
    voiceId: 'Xb7hH8MSUJpSbSDYk0k2',
    personality: 'a calm, clear medication coach who speaks with warmth, patience, and simple reassuring language',
  },
  {
    id: 'cheer',
    label: 'Bright Cheer',
    voiceId: 'TxGi1N29NQoCaYD4fcU5',
    personality: 'an upbeat encourager who sounds positive, energizing, and celebratory without being too loud',
  },
  {
    id: 'companion',
    label: 'Gentle Companion',
    voiceId: 'nPczCjzI2devNBz1zQrb',
    personality: 'a kind supportive companion who sounds caring, steady, and thoughtful during reminders',
  },
  {
    id: 'coach',
    label: 'Focused Coach',
    voiceId: 'cjVigY5qzO86Huf0OWal',
    personality: 'a confident health coach who sounds direct, motivating, and encouraging for daily routines',
  },
];
const DEFAULT_VOICE_PROFILE_ID = VOICE_PROFILES[0].id;
const HOURS   = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));
const PERIODS = ['AM', 'PM'];

let activePlayer = null;

// ─── Audio ────────────────────────────────────────────────────────────────────
async function configureAudio() {
  if (Platform.OS === 'web') return; // browser handles audio natively
  try {
    await setAudioModeAsync({
      playsInSilentModeIOS:       true,
      staysActiveInBackground:    false,
      shouldDuckAndroid:          true,
      playThroughEarpieceAndroid: false,
    });
  } catch (error) {
    console.warn('[Audio] configureAudio failed:', error?.message ?? error);
  }
}

// ─── Platform flag ────────────────────────────────────────────────────────────
const IS_WEB = Platform.OS === 'web';

// ─── Pushover Push Notifications ─────────────────────────────────────────────
async function sendPushover(title, message) {
  if (!PUSHOVER_TOKEN || !PUSHOVER_USER) {
    console.warn('[Pushover] Credentials missing — check EXPO_PUBLIC_PUSHOVER_TOKEN and EXPO_PUBLIC_PUSHOVER_USER in .env');
    return { success: false };
  }
  console.log('[Pushover] Sending:', title);
  try {
    const response = await fetch('https://api.pushover.net/1/messages.json', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token:   PUSHOVER_TOKEN,
        user:    PUSHOVER_USER,
        title,
        message,
        sound:   'magic',
      }),
    });
    const data = await response.json();
    if (data.status !== 1) {
      console.error('[Pushover] Error:', JSON.stringify(data.errors));
      return { success: false };
    }
    console.log('[Pushover] Notification sent successfully.');
    return { success: true };
  } catch (error) {
    console.error('[Pushover] Network error:', error?.message ?? error);
    return { success: false };
  }
}

// ─── ESP32 Communication ──────────────────────────────────────────────────────
function convertTo24Hour(timeStr) {
  const [timePart, period] = timeStr.split(' ');
  let [h, m] = timePart.split(':');
  h = parseInt(h, 10);
  if (period === 'PM' && h !== 12) h += 12;
  if (period === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

async function sendDispenseCommand() {
  try {
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 10000);
    const response   = await fetch(`http://${ESP32_IP}/takeNow`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) throw new Error('Connection failed');
    return { success: true };
  } catch (error) {
    console.error('[ESP32] Dispense error:', error?.message ?? error);
    return { success: false };
  }
}

async function sendMedicationToDispenser(userName, medName, dosage, time) {
  try {
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 30000);
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const currentTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    const response = await fetch(`http://${ESP32_IP}/api/update`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  controller.signal,
      body: JSON.stringify({
        username:    userName,
        medName,
        dosage,
        time:        convertTo24Hour(time),
        currentTime,
      }),
    });
    clearTimeout(timeoutId);
    if (!response.ok) throw new Error('ESP32 returned an error');
    return { success: true };
  } catch (error) {
    console.error('[ESP32] Update error:', error?.message ?? error);
    return { success: false };
  }
}

// ─── Storage ──────────────────────────────────────────────────────────────────
function createDefaultUserRecord(username, password) {
  return {
    password,
    preferences: {
      selectedProfileId: DEFAULT_VOICE_PROFILE_ID,
      userName: username || DEFAULT_USER_NAME,
    },
    medications:     DEFAULT_USER_MEDICATIONS.map((m) => ({ ...m })),
    dispenseHistory: [],
  };
}

function getDefaultStorage() { return { users: {} }; }

async function ensureStorageFile() {
  if (!STORAGE_FILE_PATH) return;
  const info = await FileSystem.getInfoAsync(STORAGE_FILE_PATH);
  if (!info.exists) {
    await FileSystem.writeAsStringAsync(
      STORAGE_FILE_PATH,
      JSON.stringify(getDefaultStorage()),
      { encoding: UTF8_ENCODING }
    );
  }
}

async function readStorage() {
  try {
    if (!STORAGE_FILE_PATH) return getDefaultStorage();
    await ensureStorageFile();
    const raw = await FileSystem.readAsStringAsync(STORAGE_FILE_PATH, { encoding: UTF8_ENCODING });
    return raw ? JSON.parse(raw) : getDefaultStorage();
  } catch { return getDefaultStorage(); }
}

async function writeStorage(data) {
  if (!STORAGE_FILE_PATH) return;
  await FileSystem.writeAsStringAsync(STORAGE_FILE_PATH, JSON.stringify(data), { encoding: UTF8_ENCODING });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getGreetingForHour(date) {
  const h = date.getHours();
  if (h < 12) return 'Good Morning';
  if (h < 18) return 'Good Afternoon';
  return 'Good Evening';
}

function getVoiceProfile(profileId) {
  return VOICE_PROFILES.find((p) => p.id === profileId) ?? VOICE_PROFILES[0];
}

function formatTimeFromParts(hours, minutes, period) {
  return `${hours}:${minutes} ${period}`;
}

function parseTimeValue(timeValue = DEFAULT_TIME_VALUE) {
  const [timePart = '08:00', period = 'AM'] = timeValue.split(' ');
  const [hours = '08', minutes = '00'] = timePart.split(':');
  return {
    hours:   hours.padStart(2, '0'),
    minutes: minutes.padStart(2, '0'),
    period:  period === 'PM' ? 'PM' : 'AM',
  };
}

function toDateFromTimeValue(timeValue) {
  const { hours, minutes, period } = parseTimeValue(timeValue);
  const date = new Date();
  let h = Number(hours) % 12;
  if (period === 'PM') h += 12;
  date.setHours(h, Number(minutes), 0, 0);
  return date;
}

function getNextMedication(medications) {
  if (!medications.length) return null;
  const now = new Date();
  return [...medications]
    .map((med) => {
      const nextTime = toDateFromTimeValue(med.time);
      if (nextTime < now) nextTime.setDate(nextTime.getDate() + 1);
      return { ...med, nextTime };
    })
    .sort((a, b) => a.nextTime - b.nextTime)[0];
}

function calculateAdherence(dispenseHistory, medications) {
  if (!medications.length) return 0;
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const totalScheduled = medications.length * 7;
  const recent = dispenseHistory.filter((d) => new Date(d.timestamp) >= sevenDaysAgo);
  return totalScheduled === 0 ? 0 : Math.min(100, Math.round((recent.length / totalScheduled) * 100));
}

function calculateStreak(dispenseHistory) {
  if (!dispenseHistory.length) return 0;
  const sorted = [...dispenseHistory].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  let streak = 0;
  let currentDate = new Date();
  currentDate.setHours(0, 0, 0, 0);
  for (let i = 0; i < 365; i++) {
    const hit = sorted.some((d) => {
      const dd = new Date(d.timestamp);
      dd.setHours(0, 0, 0, 0);
      return dd.getTime() === currentDate.getTime();
    });
    if (hit) { streak++; currentDate.setDate(currentDate.getDate() - 1); }
    else break;
  }
  return streak;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      const idx    = typeof result === 'string' ? result.indexOf('base64,') : -1;
      if (idx === -1) { reject(new Error('Unable to convert audio to base64.')); return; }
      resolve(result.slice(idx + 7));
    };
    reader.onerror = () => reject(new Error('Unable to read audio response.'));
    reader.readAsDataURL(blob);
  });
}

async function createPlayableAudioFile(audioBlob) {
  try {
    const audioDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
    if (!audioDir) { console.error('[Voice] No filesystem access'); return null; }
    const base64Audio   = await blobToBase64(audioBlob);
    const audioFilePath = `${audioDir}voice-${Date.now()}.mp3`;
    await FileSystem.writeAsStringAsync(audioFilePath, base64Audio, { encoding: 'base64' });
    return audioFilePath;
  } catch (error) {
    console.error('[Voice] Error creating audio file:', error?.message ?? error);
    return null;
  }
}

function buildVoicePrompt(message) {
  return String(message);
}

async function stopActiveSound() {
  if (!activePlayer) return;
  const p = activePlayer;
  activePlayer = null;
  try { p.pause(); } catch {}
  if (!IS_WEB) {
    try { p.remove(); } catch {}
  }
}

async function speakText(message, options = {}) {
  const { profileId = DEFAULT_VOICE_PROFILE_ID, userName = DEFAULT_USER_NAME } = options;
  const profile = getVoiceProfile(profileId);
  const text = buildVoicePrompt(message);

  console.log('[Voice] speakText called:', JSON.stringify(text).slice(0, 60));
  console.log('[Voice] API key present:', !!ELEVENLABS_API_KEY);

  if (!ELEVENLABS_API_KEY) {
    console.warn('[Voice] No ElevenLabs API key — voice skipped.');
    return;
  }
  if (!text || text.trim().length === 0) {
    console.warn('[Voice] Empty message — voice skipped.');
    return;
  }

  await stopActiveSound();

  try {
    await configureAudio();

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${profile.voiceId}`, {
      method:  'POST',
      headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_id: 'eleven_turbo_v2_5', text }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[Voice] API error:', response.status, errText);
      return;
    }

    const blob = await response.blob();

    if (IS_WEB) {
      // ── Web: use browser Audio API directly ──────────────────────────────
      const url   = URL.createObjectURL(blob);
      const audio = new Audio(url);
      activePlayer = audio;
      audio.onended = () => {
        if (activePlayer === audio) activePlayer = null;
        URL.revokeObjectURL(url);
      };
      audio.play();
      console.log('[Voice] Playing audio (web).');
    } else {
      // ── Mobile: write to file then use expo-audio ─────────────────────────
      const audioFilePath = await createPlayableAudioFile(blob);
      if (!audioFilePath) { console.error('[Voice] Failed to write audio file.'); return; }

      const player = createAudioPlayer({ uri: audioFilePath });
      activePlayer = player;
      player.addListener('playbackStatusUpdate', (status) => {
        if (!status.didJustFinish) return;
        if (activePlayer === player) activePlayer = null;
        try { player.remove(); } catch {}
        FileSystem.deleteAsync(audioFilePath, { idempotent: true }).catch(() => {});
      });
      player.play();
      console.log('[Voice] Playing audio (mobile).');
    }
  } catch (error) {
    console.error('[Voice] Error:', error?.message ?? error);
    try { activePlayer?.pause(); } catch {}
    if (!IS_WEB) { try { activePlayer?.remove(); } catch {} }
    activePlayer = null;
  }
}

function handlePressWithVoice(action, message, voiceOptions) {
  speakText(message, voiceOptions);
  action?.();
}

// ─── Shared UI ────────────────────────────────────────────────────────────────
function ScreenContainer({ children, keyboardOffset = 100 }) {
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={keyboardOffset}
    >
      <Pressable style={styles.container} onPress={Keyboard.dismiss}>
        {children}
      </Pressable>
    </KeyboardAvoidingView>
  );
}

function TimeWheelColumn({ items, selectedValue, onSelect }) {
  return (
    <ScrollView
      style={styles.timeColumn}
      contentContainerStyle={styles.timeColumnContent}
      showsVerticalScrollIndicator={false}
    >
      {items.map((item) => {
        const isSelected = item === selectedValue;
        return (
          <TouchableOpacity
            key={item}
            style={[styles.timeOption, isSelected && styles.timeOptionSelected]}
            onPress={() => onSelect(item)}
          >
            <Text style={[styles.timeOptionText, isSelected && styles.timeOptionTextSelected]}>
              {item}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

function TimePickerModal({ visible, value, onCancel, onConfirm, voiceOptions }) {
  const parsed = parseTimeValue(value);
  const [selectedHours,   setSelectedHours]   = useState(parsed.hours);
  const [selectedMinutes, setSelectedMinutes] = useState(parsed.minutes);
  const [selectedPeriod,  setSelectedPeriod]  = useState(parsed.period);

  useEffect(() => {
    const p = parseTimeValue(value);
    setSelectedHours(p.hours);
    setSelectedMinutes(p.minutes);
    setSelectedPeriod(p.period);
  }, [value, visible]);

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onCancel}>
      <View style={styles.modalOverlay}>
        <View style={styles.timePickerCard}>
          <View style={styles.timePickerHeader}>
            <TouchableOpacity onPress={onCancel}>
              <Text style={styles.timePickerCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.timePickerTitle}>Set Medication Time</Text>
            <TouchableOpacity
              onPress={() => {
                const tv = formatTimeFromParts(selectedHours, selectedMinutes, selectedPeriod);
                speakText('Time set', voiceOptions);
                onConfirm(tv);
              }}
            >
              <Text style={styles.timePickerDone}>Done</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.timePickerPreview}>
            {formatTimeFromParts(selectedHours, selectedMinutes, selectedPeriod)}
          </Text>
          <View style={styles.timePickerWheels}>
            <TimeWheelColumn items={HOURS}   selectedValue={selectedHours}   onSelect={setSelectedHours}   />
            <TimeWheelColumn items={MINUTES} selectedValue={selectedMinutes} onSelect={setSelectedMinutes} />
            <TimeWheelColumn items={PERIODS} selectedValue={selectedPeriod}  onSelect={setSelectedPeriod}  />
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Screens ──────────────────────────────────────────────────────────────────
function AuthScreen({ onLogin, onRegister, voiceOptions }) {
  const [mode,     setMode]     = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = () => {
    const u = username.trim();
    const p = password.trim();
    if (!u || !p) {
      Alert.alert('Missing Details', 'Enter both a username and password.');
      speakText('Missing details', voiceOptions);
      return;
    }
    mode === 'login' ? onLogin(u, p) : onRegister(u, p);
  };

  return (
    <ImageBackground
      source={require('./assets/splash.png')}
      style={styles.container}
      imageStyle={{ opacity: 0.15 }}
    >
      <LinearGradient
        colors={['rgba(102,126,234,0.85)', 'rgba(118,75,162,0.85)', 'rgba(240,147,251,0.85)']}
        style={styles.container}
      >
        <ScreenContainer keyboardOffset={60}>
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.authScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.authHero}>
              <Image source={require('./assets/splash.png')} style={styles.authLogo} />
              <Text style={styles.authTitle}>Scooby Snack</Text>
              <Text style={styles.authSubtitle}>
                Log in to keep each medication schedule private to its own user.
              </Text>
            </View>

            <View style={styles.authCard}>
              <View style={styles.authTabs}>
                {['login', 'register'].map((m) => (
                  <TouchableOpacity
                    key={m}
                    style={[styles.authTab, mode === m && styles.authTabActive]}
                    onPress={() => setMode(m)}
                  >
                    <Text style={[styles.authTabText, mode === m && styles.authTabTextActive]}>
                      {m === 'login' ? 'Log In' : 'Sign Up'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.authLabel}>Username</Text>
              <TextInput
                style={styles.input}
                value={username}
                onChangeText={setUsername}
                placeholder="Enter username"
                placeholderTextColor="#999"
                autoCapitalize="none"
              />
              <Text style={styles.authLabel}>Password</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="Enter password"
                placeholderTextColor="#999"
                secureTextEntry
              />
              <TouchableOpacity style={styles.authButton} onPress={handleSubmit}>
                <Text style={styles.authButtonText}>
                  {mode === 'login' ? 'Continue to App' : 'Create Account'}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </ScreenContainer>
      </LinearGradient>
    </ImageBackground>
  );
}

// ─── HomeScreen ───────────────────────────────────────────────────────────────
function HomeScreen({ navigation, voiceOptions, medications, onRecordDispense }) {
  const [currentTime,  setCurrentTime]  = useState(new Date());
  const [isDispensing, setIsDispensing] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const nextMedication = useMemo(() => getNextMedication(medications), [medications]);

  useEffect(() => {
    if (!nextMedication) return;
    sendMedicationToDispenser(
      voiceOptions.userName,
      nextMedication.name,
      nextMedication.dosage ?? 'As prescribed',
      nextMedication.time
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const formatTime = (date) => {
    let h        = date.getHours();
    const m      = String(date.getMinutes()).padStart(2, '0');
    const period = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m} ${period}`;
  };

  const handleTakeNow = async () => {
    if (!nextMedication) return;
    setIsDispensing(true);

    speakText(
      `Taking ${nextMedication.name}. ${nextMedication.dosage ?? ''}`,
      voiceOptions
    );

    await sendMedicationToDispenser(
      voiceOptions.userName,
      nextMedication.name,
      nextMedication.dosage ?? 'As prescribed',
      nextMedication.time
    );

    const result = await sendDispenseCommand();
    if (result.success) {
      onRecordDispense(nextMedication);
    } else {
      Alert.alert(
        'Cannot Connect to Dispenser',
        'Please make sure your phone is on the same WiFi as the dispenser and try again.'
      );
    }

    setIsDispensing(false);
  };

  return (
    <LinearGradient colors={['#667eea', '#764ba2', '#f093fb']} style={styles.container}>
      <ScreenContainer>
        <ScrollView style={styles.scrollView} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Text style={styles.greeting}>{getGreetingForHour(currentTime)}, {voiceOptions.userName}!</Text>
            <Text style={styles.clock}>{formatTime(currentTime)}</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Next Medication</Text>
            <View style={styles.medicationCard}>
              <View style={styles.medIcon}>
                <Text style={styles.heroEmoji}>💊</Text>
              </View>
              <View style={styles.medInfo}>
                <Text style={styles.medName}>{nextMedication ? nextMedication.name : 'No medications yet'}</Text>
                <Text style={styles.medTime}>{nextMedication ? nextMedication.time : 'Add your first reminder'}</Text>
                {nextMedication?.dosage ? (
                  <Text style={styles.medDosage}>{nextMedication.dosage}</Text>
                ) : null}
              </View>
            </View>
            <TouchableOpacity
              style={[styles.takeButton, isDispensing && styles.takeButtonDisabled]}
              onPress={() => {
                if (nextMedication) {
                  handleTakeNow();
                } else {
                  handlePressWithVoice(() => navigation.navigate('Medications'), 'Medications', voiceOptions);
                }
              }}
              disabled={isDispensing}
            >
              <Text style={styles.takeButtonText}>
                {isDispensing ? 'Dispensing...' : nextMedication ? 'Take Now' : 'Add a Medication'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.card}>
            <Text style={styles.streakText}>🔥 Keep Your Streak Going!</Text>
            <Text style={styles.streakSubtext}>Track your progress in Insights</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Quick Actions</Text>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => handlePressWithVoice(() => navigation.navigate('Medications'), 'Medications', voiceOptions)}
            >
              <Text style={styles.actionButtonText}>💊 View Medications</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => handlePressWithVoice(() => navigation.navigate('Insights'), 'Insights', voiceOptions)}
            >
              <Text style={styles.actionButtonText}>📊 View Progress</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </ScreenContainer>
    </LinearGradient>
  );
}

// ─── MedicationsScreen ────────────────────────────────────────────────────────
function MedicationsScreen({ voiceOptions, medications, onSaveMedications, userName }) {
  const [showAddForm,         setShowAddForm]         = useState(false);
  const [newMedName,          setNewMedName]          = useState('');
  const [newMedDosage,        setNewMedDosage]        = useState('');
  const [newMedTime,          setNewMedTime]          = useState(DEFAULT_TIME_VALUE);
  const [isTimePickerVisible, setIsTimePickerVisible] = useState(false);
  const [isSending,           setIsSending]           = useState(false);

  const handleDeleteMedication = (med) => {
    Alert.alert(
      'Remove Medication',
      `Remove ${med.name} from your schedule?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            const updated = medications
              .filter((m) => m.id !== med.id)
              .map((m, i) => ({ ...m, slot: i + 1 }));
            onSaveMedications(updated);
            // Delay voice so state re-render completes before audio starts
            setTimeout(() => speakText(med.name, voiceOptions), 300);
          },
        },
      ]
    );
  };

  const handleAddMedication = async () => {
    const trimmedName   = newMedName.trim();
    const trimmedDosage = newMedDosage.trim();

    if (!trimmedName || !newMedTime) {
      Alert.alert('Missing Details', 'Enter a medication name and time.');
      speakText('Missing details', voiceOptions);
      return;
    }

    const nextMedication = {
      id:     Date.now(),
      name:   trimmedName,
      dosage: trimmedDosage || 'As prescribed',
      time:   newMedTime,
      slot:   medications.length + 1,
    };

    onSaveMedications([...medications, nextMedication]);

    setIsSending(true);
    const result = await sendMedicationToDispenser(
      userName,
      trimmedName,
      trimmedDosage || 'As prescribed',
      newMedTime
    );
    setIsSending(false);

    if (result.success) {
      Alert.alert('Saved', 'Medication added and dispenser updated!');
    } else {
      Alert.alert('Saved Locally', 'Medication added, but the dispenser could not be reached. Check your WiFi connection.');
    }
    speakText(trimmedName, voiceOptions);

    setNewMedName('');
    setNewMedDosage('');
    setNewMedTime(DEFAULT_TIME_VALUE);
    setShowAddForm(false);
  };

  return (
    <LinearGradient colors={['#667eea', '#764ba2', '#f093fb']} style={styles.container}>
      <ScreenContainer keyboardOffset={110}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.medicationsScrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Text style={styles.title}>💊 Medications</Text>
            <Text style={styles.subtitle}>Manage your medication schedule</Text>
          </View>

          {medications.map((med) => (
            <View key={med.id} style={styles.medCard}>
              <TouchableOpacity
                style={styles.medCardContent}
                onPress={() => speakText(med.name, voiceOptions)}
              >
                <View style={styles.medIconSmall}>
                  <Text style={styles.cardEmoji}>💊</Text>
                </View>
                <View style={styles.medInfo}>
                  <Text style={styles.medName}>{med.name}</Text>
                  <Text style={styles.medTime}>⏰ {med.time}</Text>
                  {med.dosage ? <Text style={styles.medDosage}>💉 {med.dosage}</Text> : null}
                  <Text style={styles.medSlot}>Slot {med.slot}</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={() => handleDeleteMedication(med)}
              >
                <Text style={styles.deleteButtonText}>🗑</Text>
              </TouchableOpacity>
            </View>
          ))}

          {!showAddForm && (
            <TouchableOpacity
              style={styles.addButton}
              onPress={() => handlePressWithVoice(() => setShowAddForm(true), 'Add medication', voiceOptions)}
            >
              <Text style={styles.addButtonText}>➕ Add Medication</Text>
            </TouchableOpacity>
          )}

          {showAddForm && (
            <View style={styles.formCard}>
              <Text style={styles.formTitle}>Add New Medication</Text>
              <TextInput
                style={styles.input}
                placeholder="Medication Name"
                placeholderTextColor="#999"
                value={newMedName}
                onChangeText={setNewMedName}
                returnKeyType="next"
              />
              <TextInput
                style={styles.input}
                placeholder="Dosage (e.g. 100mg)"
                placeholderTextColor="#999"
                value={newMedDosage}
                onChangeText={setNewMedDosage}
                returnKeyType="done"
              />
              <Text style={styles.timePickerLabel}>Medication Time</Text>
              <TouchableOpacity
                style={styles.timePickerButton}
                onPress={() => { Keyboard.dismiss(); setIsTimePickerVisible(true); }}
              >
                <Text style={styles.timePickerButtonText}>{newMedTime}</Text>
              </TouchableOpacity>
              <View style={styles.formButtons}>
                <TouchableOpacity
                  style={[styles.formButton, styles.cancelButton]}
                  onPress={() => handlePressWithVoice(() => setShowAddForm(false), 'Cancel', voiceOptions)}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.formButton, styles.saveButton, isSending && { opacity: 0.6 }]}
                  onPress={handleAddMedication}
                  disabled={isSending}
                >
                  <Text style={styles.saveButtonText}>{isSending ? 'Syncing...' : 'Save'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <View style={styles.spacer} />
        </ScrollView>
      </ScreenContainer>
      <TimePickerModal
        visible={isTimePickerVisible}
        value={newMedTime}
        voiceOptions={voiceOptions}
        onCancel={() => setIsTimePickerVisible(false)}
        onConfirm={(tv) => { setNewMedTime(tv); setIsTimePickerVisible(false); }}
      />
    </LinearGradient>
  );
}

function InsightsScreen({ voiceOptions, medications, dispenseHistory = [] }) {
  const adherence = calculateAdherence(dispenseHistory, medications);
  const streak    = calculateStreak(dispenseHistory);
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const totalTaken     = dispenseHistory.filter((d) => new Date(d.timestamp) >= sevenDaysAgo).length;
  const totalScheduled = medications.length * 7;

  return (
    <LinearGradient colors={['#667eea', '#764ba2', '#f093fb']} style={styles.container}>
      <ScreenContainer>
        <ScrollView style={styles.scrollView} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Text style={styles.title}>📊 Insights</Text>
            <Text style={styles.subtitle}>Track your progress</Text>
          </View>

          <TouchableOpacity
            style={styles.progressCard}
            onPress={() => speakText(`${adherence} percent adherence`, voiceOptions)}
          >
            <View style={styles.progressCircle}>
              <Text style={styles.progressPercent}>{adherence}%</Text>
              <Text style={styles.progressLabel}>Adherence</Text>
            </View>
            <Text style={styles.progressText}>
              {totalTaken > 0
                ? `You've taken ${totalTaken} out of ${totalScheduled} medications this week!`
                : 'Start taking your medications to track adherence!'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.streakCard}
            onPress={() => speakText(`${streak} day streak`, voiceOptions)}
          >
            <Text style={styles.streakEmoji}>🔥</Text>
            <Text style={styles.streakNumber}>{streak}</Text>
            <Text style={styles.streakLabel}>Day Streak</Text>
          </TouchableOpacity>

          <View style={styles.statsGrid}>
            {[
              { value: totalTaken,                               label: 'Taken'  },
              { value: Math.max(0, totalScheduled - totalTaken), label: 'Missed' },
              { value: streak,                                   label: 'Streak' },
              { value: `${adherence}%`,                          label: 'Score'  },
            ].map(({ value, label }) => (
              <TouchableOpacity
                key={label}
                style={styles.statCard}
                onPress={() => speakText(`${value} ${label}`, voiceOptions)}
              >
                <Text style={styles.statNumber}>{value}</Text>
                <Text style={styles.statLabel}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {adherence > 0 && (
            <TouchableOpacity
              style={styles.motivationCard}
              onPress={() => speakText('Great progress! Keep it up!', voiceOptions)}
            >
              <Text style={styles.motivationText}>💪 Amazing progress! You're doing great!</Text>
            </TouchableOpacity>
          )}
          <View style={styles.spacer} />
        </ScrollView>
      </ScreenContainer>
    </LinearGradient>
  );
}

// ─── VoiceSettings ────────────────────────────────────────────────────────────
function VoiceSettings({
  currentUsername, userName, onChangeUserName, onLogout,
  selectedProfileId, onSelectProfile,
}) {
  const [draftName,  setDraftName]  = useState(userName);
  const [isTesting,  setIsTesting]  = useState(false);

  const handleSaveName = () => {
    const next = draftName.trim() || DEFAULT_USER_NAME;
    onChangeUserName(next);
    Alert.alert('Saved', `Your voice assistant will call you ${next}.`);
    speakText(`Hello ${next}`, { profileId: selectedProfileId, userName: next });
  };

  const handleTestVoice = async () => {
    setIsTesting(true);
    await speakText(`Hello ${userName}, your medication assistant is ready.`, { profileId: selectedProfileId, userName });
    setIsTesting(false);
  };

  return (
    <LinearGradient colors={['#667eea', '#764ba2', '#f093fb']} style={styles.container}>
      <ScreenContainer keyboardOffset={100}>
        <ScrollView style={styles.scrollView} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Text style={styles.title}>🎤 Settings</Text>
            <Text style={styles.subtitle}>Signed in as {currentUsername}</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>👤 Your Name</Text>
            <Text style={styles.sectionSubtitle}>Your assistant will use this name for reminders.</Text>
            <View style={styles.nameInputContainer}>
              <TextInput
                style={styles.nameInput}
                placeholder={DEFAULT_USER_NAME}
                placeholderTextColor="#999"
                value={draftName}
                onChangeText={setDraftName}
              />
              <TouchableOpacity style={styles.saveButton} onPress={handleSaveName}>
                <Text style={styles.saveButtonText}>Save</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.previewText}>Preview: Good morning, {userName}!</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>🎙️ Voice Profiles</Text>
            <Text style={styles.sectionSubtitle}>Choose a voice personality</Text>
            {VOICE_PROFILES.map((profile) => {
              const isSelected = profile.id === selectedProfileId;
              return (
                <TouchableOpacity
                  key={profile.id}
                  style={[styles.voiceOption, isSelected && styles.voiceOptionSelected]}
                  onPress={() => {
                    onSelectProfile(profile.id);
                    speakText(profile.label, { profileId: profile.id, userName });
                  }}
                >
                  <View style={styles.voiceOptionHeader}>
                    <Text style={styles.voiceOptionTitle}>{isSelected ? '✅ ' : ''}{profile.label}</Text>
                    <Text style={styles.voiceOptionMeta}>Voice ID: {profile.voiceId}</Text>
                  </View>
                  <Text style={styles.voiceOptionText}>{profile.personality}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity style={styles.testButton} onPress={handleTestVoice} disabled={isTesting}>
            <LinearGradient colors={['#4CAF50', '#45a049']} style={styles.testButtonGradient}>
              <Text style={styles.testButtonText}>{isTesting ? '🎤 Testing...' : '🎤 Test Voice'}</Text>
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity style={styles.logoutButton} onPress={onLogout}>
            <Text style={styles.logoutButtonText}>Log Out</Text>
          </TouchableOpacity>
          <View style={styles.spacer} />
        </ScrollView>
      </ScreenContainer>
    </LinearGradient>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [storage,         setStorage]         = useState(getDefaultStorage());
  const [currentUsername, setCurrentUsername] = useState(null);
  const [isBooting,       setIsBooting]       = useState(true);

  useEffect(() => {
    readStorage().then((s) => { setStorage(s); setIsBooting(false); });
  }, []);

  const currentUserRecord = currentUsername ? storage.users[currentUsername] : null;
  const userName          = currentUserRecord?.preferences?.userName          ?? DEFAULT_USER_NAME;
  const selectedProfileId = currentUserRecord?.preferences?.selectedProfileId ?? DEFAULT_VOICE_PROFILE_ID;
  const medications       = currentUserRecord?.medications       ?? [];
  const dispenseHistory   = currentUserRecord?.dispenseHistory   ?? [];
  const voiceOptions      = { profileId: selectedProfileId, userName };

  const updateStorage = async (updater) => {
    const next = updater(storage);
    setStorage(next);
    await writeStorage(next);
  };

  const handleRegister = async (username, password) => {
    if (storage.users[username]) {
      Alert.alert('Account Exists', 'That username already exists.');
      speakText('Username taken', voiceOptions);
      return;
    }
    await updateStorage((s) => ({
      ...s,
      users: { ...s.users, [username]: createDefaultUserRecord(username, password) },
    }));
    setCurrentUsername(username);
    Alert.alert('Welcome', 'Your account has been created.');
  };

  const handleLogin = (username, password) => {
    const user = storage.users[username];
    if (!user || user.password !== password) {
      Alert.alert('Login Failed', 'Incorrect username or password.');
      speakText('Login failed', voiceOptions);
      return;
    }
    setCurrentUsername(username);
  };

  const handleLogout = () => setCurrentUsername(null);

  const handleSaveMedications = async (nextMedications) => {
    if (!currentUsername) return;
    await updateStorage((s) => ({
      ...s,
      users: {
        ...s.users,
        [currentUsername]: {
          ...s.users[currentUsername],
          medications: nextMedications.map((m, i) => ({ ...m, slot: i + 1 })),
        },
      },
    }));
  };

  const handleRecordDispense = async (medication) => {
    if (!currentUsername || !medication) return;
    const record = {
      id:             Date.now(),
      medicationId:   medication.id,
      medicationName: medication.name,
      timestamp:      new Date().toISOString(),
      slot:           medication.slot,
    };
    await updateStorage((s) => ({
      ...s,
      users: {
        ...s.users,
        [currentUsername]: {
          ...s.users[currentUsername],
          dispenseHistory: [...(s.users[currentUsername].dispenseHistory || []), record],
        },
      },
    }));

    Alert.alert('Success', `${medication.name} taken!`);
    speakText(`${medication.name} has been dispensed. Great job!`, voiceOptions);

    // Send Pushover push notification to caregiver
    sendPushover(
      '💊 Medication Taken',
      `${userName} has taken their ${medication.name} (${medication.dosage ?? ''}) at ${new Date().toLocaleTimeString()}.`
    );
  };

  const handleChangeUserName = async (nextName) => {
    if (!currentUsername) return;
    await updateStorage((s) => ({
      ...s,
      users: {
        ...s.users,
        [currentUsername]: {
          ...s.users[currentUsername],
          preferences: { ...s.users[currentUsername].preferences, userName: nextName },
        },
      },
    }));
  };

  const handleSelectProfile = async (profileId) => {
    if (!currentUsername) return;
    await updateStorage((s) => ({
      ...s,
      users: {
        ...s.users,
        [currentUsername]: {
          ...s.users[currentUsername],
          preferences: { ...s.users[currentUsername].preferences, selectedProfileId: profileId },
        },
      },
    }));
  };

  if (isBooting) {
    return (
      <LinearGradient colors={['#667eea', '#764ba2', '#f093fb']} style={styles.loadingScreen}>
        <StatusBar style="light" />
        <Text style={styles.loadingText}>Loading your medication companion...</Text>
      </LinearGradient>
    );
  }

  if (!currentUsername) {
    return (
      <>
        <StatusBar style="light" />
        <AuthScreen onLogin={handleLogin} onRegister={handleRegister} voiceOptions={voiceOptions} />
      </>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={({ route }) => ({
            headerShown: false,
            tabBarActiveTintColor:   '#667eea',
            tabBarInactiveTintColor: '#999',
            tabBarLabelStyle: { fontSize: 16, fontWeight: '600' },
            tabBarStyle: { backgroundColor: '#fff', height: 85, paddingBottom: 12, paddingTop: 12 },
            tabBarIcon: () => {
              if (route.name === 'Home')        return <Text style={styles.tabBarEmoji}>🏠</Text>;
              if (route.name === 'Medications') return <Text style={styles.tabBarEmoji}>💊</Text>;
              if (route.name === 'Insights')    return <Text style={styles.tabBarEmoji}>📊</Text>;
              if (route.name === 'Voice')       return <Text style={styles.tabBarEmoji}>🎤</Text>;
              return null;
            },
          })}
        >
          <Tab.Screen name="Home" listeners={{ tabPress: () => speakText('Home', voiceOptions) }}>
            {(props) => (
              <HomeScreen
                {...props}
                voiceOptions={voiceOptions}
                medications={medications}
                onRecordDispense={handleRecordDispense}
              />
            )}
          </Tab.Screen>

          <Tab.Screen name="Medications" options={{ tabBarLabel: 'Meds' }} listeners={{ tabPress: () => speakText('Medications', voiceOptions) }}>
            {(props) => (
              <MedicationsScreen
                {...props}
                voiceOptions={voiceOptions}
                medications={medications}
                onSaveMedications={handleSaveMedications}
                userName={userName}
              />
            )}
          </Tab.Screen>

          <Tab.Screen name="Insights" options={{ tabBarLabel: 'Stats' }} listeners={{ tabPress: () => speakText('Insights', voiceOptions) }}>
            {(props) => (
              <InsightsScreen
                {...props}
                voiceOptions={voiceOptions}
                medications={medications}
                dispenseHistory={dispenseHistory}
              />
            )}
          </Tab.Screen>

          <Tab.Screen name="Voice" listeners={{ tabPress: () => speakText('Settings', voiceOptions) }}>
            {(props) => (
              <VoiceSettings
                {...props}
                currentUsername={currentUsername}
                userName={userName}
                onChangeUserName={handleChangeUserName}
                onLogout={handleLogout}
                selectedProfileId={selectedProfileId}
                onSelectProfile={handleSelectProfile}
              />
            )}
          </Tab.Screen>
        </Tab.Navigator>
      </NavigationContainer>
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  actionButton:             { backgroundColor: '#f0f0f0', borderRadius: 12, marginBottom: 12, padding: 18 },
  actionButtonText:         { color: '#333', fontSize: 18, fontWeight: 'bold' },
  addButton:                { alignItems: 'center', backgroundColor: '#4CAF50', borderRadius: 16, marginHorizontal: 20, marginTop: 10, padding: 20 },
  addButtonText:            { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  authButton:               { alignItems: 'center', backgroundColor: '#667eea', borderRadius: 14, padding: 18 },
  authButtonText:           { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  authCard:                 { backgroundColor: 'rgba(255,255,255,0.97)', borderRadius: 24, marginHorizontal: 20, padding: 24 },
  authLogo:                 { width: 180, height: 180, resizeMode: 'contain', marginBottom: 16 },
  authHero:                 { alignItems: 'center', marginBottom: 28, marginTop: 40, paddingHorizontal: 20 },
  authLabel:                { color: '#444', fontSize: 16, fontWeight: '700', marginBottom: 8 },
  authScrollContent:        { flexGrow: 1, justifyContent: 'center', paddingBottom: 40 },
  authSubtitle:             { color: 'rgba(255,255,255,0.92)', fontSize: 18, lineHeight: 26, textAlign: 'center' },
  authTab:                  { alignItems: 'center', borderRadius: 12, flex: 1, paddingVertical: 12 },
  authTabActive:            { backgroundColor: '#edf2ff' },
  authTabs:                 { backgroundColor: '#f4f5fb', borderRadius: 16, flexDirection: 'row', marginBottom: 22, padding: 6 },
  authTabText:              { color: '#6b6b7a', fontSize: 16, fontWeight: '700' },
  authTabTextActive:        { color: '#4458d6' },
  authTitle:                { color: '#fff', fontSize: 34, fontWeight: 'bold', marginBottom: 10 },
  cancelButton:             { backgroundColor: '#f0f0f0' },
  cancelButtonText:         { color: '#666', fontSize: 18, fontWeight: 'bold' },
  card:                     { backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 20, marginBottom: 20, marginHorizontal: 20, padding: 25 },
  cardEmoji:                { fontSize: 48 },
  cardTitle:                { color: '#333', fontSize: 22, fontWeight: 'bold', marginBottom: 15 },
  clock:                    { color: '#fff', fontSize: 92, fontWeight: 'bold', textAlign: 'center' },
  container:                { flex: 1 },
  deleteButton:             { alignItems: 'center', justifyContent: 'center', padding: 12 },
  deleteButtonText:         { fontSize: 24 },
  formButton:               { alignItems: 'center', borderRadius: 12, flex: 1, padding: 16 },
  formButtons:              { flexDirection: 'row', gap: 10 },
  formCard:                 { backgroundColor: 'rgba(255,255,255,0.97)', borderRadius: 16, marginHorizontal: 20, marginTop: 10, padding: 25 },
  formTitle:                { color: '#333', fontSize: 22, fontWeight: 'bold', marginBottom: 20 },
  greeting:                 { color: '#fff', fontSize: 32, fontWeight: 'bold', marginBottom: 10 },
  header:                   { paddingBottom: 30, paddingHorizontal: 20, paddingTop: 60 },
  heroEmoji:                { fontSize: 64 },
  input:                    { backgroundColor: '#f5f5f5', borderRadius: 12, color: '#333', fontSize: 18, marginBottom: 15, padding: 16 },
  loadingScreen:            { alignItems: 'center', flex: 1, justifyContent: 'center' },
  loadingText:              { color: '#fff', fontSize: 22, fontWeight: '700' },
  logoutButton:             { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.24)', borderColor: 'rgba(255,255,255,0.5)', borderRadius: 16, borderWidth: 1, marginHorizontal: 20, padding: 18 },
  logoutButtonText:         { color: '#fff', fontSize: 18, fontWeight: '700' },
  medCard:                  { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 16, flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15, marginHorizontal: 20, padding: 20 },
  medCardContent:           { alignItems: 'center', flex: 1, flexDirection: 'row' },
  medDosage:                { color: '#888', fontSize: 15, marginTop: 2 },
  medIcon:                  { marginRight: 20 },
  medIconSmall:             { marginRight: 15 },
  medInfo:                  { flex: 1 },
  medName:                  { color: '#333', fontSize: 20, fontWeight: 'bold', marginBottom: 5 },
  medicationCard:           { alignItems: 'center', flexDirection: 'row', marginBottom: 20 },
  medicationsScrollContent: { paddingBottom: 180 },
  medSlot:                  { color: '#999', fontSize: 14 },
  medTime:                  { color: '#666', fontSize: 16 },
  modalOverlay:             { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.35)', flex: 1, justifyContent: 'flex-end', padding: 16 },
  motivationCard:           { backgroundColor: 'rgba(255,255,255,0.95)', borderLeftColor: '#4CAF50', borderLeftWidth: 4, borderRadius: 20, marginBottom: 20, marginHorizontal: 20, padding: 25 },
  motivationText:           { color: '#333', fontSize: 20, fontWeight: '600', textAlign: 'center' },
  nameInput:                { backgroundColor: '#f5f5f5', borderRadius: 12, color: '#333', flex: 1, fontSize: 18, padding: 16 },
  nameInputContainer:       { alignItems: 'center', flexDirection: 'row', gap: 10 },
  previewText:              { color: '#666', fontSize: 16, fontStyle: 'italic', marginTop: 12 },
  progressCard:             { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 20, marginBottom: 20, marginHorizontal: 20, padding: 30 },
  progressCircle:           { alignItems: 'center', backgroundColor: '#4CAF50', borderRadius: 100, height: 200, justifyContent: 'center', marginBottom: 20, width: 200 },
  progressLabel:            { color: '#fff', fontSize: 20, marginTop: 5 },
  progressPercent:          { color: '#fff', fontSize: 64, fontWeight: 'bold' },
  progressText:             { color: '#666', fontSize: 18, lineHeight: 26, textAlign: 'center' },
  saveButton:               { backgroundColor: '#4CAF50', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 16 },
  saveButtonText:           { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  scrollView:               { flex: 1 },
  section:                  { backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 20, marginBottom: 20, marginHorizontal: 20, padding: 20 },
  sectionSubtitle:          { color: '#666', fontSize: 16, marginBottom: 20 },
  sectionTitle:             { color: '#333', fontSize: 24, fontWeight: 'bold', marginBottom: 8 },
  spacer:                   { height: 40 },
  statCard:                 { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 16, flex: 1, minWidth: '45%', padding: 20 },
  statLabel:                { color: '#666', fontSize: 16 },
  statNumber:               { color: '#667eea', fontSize: 36, fontWeight: 'bold', marginBottom: 5 },
  statsGrid:                { flexDirection: 'row', flexWrap: 'wrap', gap: 15, marginBottom: 20, marginHorizontal: 20 },
  streakCard:               { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 20, marginBottom: 20, marginHorizontal: 20, padding: 30 },
  streakEmoji:              { fontSize: 60, marginBottom: 10 },
  streakLabel:              { color: '#666', fontSize: 24, marginBottom: 15 },
  streakNumber:             { color: '#FF6B6B', fontSize: 72, fontWeight: 'bold' },
  streakSubtext:            { color: '#666', fontSize: 18, textAlign: 'center' },
  streakText:               { color: '#FF6B6B', fontSize: 32, fontWeight: 'bold', marginBottom: 10, textAlign: 'center' },
  subtitle:                 { color: 'rgba(255,255,255,0.9)', fontSize: 18 },
  tabBarEmoji:              { fontSize: 28 },
  takeButton:               { alignItems: 'center', backgroundColor: '#4CAF50', borderRadius: 12, padding: 18 },
  takeButtonDisabled:       { backgroundColor: '#95d5b2', opacity: 0.6 },
  takeButtonText:           { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  testButton:               { borderRadius: 20, marginBottom: 20, marginHorizontal: 20, overflow: 'hidden' },
  testButtonGradient:       { alignItems: 'center', paddingVertical: 20 },
  testButtonText:           { color: '#fff', fontSize: 22, fontWeight: 'bold' },
  timeColumn:               { flex: 1, maxHeight: 240 },
  timeColumnContent:        { paddingBottom: 12, paddingTop: 12 },
  timeOption:               { alignItems: 'center', borderRadius: 14, marginBottom: 8, paddingVertical: 14 },
  timeOptionSelected:       { backgroundColor: '#edf2ff' },
  timeOptionText:           { color: '#6b6b7a', fontSize: 24, fontWeight: '600' },
  timeOptionTextSelected:   { color: '#4458d6', fontWeight: '800' },
  timePickerButton:         { alignItems: 'center', backgroundColor: '#f5f5f5', borderRadius: 16, marginBottom: 18, padding: 18 },
  timePickerButtonText:     { color: '#333', fontSize: 24, fontWeight: '700' },
  timePickerCancel:         { color: '#889', fontSize: 16, fontWeight: '600' },
  timePickerCard:           { backgroundColor: '#fff', borderRadius: 28, paddingBottom: 20, paddingHorizontal: 18, paddingTop: 12, width: '100%' },
  timePickerDone:           { color: '#4458d6', fontSize: 16, fontWeight: '700' },
  timePickerHeader:         { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  timePickerLabel:          { color: '#444', fontSize: 16, fontWeight: '700', marginBottom: 10 },
  timePickerPreview:        { color: '#222', fontSize: 30, fontWeight: '800', marginBottom: 18, textAlign: 'center' },
  timePickerTitle:          { color: '#333', fontSize: 17, fontWeight: '700' },
  timePickerWheels:         { backgroundColor: '#f7f8fd', borderRadius: 22, flexDirection: 'row', gap: 12, padding: 12 },
  title:                    { color: '#fff', fontSize: 36, fontWeight: 'bold', marginBottom: 8 },
  voiceOption:              { backgroundColor: '#f7f7fb', borderColor: '#d8def8', borderRadius: 16, borderWidth: 1, marginBottom: 12, padding: 16 },
  voiceOptionHeader:        { marginBottom: 8 },
  voiceOptionMeta:          { color: '#7a7a90', fontSize: 13 },
  voiceOptionSelected:      { backgroundColor: '#edf2ff', borderColor: '#667eea' },
  voiceOptionText:          { color: '#555', fontSize: 15, lineHeight: 22 },
  voiceOptionTitle:         { color: '#333', fontSize: 18, fontWeight: 'bold', marginBottom: 4 },
});
