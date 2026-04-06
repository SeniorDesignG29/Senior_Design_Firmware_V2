import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
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
import * as FileSystem from 'expo-file-system';
import { Audio } from 'expo-av';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { LinearGradient } from 'expo-linear-gradient';

const Tab = createBottomTabNavigator();
const ELEVENLABS_API_KEY = process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY ?? '';
const DEFAULT_USER_NAME = 'Space Cowboy';
const STORAGE_FILE_PATH = `${FileSystem.documentDirectory}medication-app-data.json`;
const DEFAULT_TIME_VALUE = '08:00 AM';
const DEFAULT_USER_MEDICATIONS = [
  { id: 1, name: 'Oompa lompa Medicine', time: '08:00 AM', slot: 1 },
  { id: 2, name: 'Blood Pressure Medication', time: '10:00 AM', slot: 2 },
  { id: 3, name: 'Heart Medication', time: '12:00 PM', slot: 3 },
];
const VOICE_PROFILES = [
  {
    id: 'guide',
    label: 'Calm Guide',
    voiceId: 'hpp4J3VqNfWAUOO0d1Us',
    personality: 'a calm, clear medication coach who speaks with warmth, patience, and simple reassuring language',
  },
  {
    id: 'cheer',
    label: 'Bright Cheer',
    voiceId: 'SAz9YHcvj6GT2YYXdXww',
    personality: 'an upbeat encourager who sounds positive, energizing, and celebratory without being too loud',
  },
  {
    id: 'companion',
    label: 'Gentle Companion',
    voiceId: 'pFZP5JQG7iQjIQuC4Bku',
    personality: 'a kind supportive companion who sounds caring, steady, and thoughtful during reminders',
  },
  {
    id: 'coach',
    label: 'Focused Coach',
    voiceId: 'nPczCjzI2devNBz1zQrb',
    personality: 'a confident health coach who sounds direct, motivating, and encouraging for daily routines',
  },
];
const DEFAULT_VOICE_PROFILE_ID = VOICE_PROFILES[0].id;
const HOURS = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'));
const PERIODS = ['AM', 'PM'];

let activeSound = null;

function createDefaultUserRecord(username, password) {
  return {
    password,
    preferences: {
      selectedProfileId: DEFAULT_VOICE_PROFILE_ID,
      userName: username || DEFAULT_USER_NAME,
    },
    medications: DEFAULT_USER_MEDICATIONS.map((medication) => ({ ...medication })),
  };
}

function getDefaultStorage() {
  return {
    users: {},
  };
}

async function ensureStorageFile() {
  const fileInfo = await FileSystem.getInfoAsync(STORAGE_FILE_PATH);

  if (!fileInfo.exists) {
    await FileSystem.writeAsStringAsync(
      STORAGE_FILE_PATH,
      JSON.stringify(getDefaultStorage()),
      { encoding: FileSystem.EncodingType.UTF8 }
    );
  }
}

async function readStorage() {
  try {
    await ensureStorageFile();
    const raw = await FileSystem.readAsStringAsync(STORAGE_FILE_PATH, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    return raw ? JSON.parse(raw) : getDefaultStorage();
  } catch (error) {
    return getDefaultStorage();
  }
}

async function writeStorage(data) {
  await FileSystem.writeAsStringAsync(STORAGE_FILE_PATH, JSON.stringify(data), {
    encoding: FileSystem.EncodingType.UTF8,
  });
}

function getGreetingForHour(date) {
  const hour = date.getHours();

  if (hour < 12) return 'Good Morning';
  if (hour < 18) return 'Good Afternoon';
  return 'Good Evening';
}

function getVoiceProfile(profileId) {
  return VOICE_PROFILES.find((profile) => profile.id === profileId) ?? VOICE_PROFILES[0];
}

function formatTimeFromParts(hours, minutes, period) {
  return `${hours}:${minutes} ${period}`;
}

function parseTimeValue(timeValue = DEFAULT_TIME_VALUE) {
  const [timePart = '08:00', period = 'AM'] = timeValue.split(' ');
  const [hours = '08', minutes = '00'] = timePart.split(':');

  return {
    hours: hours.padStart(2, '0'),
    minutes: minutes.padStart(2, '0'),
    period: period === 'PM' ? 'PM' : 'AM',
  };
}

function toDateFromTimeValue(timeValue) {
  const { hours, minutes, period } = parseTimeValue(timeValue);
  const date = new Date();
  let hourValue = Number(hours) % 12;

  if (period === 'PM') {
    hourValue += 12;
  }

  date.setHours(hourValue, Number(minutes), 0, 0);
  return date;
}

function getNextMedication(medications) {
  if (!medications.length) {
    return null;
  }

  const now = new Date();
  const sorted = [...medications]
    .map((medication) => {
      const nextTime = toDateFromTimeValue(medication.time);

      if (nextTime < now) {
        nextTime.setDate(nextTime.getDate() + 1);
      }

      return { ...medication, nextTime };
    })
    .sort((left, right) => left.nextTime - right.nextTime);

  return sorted[0];
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onloadend = () => {
      const result = reader.result;
      const prefixIndex = typeof result === 'string' ? result.indexOf('base64,') : -1;

      if (prefixIndex === -1) {
        reject(new Error('Unable to convert audio to base64.'));
        return;
      }

      resolve(result.slice(prefixIndex + 7));
    };

    reader.onerror = () => reject(new Error('Unable to read audio response.'));
    reader.readAsDataURL(blob);
  });
}

async function createPlayableAudioFile(audioBlob) {
  const base64Audio = await blobToBase64(audioBlob);
  const audioFilePath = `${FileSystem.cacheDirectory}voice-preview-${Date.now()}.mp3`;

  await FileSystem.writeAsStringAsync(audioFilePath, base64Audio, { encoding: 'base64' });
  return audioFilePath;
}

function buildVoicePrompt(message, userName, profile) {
  return `You are ${profile.label}. You are ${profile.personality}. Speak naturally in one or two short sentences. User name: ${userName}. Message: ${message}`;
}

async function stopActiveSound() {
  if (!activeSound) return;

  const soundToStop = activeSound;
  activeSound = null;
  await soundToStop.unloadAsync().catch(() => {});
}

async function speakText(message, options = {}) {
  const { profileId = DEFAULT_VOICE_PROFILE_ID, userName = DEFAULT_USER_NAME } = options;
  const profile = getVoiceProfile(profileId);

  if (!ELEVENLABS_API_KEY) {
    Alert.alert('Missing API Key', 'Set EXPO_PUBLIC_ELEVENLABS_API_KEY before testing voice playback.');
    return;
  }

  try {
    const response = await fetch('https://api.elevenlabs.io/v1/text-to-speech/11labs-voice-id', {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model_id: 'eleven_turbo_v2_5',
        text: buildVoicePrompt(message, userName, profile),
      }),
    });

    if (!response.ok) throw new Error(`API error: ${response.status}`);

    const blob = await response.blob();
    const audioFilePath = await createPlayableAudioFile(blob);

    await stopActiveSound();

    const sound = new Audio.Sound();
    await sound.loadAsync({ uri: audioFilePath });

    sound.setOnPlaybackStatusUpdate((status) => {
      if (!status.isLoaded || !status.didJustFinish) return;
      if (activeSound === sound) activeSound = null;
      sound.unloadAsync().catch(() => {});
      FileSystem.deleteAsync(audioFilePath, { idempotent: true }).catch(() => {});
    });

    activeSound = sound;
    await sound.playAsync();
  } catch (error) {
    if (activeSound) activeSound.unloadAsync().catch(() => {});
    Alert.alert('Voice Error', error.message);
  }
}

function handlePressWithVoice(action, message, voiceOptions) {
  speakText(message, voiceOptions);
  action?.();
}

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

function TimePickerModal({ visible, value, onCancel, onConfirm }) {
  const parsed = parseTimeValue(value);
  const [selectedHours, setSelectedHours] = useState(parsed.hours);
  const [selectedMinutes, setSelectedMinutes] = useState(parsed.minutes);
  const [selectedPeriod, setSelectedPeriod] = useState(parsed.period);

  useEffect(() => {
    const nextParts = parseTimeValue(value);
    setSelectedHours(nextParts.hours);
    setSelectedMinutes(nextParts.minutes);
    setSelectedPeriod(nextParts.period);
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
              onPress={() =>
                onConfirm(formatTimeFromParts(selectedHours, selectedMinutes, selectedPeriod))
              }
            >
              <Text style={styles.timePickerDone}>Done</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.timePickerPreview}>
            {formatTimeFromParts(selectedHours, selectedMinutes, selectedPeriod)}
          </Text>

          <View style={styles.timePickerWheels}>
            <TimeWheelColumn
              items={HOURS}
              selectedValue={selectedHours}
              onSelect={setSelectedHours}
            />
            <TimeWheelColumn
              items={MINUTES}
              selectedValue={selectedMinutes}
              onSelect={setSelectedMinutes}
            />
            <TimeWheelColumn
              items={PERIODS}
              selectedValue={selectedPeriod}
              onSelect={setSelectedPeriod}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function AuthScreen({ onLogin, onRegister, voiceOptions }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = () => {
    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();

    if (!trimmedUsername || !trimmedPassword) {
      Alert.alert('Missing Details', 'Enter both a username and password.');
      speakText('Please enter both a username and password.', voiceOptions);
      return;
    }

    if (mode === 'login') {
      onLogin(trimmedUsername, trimmedPassword);
      return;
    }

    onRegister(trimmedUsername, trimmedPassword);
  };

  return (
    <LinearGradient colors={['#667eea', '#764ba2', '#f093fb']} style={styles.container}>
      <ScreenContainer keyboardOffset={60}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.authScrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.authHero}>
            <Text style={styles.authEmoji}>💊</Text>
            <Text style={styles.authTitle}>Medication Companion</Text>
            <Text style={styles.authSubtitle}>
              Log in to keep each medication schedule private to its own user.
            </Text>
          </View>

          <View style={styles.authCard}>
            <View style={styles.authTabs}>
              <TouchableOpacity
                style={[styles.authTab, mode === 'login' && styles.authTabActive]}
                onPress={() => setMode('login')}
              >
                <Text style={[styles.authTabText, mode === 'login' && styles.authTabTextActive]}>
                  Log In
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.authTab, mode === 'register' && styles.authTabActive]}
                onPress={() => setMode('register')}
              >
                <Text
                  style={[styles.authTabText, mode === 'register' && styles.authTabTextActive]}
                >
                  Sign Up
                </Text>
              </TouchableOpacity>
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
  );
}

function HomeScreen({ navigation, voiceOptions, medications }) {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const nextMedication = useMemo(() => getNextMedication(medications), [medications]);

  const formatTime = (date) => {
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const period = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${hours}:${minutes} ${period}`;
  };

  return (
    <LinearGradient colors={['#667eea', '#764ba2', '#f093fb']} style={styles.container}>
      <ScreenContainer>
        <ScrollView
          style={styles.scrollView}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Text style={styles.greeting}>
              {getGreetingForHour(currentTime)}, {voiceOptions.userName}!
            </Text>
            <Text style={styles.clock}>{formatTime(currentTime)}</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Next Medication</Text>
            <View style={styles.medicationCard}>
              <View style={styles.medIcon}>
                <Text style={styles.heroEmoji}>💊</Text>
              </View>
              <View style={styles.medInfo}>
                <Text style={styles.medName}>
                  {nextMedication ? nextMedication.name : 'No medications yet'}
                </Text>
                <Text style={styles.medTime}>
                  {nextMedication ? nextMedication.time : 'Add your first reminder'}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.takeButton}
              onPress={() =>
                handlePressWithVoice(
                  null,
                  nextMedication
                    ? `Time for ${nextMedication.name}, ${voiceOptions.userName}.`
                    : 'You do not have a medication scheduled yet.',
                  voiceOptions
                )
              }
            >
              <Text style={styles.takeButtonText}>
                {nextMedication ? 'Take Now' : 'Add a Medication'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.card}>
            <Text style={styles.streakText}>🔥 5 Day Streak!</Text>
            <Text style={styles.streakSubtext}>Keep up the great work!</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Quick Actions</Text>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() =>
                handlePressWithVoice(
                  () => navigation.navigate('Medications'),
                  'Opening your medications.',
                  voiceOptions
                )
              }
            >
              <Text style={styles.actionButtonText}>💊 View Medications</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() =>
                handlePressWithVoice(
                  () => navigation.navigate('Insights'),
                  'Opening your progress insights.',
                  voiceOptions
                )
              }
            >
              <Text style={styles.actionButtonText}>📊 View Progress</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </ScreenContainer>
    </LinearGradient>
  );
}

function MedicationsScreen({ voiceOptions, medications, onSaveMedications }) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newMedName, setNewMedName] = useState('');
  const [newMedTime, setNewMedTime] = useState(DEFAULT_TIME_VALUE);
  const [isTimePickerVisible, setIsTimePickerVisible] = useState(false);

  const handleAddMedication = () => {
    const trimmedName = newMedName.trim();

    if (!trimmedName || !newMedTime) {
      Alert.alert('Missing Details', 'Enter both a medication name and time.');
      speakText('Please enter name and time.', voiceOptions);
      return;
    }

    const nextMedication = {
      id: Date.now(),
      name: trimmedName,
      time: newMedTime,
      slot: medications.length + 1,
    };

    onSaveMedications([...medications, nextMedication]);
    setNewMedName('');
    setNewMedTime(DEFAULT_TIME_VALUE);
    setShowAddForm(false);
    Alert.alert('Success', 'Medication added!');
    speakText(`Added ${trimmedName} for ${newMedTime}.`, voiceOptions);
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
            <TouchableOpacity
              key={med.id}
              style={styles.medCard}
              onPress={() =>
                handlePressWithVoice(
                  null,
                  `${med.name}, scheduled for ${med.time}, slot ${med.slot}.`,
                  voiceOptions
                )
              }
            >
              <View style={styles.medIconSmall}>
                <Text style={styles.cardEmoji}>💊</Text>
              </View>
              <View style={styles.medInfo}>
                <Text style={styles.medName}>{med.name}</Text>
                <Text style={styles.medTime}>⏰ {med.time}</Text>
                <Text style={styles.medSlot}>Slot {med.slot}</Text>
              </View>
            </TouchableOpacity>
          ))}

          {!showAddForm && (
            <TouchableOpacity
              style={styles.addButton}
              onPress={() =>
                handlePressWithVoice(
                  () => setShowAddForm(true),
                  'Opening the add medication form.',
                  voiceOptions
                )
              }
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
                returnKeyType="done"
              />
              <Text style={styles.timePickerLabel}>Medication Time</Text>
              <TouchableOpacity
                style={styles.timePickerButton}
                onPress={() => {
                  Keyboard.dismiss();
                  setIsTimePickerVisible(true);
                }}
              >
                <Text style={styles.timePickerButtonText}>{newMedTime}</Text>
              </TouchableOpacity>
              <View style={styles.formButtons}>
                <TouchableOpacity
                  style={[styles.formButton, styles.cancelButton]}
                  onPress={() =>
                    handlePressWithVoice(
                      () => setShowAddForm(false),
                      'Cancelled.',
                      voiceOptions
                    )
                  }
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.formButton, styles.saveButton]}
                  onPress={handleAddMedication}
                >
                  <Text style={styles.saveButtonText}>Save</Text>
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
        onCancel={() => setIsTimePickerVisible(false)}
        onConfirm={(timeValue) => {
          setNewMedTime(timeValue);
          setIsTimePickerVisible(false);
          speakText(`Time set to ${timeValue}.`, voiceOptions);
        }}
      />
    </LinearGradient>
  );
}

function InsightsScreen({ voiceOptions, medications }) {
  const adherence = 85;
  const streak = 5;
  const totalTaken = Math.max(0, medications.length * 5);
  const totalScheduled = Math.max(totalTaken + 3, medications.length * 6);

  return (
    <LinearGradient colors={['#667eea', '#764ba2', '#f093fb']} style={styles.container}>
      <ScreenContainer>
        <ScrollView
          style={styles.scrollView}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Text style={styles.title}>📊 Insights</Text>
            <Text style={styles.subtitle}>Track your progress</Text>
          </View>

          <TouchableOpacity
            style={styles.progressCard}
            onPress={() =>
              handlePressWithVoice(
                null,
                `${adherence} percent adherence. ${totalTaken} of ${totalScheduled} taken this week.`,
                voiceOptions
              )
            }
          >
            <View style={styles.progressCircle}>
              <Text style={styles.progressPercent}>{adherence}%</Text>
              <Text style={styles.progressLabel}>Adherence</Text>
            </View>
            <Text style={styles.progressText}>
              You've taken {totalTaken} out of {totalScheduled} medications this week!
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.badgeCard}
            onPress={() => handlePressWithVoice(null, 'Star badge earned.', voiceOptions)}
          >
            <Text style={styles.heroEmoji}>⭐</Text>
            <Text style={styles.badgeName}>Star</Text>
            <Text style={styles.badgeMessage}>Keep up the great work!</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.streakCard}
            onPress={() => handlePressWithVoice(null, `${streak} day streak.`, voiceOptions)}
          >
            <Text style={styles.streakEmoji}>🔥</Text>
            <Text style={styles.streakNumber}>{streak}</Text>
            <Text style={styles.streakLabel}>Day Streak</Text>
          </TouchableOpacity>

          <View style={styles.statsGrid}>
            <TouchableOpacity
              style={styles.statCard}
              onPress={() => handlePressWithVoice(null, `${totalTaken} taken.`, voiceOptions)}
            >
              <Text style={styles.statNumber}>{totalTaken}</Text>
              <Text style={styles.statLabel}>Taken</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.statCard}
              onPress={() =>
                handlePressWithVoice(null, `${totalScheduled - totalTaken} missed.`, voiceOptions)
              }
            >
              <Text style={styles.statNumber}>{totalScheduled - totalTaken}</Text>
              <Text style={styles.statLabel}>Missed</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.statCard}
              onPress={() => handlePressWithVoice(null, `${streak} day streak.`, voiceOptions)}
            >
              <Text style={styles.statNumber}>{streak}</Text>
              <Text style={styles.statLabel}>Streak</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.statCard}
              onPress={() => handlePressWithVoice(null, `${adherence} percent score.`, voiceOptions)}
            >
              <Text style={styles.statNumber}>{adherence}%</Text>
              <Text style={styles.statLabel}>Score</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.motivationCard}
            onPress={() =>
              handlePressWithVoice(null, `Amazing progress, ${voiceOptions.userName}.`, voiceOptions)
            }
          >
            <Text style={styles.motivationText}>💪 Amazing progress! You're doing great!</Text>
          </TouchableOpacity>

          <View style={styles.spacer} />
        </ScrollView>
      </ScreenContainer>
    </LinearGradient>
  );
}

function VoiceSettings({
  currentUsername,
  userName,
  onChangeUserName,
  onLogout,
  selectedProfileId,
  onSelectProfile,
}) {
  const [draftName, setDraftName] = useState(userName);
  const [isTesting, setIsTesting] = useState(false);
  const activeProfile = getVoiceProfile(selectedProfileId);

  const handleSaveName = () => {
    const nextName = draftName.trim() || DEFAULT_USER_NAME;
    onChangeUserName(nextName);
    Alert.alert('Saved', `Your voice assistant will call you ${nextName}.`);
    speakText(`I'll call you ${nextName}.`, {
      profileId: selectedProfileId,
      userName: nextName,
    });
  };

  const handleTestVoice = async () => {
    setIsTesting(true);
    await speakText(`Hi ${userName}. This is your ${activeProfile.label} voice.`, {
      profileId: selectedProfileId,
      userName,
    });
    setIsTesting(false);
  };

  return (
    <LinearGradient colors={['#667eea', '#764ba2', '#f093fb']} style={styles.container}>
      <ScreenContainer keyboardOffset={100}>
        <ScrollView
          style={styles.scrollView}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Text style={styles.title}>🎤 Voice Settings</Text>
            <Text style={styles.subtitle}>Signed in as {currentUsername}</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>👤 Your Name</Text>
            <Text style={styles.sectionSubtitle}>
              Your assistant will use this name for reminders.
            </Text>
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
                    speakText(`${profile.label}`, { profileId: profile.id, userName });
                  }}
                >
                  <View style={styles.voiceOptionHeader}>
                    <Text style={styles.voiceOptionTitle}>
                      {isSelected ? '✅ ' : ''}
                      {profile.label}
                    </Text>
                    <Text style={styles.voiceOptionMeta}>Voice ID: {profile.voiceId}</Text>
                  </View>
                  <Text style={styles.voiceOptionText}>{profile.personality}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            style={styles.testButton}
            onPress={handleTestVoice}
            disabled={isTesting}
          >
            <LinearGradient colors={['#4CAF50', '#45a049']} style={styles.testButtonGradient}>
              <Text style={styles.testButtonText}>
                {isTesting ? '🎤 Testing...' : '🎤 Test Voice'}
              </Text>
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

export default function App() {
  const [storage, setStorage] = useState(getDefaultStorage());
  const [currentUsername, setCurrentUsername] = useState(null);
  const [isBooting, setIsBooting] = useState(true);

  useEffect(() => {
    const loadStorage = async () => {
      const nextStorage = await readStorage();
      setStorage(nextStorage);
      setIsBooting(false);
    };

    loadStorage();
  }, []);

  const currentUserRecord = currentUsername ? storage.users[currentUsername] : null;
  const userName = currentUserRecord?.preferences?.userName ?? DEFAULT_USER_NAME;
  const selectedProfileId =
    currentUserRecord?.preferences?.selectedProfileId ?? DEFAULT_VOICE_PROFILE_ID;
  const medications = currentUserRecord?.medications ?? [];
  const voiceOptions = { profileId: selectedProfileId, userName };

  const updateStorage = async (updater) => {
    const nextStorage = updater(storage);
    setStorage(nextStorage);
    await writeStorage(nextStorage);
  };

  const handleRegister = async (username, password) => {
    if (storage.users[username]) {
      Alert.alert('Account Exists', 'That username already exists.');
      speakText('That username is already taken.', voiceOptions);
      return;
    }

    await updateStorage((current) => ({
      ...current,
      users: {
        ...current.users,
        [username]: createDefaultUserRecord(username, password),
      },
    }));

    setCurrentUsername(username);
    Alert.alert('Welcome', 'Your account has been created.');
  };

  const handleLogin = (username, password) => {
    const matchedUser = storage.users[username];

    if (!matchedUser || matchedUser.password !== password) {
      Alert.alert('Login Failed', 'Incorrect username or password.');
      speakText('Login failed. Please check your username and password.', voiceOptions);
      return;
    }

    setCurrentUsername(username);
  };

  const handleLogout = () => {
    setCurrentUsername(null);
  };

  const handleSaveMedications = async (nextMedications) => {
    if (!currentUsername) return;

    await updateStorage((current) => ({
      ...current,
      users: {
        ...current.users,
        [currentUsername]: {
          ...current.users[currentUsername],
          medications: nextMedications.map((medication, index) => ({
            ...medication,
            slot: index + 1,
          })),
        },
      },
    }));
  };

  const handleChangeUserName = async (nextName) => {
    if (!currentUsername) return;

    await updateStorage((current) => ({
      ...current,
      users: {
        ...current.users,
        [currentUsername]: {
          ...current.users[currentUsername],
          preferences: {
            ...current.users[currentUsername].preferences,
            userName: nextName,
          },
        },
      },
    }));
  };

  const handleSelectProfile = async (profileId) => {
    if (!currentUsername) return;

    await updateStorage((current) => ({
      ...current,
      users: {
        ...current.users,
        [currentUsername]: {
          ...current.users[currentUsername],
          preferences: {
            ...current.users[currentUsername].preferences,
            selectedProfileId: profileId,
          },
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
        <AuthScreen
          onLogin={handleLogin}
          onRegister={handleRegister}
          voiceOptions={voiceOptions}
        />
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
            tabBarActiveTintColor: '#667eea',
            tabBarInactiveTintColor: '#999',
            tabBarLabelStyle: { fontSize: 16, fontWeight: '600' },
            tabBarStyle: {
              backgroundColor: '#fff',
              height: 85,
              paddingBottom: 12,
              paddingTop: 12,
            },
            tabBarIcon: () => {
              if (route.name === 'Home') return <Text style={styles.tabBarEmoji}>🏠</Text>;
              if (route.name === 'Medications') return <Text style={styles.tabBarEmoji}>💊</Text>;
              if (route.name === 'Insights') return <Text style={styles.tabBarEmoji}>📊</Text>;
              if (route.name === 'Voice') return <Text style={styles.tabBarEmoji}>🎤</Text>;
              return null;
            },
          })}
        >
          <Tab.Screen
            name="Home"
            listeners={{ tabPress: () => speakText('Home', voiceOptions) }}
          >
            {(props) => (
              <HomeScreen {...props} voiceOptions={voiceOptions} medications={medications} />
            )}
          </Tab.Screen>
          <Tab.Screen
            name="Medications"
            options={{ tabBarLabel: 'Meds' }}
            listeners={{ tabPress: () => speakText('Medications', voiceOptions) }}
          >
            {(props) => (
              <MedicationsScreen
                {...props}
                voiceOptions={voiceOptions}
                medications={medications}
                onSaveMedications={handleSaveMedications}
              />
            )}
          </Tab.Screen>
          <Tab.Screen
            name="Insights"
            options={{ tabBarLabel: 'Stats' }}
            listeners={{ tabPress: () => speakText('Insights', voiceOptions) }}
          >
            {(props) => (
              <InsightsScreen {...props} voiceOptions={voiceOptions} medications={medications} />
            )}
          </Tab.Screen>
          <Tab.Screen
            name="Voice"
            listeners={{ tabPress: () => speakText('Voice settings', voiceOptions) }}
          >
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

const styles = StyleSheet.create({
  actionButton: {
    backgroundColor: '#f0f0f0',
    borderRadius: 12,
    marginBottom: 12,
    padding: 18,
  },
  actionButtonText: {
    color: '#333',
    fontSize: 18,
    fontWeight: 'bold',
  },
  addButton: {
    alignItems: 'center',
    backgroundColor: '#4CAF50',
    borderRadius: 16,
    marginHorizontal: 20,
    marginTop: 10,
    padding: 20,
  },
  addButtonText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  authButton: {
    alignItems: 'center',
    backgroundColor: '#667eea',
    borderRadius: 14,
    padding: 18,
  },
  authButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  authCard: {
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderRadius: 24,
    marginHorizontal: 20,
    padding: 24,
  },
  authEmoji: {
    fontSize: 72,
    marginBottom: 16,
  },
  authHero: {
    alignItems: 'center',
    marginBottom: 28,
    marginTop: 40,
    paddingHorizontal: 20,
  },
  authLabel: {
    color: '#444',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  authScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingBottom: 40,
  },
  authSubtitle: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 18,
    lineHeight: 26,
    textAlign: 'center',
  },
  authTab: {
    alignItems: 'center',
    borderRadius: 12,
    flex: 1,
    paddingVertical: 12,
  },
  authTabActive: {
    backgroundColor: '#edf2ff',
  },
  authTabs: {
    backgroundColor: '#f4f5fb',
    borderRadius: 16,
    flexDirection: 'row',
    marginBottom: 22,
    padding: 6,
  },
  authTabText: {
    color: '#6b6b7a',
    fontSize: 16,
    fontWeight: '700',
  },
  authTabTextActive: {
    color: '#4458d6',
  },
  authTitle: {
    color: '#fff',
    fontSize: 34,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  badgeCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 20,
    marginBottom: 20,
    marginHorizontal: 20,
    padding: 30,
  },
  badgeMessage: {
    color: '#666',
    fontSize: 18,
    textAlign: 'center',
  },
  badgeName: {
    color: '#333',
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  cancelButton: {
    backgroundColor: '#f0f0f0',
  },
  cancelButtonText: {
    color: '#666',
    fontSize: 18,
    fontWeight: 'bold',
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 20,
    marginBottom: 20,
    marginHorizontal: 20,
    padding: 25,
  },
  cardEmoji: {
    fontSize: 48,
  },
  cardTitle: {
    color: '#333',
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 15,
  },
  clock: {
    color: '#fff',
    fontSize: 92,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  container: {
    flex: 1,
  },
  formButton: {
    alignItems: 'center',
    borderRadius: 12,
    flex: 1,
    padding: 16,
  },
  formButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  formCard: {
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderRadius: 16,
    marginHorizontal: 20,
    marginTop: 10,
    padding: 25,
  },
  formTitle: {
    color: '#333',
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  greeting: {
    color: '#fff',
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  header: {
    paddingBottom: 30,
    paddingHorizontal: 20,
    paddingTop: 60,
  },
  heroEmoji: {
    fontSize: 64,
  },
  input: {
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    color: '#333',
    fontSize: 18,
    marginBottom: 15,
    padding: 16,
  },
  loadingScreen: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  loadingText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
  },
  logoutButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.24)',
    borderColor: 'rgba(255,255,255,0.5)',
    borderRadius: 16,
    borderWidth: 1,
    marginHorizontal: 20,
    padding: 18,
  },
  logoutButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  medCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 16,
    flexDirection: 'row',
    marginBottom: 15,
    marginHorizontal: 20,
    padding: 20,
  },
  medIcon: {
    marginRight: 20,
  },
  medIconSmall: {
    marginRight: 15,
  },
  medInfo: {
    flex: 1,
  },
  medName: {
    color: '#333',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  medicationCard: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: 20,
  },
  medicationsScrollContent: {
    paddingBottom: 180,
  },
  medSlot: {
    color: '#999',
    fontSize: 14,
  },
  medTime: {
    color: '#666',
    fontSize: 16,
  },
  modalOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    flex: 1,
    justifyContent: 'flex-end',
    padding: 16,
  },
  motivationCard: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderLeftColor: '#4CAF50',
    borderLeftWidth: 4,
    borderRadius: 20,
    marginBottom: 20,
    marginHorizontal: 20,
    padding: 25,
  },
  motivationText: {
    color: '#333',
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
  },
  nameInput: {
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    color: '#333',
    flex: 1,
    fontSize: 18,
    padding: 16,
  },
  nameInputContainer: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  previewText: {
    color: '#666',
    fontSize: 16,
    fontStyle: 'italic',
    marginTop: 12,
  },
  progressCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 20,
    marginBottom: 20,
    marginHorizontal: 20,
    padding: 30,
  },
  progressCircle: {
    alignItems: 'center',
    backgroundColor: '#4CAF50',
    borderRadius: 100,
    height: 200,
    justifyContent: 'center',
    marginBottom: 20,
    width: 200,
  },
  progressLabel: {
    color: '#fff',
    fontSize: 20,
    marginTop: 5,
  },
  progressPercent: {
    color: '#fff',
    fontSize: 64,
    fontWeight: 'bold',
  },
  progressText: {
    color: '#666',
    fontSize: 18,
    lineHeight: 26,
    textAlign: 'center',
  },
  saveButton: {
    backgroundColor: '#4CAF50',
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  scrollView: {
    flex: 1,
  },
  section: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 20,
    marginBottom: 20,
    marginHorizontal: 20,
    padding: 20,
  },
  sectionSubtitle: {
    color: '#666',
    fontSize: 16,
    marginBottom: 20,
  },
  sectionTitle: {
    color: '#333',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  spacer: {
    height: 40,
  },
  statCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 16,
    flex: 1,
    minWidth: '45%',
    padding: 20,
  },
  statLabel: {
    color: '#666',
    fontSize: 16,
  },
  statNumber: {
    color: '#667eea',
    fontSize: 36,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 15,
    marginBottom: 20,
    marginHorizontal: 20,
  },
  streakCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 20,
    marginBottom: 20,
    marginHorizontal: 20,
    padding: 30,
  },
  streakEmoji: {
    fontSize: 60,
    marginBottom: 10,
  },
  streakLabel: {
    color: '#666',
    fontSize: 24,
    marginBottom: 15,
  },
  streakNumber: {
    color: '#FF6B6B',
    fontSize: 72,
    fontWeight: 'bold',
  },
  streakSubtext: {
    color: '#666',
    fontSize: 18,
    textAlign: 'center',
  },
  streakText: {
    color: '#FF6B6B',
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center',
  },
  subtitle: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 18,
  },
  tabBarEmoji: {
    fontSize: 28,
  },
  takeButton: {
    alignItems: 'center',
    backgroundColor: '#4CAF50',
    borderRadius: 12,
    padding: 18,
  },
  takeButtonText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  testButton: {
    borderRadius: 20,
    marginBottom: 20,
    marginHorizontal: 20,
    overflow: 'hidden',
  },
  testButtonGradient: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  testButtonText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: 'bold',
  },
  timeColumn: {
    flex: 1,
    maxHeight: 240,
  },
  timeColumnContent: {
    paddingBottom: 12,
    paddingTop: 12,
  },
  timeOption: {
    alignItems: 'center',
    borderRadius: 14,
    marginBottom: 8,
    paddingVertical: 14,
  },
  timeOptionSelected: {
    backgroundColor: '#edf2ff',
  },
  timeOptionText: {
    color: '#6b6b7a',
    fontSize: 24,
    fontWeight: '600',
  },
  timeOptionTextSelected: {
    color: '#4458d6',
    fontWeight: '800',
  },
  timePickerButton: {
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 16,
    marginBottom: 18,
    padding: 18,
  },
  timePickerButtonText: {
    color: '#333',
    fontSize: 24,
    fontWeight: '700',
  },
  timePickerCancel: {
    color: '#889',
    fontSize: 16,
    fontWeight: '600',
  },
  timePickerCard: {
    backgroundColor: '#fff',
    borderRadius: 28,
    paddingBottom: 20,
    paddingHorizontal: 18,
    paddingTop: 12,
    width: '100%',
  },
  timePickerDone: {
    color: '#4458d6',
    fontSize: 16,
    fontWeight: '700',
  },
  timePickerHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  timePickerLabel: {
    color: '#444',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
  },
  timePickerPreview: {
    color: '#222',
    fontSize: 30,
    fontWeight: '800',
    marginBottom: 18,
    textAlign: 'center',
  },
  timePickerTitle: {
    color: '#333',
    fontSize: 17,
    fontWeight: '700',
  },
  timePickerWheels: {
    backgroundColor: '#f7f8fd',
    borderRadius: 22,
    flexDirection: 'row',
    gap: 12,
    padding: 12,
  },
  title: {
    color: '#fff',
    fontSize: 36,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  voiceOption: {
    backgroundColor: '#f7f7fb',
    borderColor: '#d8def8',
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
    padding: 16,
  },
  voiceOptionHeader: {
    marginBottom: 8,
  },
  voiceOptionMeta: {
    color: '#7a7a90',
    fontSize: 13,
  },
  voiceOptionSelected: {
    backgroundColor: '#edf2ff',
    borderColor: '#667eea',
  },
  voiceOptionText: {
    color: '#555',
    fontSize: 15,
    lineHeight: 22,
  },
  voiceOptionTitle: {
    color: '#333',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
});