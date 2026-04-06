# 🏥 SMDG29 Automated Pill Dispenser

A complete smart medication dispenser system with ESP32 hardware and cross-platform mobile app.

## ✨ Features

### Hardware (ESP32)
- ✅ Bluetooth Low Energy (BLE) communication
- ✅ 8-slot medication carousel with TMC2209 stepper drivers
- ✅ Real-time clock (DS3231) for scheduling
- ✅ Automated dispensing with sensor verification
- ✅ Audio alerts via buzzer
- ✅ I2C LCD display support

### Mobile App (React Native/Expo)
- ✅ Cross-platform (iOS & Android)
- ✅ Modern, beautiful UI with gradient designs
- ✅ Human-like voice feedback (ElevenLabs integration)
- ✅ BLE device pairing and control
- ✅ Medication scheduling and management
- ✅ Push notifications for reminders
- ✅ Real-time status updates

---

## 🚀 Quick Start

### **Part 1: ESP32 Firmware Setup (PlatformIO)**

#### Prerequisites
- PlatformIO IDE (VS Code extension recommended)
- ESP32 DevKit board
- USB cable for programming

#### Installation Steps

1. **Install PlatformIO**
   ```bash
   # In VS Code, install the PlatformIO IDE extension
   # Or use CLI:
   pip install platformio
   ```

2. **Create Project**
   ```bash
   mkdir pill-dispenser
   cd pill-dispenser
   
   # Copy the provided files:
   # - platformio.ini
   # - src/main.cpp
   ```

3. **Upload to ESP32**
   ```bash
   # Connect ESP32 via USB
   pio run --target upload
   
   # Or in VS Code PlatformIO:
   # Click "Upload" button in the bottom toolbar
   ```

4. **Monitor Serial Output**
   ```bash
   pio device monitor
   
   # Or in VS Code: Click "Serial Monitor" button
   # Baud rate: 115200
   ```

5. **Verify BLE is Advertising**
   - Open Serial Monitor
   - You should see: "✓ BLE advertising started"
   - Device name: "PillDispenser"

---

### **Part 2: Mobile App Setup (Expo)**

#### Prerequisites
- Node.js 18+ and npm
- Expo CLI
- iOS Simulator (Mac) or Android Emulator
- Physical device (recommended for BLE testing)

#### Installation Steps

1. **Install Expo CLI**
   ```bash
   npm install -g expo-cli
   ```

2. **Create App and Install Dependencies**
   ```bash
   cd pill-dispenser-app
   npm install
   ```

3. **Add Missing Package**
   ```bash
   # DateTimePicker for iOS/Android
   npm install @react-native-community/datetimepicker
   ```

4. **Configure ElevenLabs API (Optional)**
   - Sign up at https://elevenlabs.io (free tier available)
   - Get your API key
   - Open `services/VoiceService.js`
   - Replace `YOUR_ELEVENLABS_API_KEY` with your actual key
   
   **Note:** Voice will still work without API key, but will be text-based

5. **Start Development Server**
   ```bash
   npm start
   # or
   expo start
   ```

6. **Run on Device**
   
   **For iOS:**
   ```bash
   # Install Expo Go app from App Store
   # Scan QR code from terminal
   # Or press 'i' to open iOS Simulator
   ```
   
   **For Android:**
   ```bash
   # Install Expo Go app from Play Store
   # Scan QR code from terminal
   # Or press 'a' to open Android Emulator
   ```

---

## 📱 App Usage Guide

### First Time Setup

1. **Power on ESP32**
   - Device will start BLE advertising
   - LED should indicate power

2. **Open App**
   - App opens to connection screen
   - Tap "Scan for Device"

3. **Pair Device**
   - App finds "PillDispenser"
   - Tap "Connect"
   - Wait for connection (~5 seconds)

4. **Voice Welcome**
   - Voice says: "Hey there! Welcome back!"
   - Home screen appears

### Adding Medication

1. **Tap "+" or "Add Medication"**
   - Navigate to Add Medication screen

2. **Fill in Details**
   - Medication name (e.g., "Aspirin")
   - Select slot (1-8)
   - Choose time
   - Select days of week

3. **Save**
   - Tap "Save Medication"
   - Voice confirms: "Perfect! I've added [name] to your schedule"
   - Medication appears in list

### Dispensing Medication

**Manual Dispense:**
1. Go to Home or Medications screen
2. Find medication
3. Tap "Dispense Now" or "Take"
4. Voice says: "Okay, getting [name] ready for you right now!"
5. Device rotates carousel and dispenses pill
6. Voice confirms: "All set! Your [name] is ready"

**Automatic Schedule:**
- Device checks schedule every 30 seconds
- At scheduled time:
  - Buzzer sounds 3 beeps
  - Carousel rotates to correct slot
  - Pill dispenses
  - Push notification sent to phone
  - Voice reminder plays

---

## 🎨 App Icon Design

The app icon features a modern, friendly design:

```
┌─────────────────────────┐
│                         │
│     🏥 MediCare        │
│                         │
│   ╭─────────────╮      │
│   │    💊       │      │
│   │   ╱   ╲     │      │
│   │  ╱     ╲    │      │
│   │ ╱   +   ╲   │      │
│   │╱─────────╲  │      │
│   └───────────┘  │      │
│                         │
│  Gradient: #6366F1 →   │
│            #8B5CF6 →   │
│            #EC4899      │
└─────────────────────────┘
```

**Icon Specifications:**
- **Colors:** Gradient from Indigo (#6366F1) to Purple (#8B5CF6) to Pink (#EC4899)
- **Symbol:** Medical cross + pill capsule
- **Style:** Rounded, modern, friendly
- **Background:** Gradient with soft shadows

**To Create Icon:**
1. Use Figma, Sketch, or similar tool
2. Create 1024x1024px canvas
3. Apply gradient background
4. Add white medical cross
5. Add pill capsule icon
6. Export as PNG

**Icon Files Needed:**
- `assets/icon.png` - 1024x1024px
- `assets/adaptive-icon.png` - 1024x1024px (Android)
- `assets/splash.png` - 1284x2778px
- `assets/notification-icon.png` - 96x96px (Android)

---

## 🗂️ Project Structure

```
pill-dispenser/                 # ESP32 Firmware
├── platformio.ini
└── src/
    └── main.cpp

pill-dispenser-app/            # Mobile App
├── package.json
├── app.json
├── App.js
├── services/
│   ├── BLEService.js
│   └── VoiceService.js
├── screens/
│   ├── HomeScreen.js
│   ├── ConnectionScreen.js
│   ├── MedicationsScreen.js
│   ├── AddMedicationScreen.js
│   └── SettingsScreen.js
└── assets/
    ├── icon.png
    ├── adaptive-icon.png
    ├── splash.png
    └── notification-icon.png
```

---

## 🔧 Troubleshooting

### ESP32 Issues

**Problem: Upload fails**
- Solution: Press BOOT button while uploading
- Check USB cable (must be data cable, not charge-only)
- Verify COM port in Device Manager

**Problem: BLE not advertising**
- Check serial monitor for errors
- Ensure NimBLE library installed
- Reset ESP32 (press EN button)

**Problem: Motors not moving**
- Check power supply (12V for motors)
- Verify EN pin is LOW (enabled)
- Test with 9V battery first

### App Issues

**Problem: Can't find device**
- Ensure ESP32 is powered and advertising
- Check Bluetooth is enabled on phone
- Grant location permissions (required for BLE on Android)
- Try restarting app

**Problem: Connection fails**
- Move phone closer to ESP32
- Restart ESP32
- Clear Bluetooth cache (Android)
- Reinstall app

**Problem: No voice feedback**
- Check ElevenLabs API key is configured
- Verify phone volume is up
- Check VoiceService.js console logs

---

## 🎯 Hardware Pin Mapping

```
ESP32 Pin  →  Function
─────────────────────────
GPIO25     →  Motor1 STEP
GPIO26     →  Motor1 DIR
GPIO27     →  Motor1 EN
GPIO34     →  Motor1 DIAG

GPIO14     →  Motor2 STEP
GPIO12     →  Motor2 DIR
GPIO13     →  Motor2 EN
GPIO35     →  Motor2 DIAG

GPIO32     →  Valve Dispense
GPIO33     →  Valve Fill

GPIO4      →  Pill Sensor
GPIO18     →  Buzzer

GPIO21     →  I2C SDA (RTC, LCD)
GPIO22     →  I2C SCL (RTC, LCD)
```

---

## 📡 BLE Communication Protocol

### Service UUID
```
4fafc201-1fb5-459e-8fcc-c5c9c331914b
```

### Characteristics

**Command (Write):**
```
UUID: beb5483e-36e1-4688-b7f5-ea07361b26a8
Format: JSON
Example:
{
  "action": "dispense",
  "slot": 2
}
```

**Status (Read/Notify):**
```
UUID: beb5483e-36e1-4688-b7f5-ea07361b26a9
Format: JSON
Example:
{
  "status": "idle",
  "slot": 0,
  "medicationCount": 3,
  "time": { "hour": 14, "minute": 30 }
}
```

**Medications (Read/Notify):**
```
UUID: beb5483e-36e1-4688-b7f5-ea07361b26aa
Format: JSON
Example:
{
  "medications": [
    {
      "id": "uuid",
      "name": "Aspirin",
      "slot": 0,
      "hour": 8,
      "minute": 0,
      "enabled": true,
      "taken": false
    }
  ]
}
```

---

## 🎤 Voice Feedback Examples

The app uses human-like phrases with emotional context:

**Welcome:**
- "Hey there! Welcome back! How are you feeling today?"
- "Hi! Good to see you! Ready to stay on track with your medications?"

**Medication Added:**
- "Perfect! I've added {name} to your schedule. You're doing great!"
- "Got it! {name} is now in your routine. I'll make sure you don't miss it."

**Reminder:**
- "Hey, it's time for your {name}! Let's take care of you real quick."
- "Hi there! Just a gentle reminder - it's {name} time. You've got this!"

**Encouragement:**
- "You're doing such a great job staying on top of your health!"
- "Your consistency is inspiring! Every day you're taking care of yourself matters."

---

## 🔐 Security Notes

- BLE connection is paired and encrypted
- No medication data stored in cloud
- All data local to device and phone
- API keys should be kept secure
- Consider implementing PIN/biometric lock for app

---

## 📝 License

This project is created for educational purposes as part of the SMDG29 senior design project.

---

## 👥 Team

SMDG29 - Automated Pill Dispenser for Seniors

---

## 🆘 Support

For issues or questions:
1. Check troubleshooting section above
2. Review serial monitor output (ESP32)
3. Check console logs in Expo (app)
4. Verify all connections and configurations

---

## 🎉 Enjoy!

Your smart pill dispenser is now ready! Stay healthy and never miss a medication! 💊

**Remember:** This device is a helpful tool but should not replace professional medical advice. Always consult with healthcare providers about your medications.
